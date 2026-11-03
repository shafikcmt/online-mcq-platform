"""Encrypt secrets stored in the database (e.g. SMS gateway API keys).

The key comes only from the ``SECRET_ENCRYPTION_KEY`` environment variable (a Fernet key).
Without it the helpers refuse to run — secrets are never stored in plaintext.
Losing the key makes stored secrets unreadable; keep a copy in the server's password store.
"""

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured


class SecretBoxError(Exception):
    """A stored secret cannot be decrypted (wrong or rotated key, or tampered data)."""


def _fernet() -> Fernet:
    key = getattr(settings, "SECRET_ENCRYPTION_KEY", "")
    if not key:
        raise ImproperlyConfigured("SECRET_ENCRYPTION_KEY is not set; secrets cannot be stored.")
    try:
        return Fernet(key.encode())
    except (ValueError, TypeError) as exc:
        raise ImproperlyConfigured("SECRET_ENCRYPTION_KEY is not a valid Fernet key.") from exc


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_secret(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise SecretBoxError("stored secret cannot be decrypted") from exc


def last_four(plaintext: str) -> str:
    """Safe hint for the admin page: the last 4 characters only."""
    return plaintext[-4:] if len(plaintext) > 8 else ""
