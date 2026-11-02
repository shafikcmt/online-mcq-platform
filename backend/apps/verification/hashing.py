"""Hashing helpers. Nothing here ever logs or stores a raw code or token."""

import hashlib
import secrets

from django.conf import settings
from django.utils.crypto import constant_time_compare, salted_hmac

_OTP_KEY_SALT = "apps.verification.otp"


def generate_otp(length: int | None = None) -> str:
    """Cryptographically secure numeric code, zero-padded (e.g. ``"004219"``)."""
    length = length or settings.OTP_LENGTH
    return str(secrets.randbelow(10**length)).zfill(length)


def hash_otp(mobile_number: str, purpose: str, code: str) -> str:
    """Keyed HMAC-SHA256 bound to the number and purpose.

    The key is derived from SECRET_KEY, so a database leak alone does not allow
    brute-forcing the (small) code space; the binding stops reuse of a code for a
    different number or purpose.
    """
    message = f"{mobile_number}|{purpose}|{code}"
    return salted_hmac(_OTP_KEY_SALT, message, algorithm="sha256").hexdigest()


def otp_matches(stored_hash: str, mobile_number: str, purpose: str, code: str) -> bool:
    return constant_time_compare(stored_hash, hash_otp(mobile_number, purpose, code))


def generate_verification_token() -> str:
    """256-bit random, URL-safe token. Returned to the client once."""
    return secrets.token_urlsafe(32)


def hash_verification_token(token: str) -> str:
    # The token is high-entropy, so a plain SHA-256 is enough to make a stolen
    # database useless while still allowing an indexed lookup.
    return hashlib.sha256(token.encode()).hexdigest()
