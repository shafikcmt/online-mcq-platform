"""Encrypt secrets stored in the database (e.g. SMS gateway API keys).

The key comes only from the ``SECRET_ENCRYPTION_KEY`` environment variable (a Fernet key).
Without it the helpers refuse to run — secrets are never stored in plaintext.
Losing the key makes stored secrets unreadable; keep a copy in the server's password store.

Changing the key: put the old key(s) in ``SECRET_ENCRYPTION_KEY_PREVIOUS`` (comma-separated) and
the new one in ``SECRET_ENCRYPTION_KEY``. New secrets are written with the new key, old ones
stay readable, and ``manage.py rotate_secrets --apply`` re-encrypts them. Then remove the old key.
"""

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured


class SecretBoxError(Exception):
    """A stored secret cannot be decrypted (wrong or rotated key, or tampered data)."""


def _primary() -> Fernet:
    key = getattr(settings, "SECRET_ENCRYPTION_KEY", "")
    if not key:
        raise ImproperlyConfigured("SECRET_ENCRYPTION_KEY is not set; secrets cannot be stored.")
    try:
        return Fernet(key.encode())
    except (ValueError, TypeError) as exc:
        raise ImproperlyConfigured("SECRET_ENCRYPTION_KEY is not a valid Fernet key.") from exc


def _fernet() -> MultiFernet:
    """The current key first (it encrypts), then any previous keys (decrypt only)."""
    keys = [_primary()]
    for old in getattr(settings, "SECRET_ENCRYPTION_KEY_PREVIOUS", None) or []:
        try:
            keys.append(Fernet(old.encode()))
        except (ValueError, TypeError) as exc:
            raise ImproperlyConfigured(
                "SECRET_ENCRYPTION_KEY_PREVIOUS holds an invalid Fernet key."
            ) from exc
    return MultiFernet(keys)


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_secret(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise SecretBoxError("stored secret cannot be decrypted") from exc


def uses_current_key(token: str) -> bool:
    """True when the token decrypts with the current key alone (no rotation needed)."""
    try:
        _primary().decrypt(token.encode("ascii"))
    except InvalidToken:
        return False
    return True


def reencrypt_secret(token: str) -> str:
    """The same secret, encrypted again with the current key. Raises ``SecretBoxError`` when
    neither the current nor a previous key can read it."""
    return encrypt_secret(decrypt_secret(token))


def last_four(plaintext: str) -> str:
    """Safe hint for the admin page: the last 4 characters only."""
    return plaintext[-4:] if len(plaintext) > 8 else ""
