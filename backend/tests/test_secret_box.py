"""Encryption of database secrets: fail closed without a key, round-trip, no plaintext."""

import pytest
from cryptography.fernet import Fernet
from django.core.exceptions import ImproperlyConfigured
from django.test import override_settings

from apps.core.secret_box import SecretBoxError, decrypt_secret, encrypt_secret, last_four

KEY = Fernet.generate_key().decode()


def test_round_trip_and_ciphertext_hides_plaintext():
    with override_settings(SECRET_ENCRYPTION_KEY=KEY):
        token = encrypt_secret("super-secret-api-key-1234")
        assert "super-secret" not in token
        assert decrypt_secret(token) == "super-secret-api-key-1234"


def test_refuses_to_run_without_a_key():
    with override_settings(SECRET_ENCRYPTION_KEY=""), pytest.raises(ImproperlyConfigured):
        encrypt_secret("x")


def test_refuses_an_invalid_key():
    with override_settings(SECRET_ENCRYPTION_KEY="not-a-key"), pytest.raises(ImproperlyConfigured):
        encrypt_secret("x")


def test_wrong_key_cannot_decrypt():
    with override_settings(SECRET_ENCRYPTION_KEY=KEY):
        token = encrypt_secret("abc-secret-value")
    with override_settings(SECRET_ENCRYPTION_KEY=Fernet.generate_key().decode()):
        with pytest.raises(SecretBoxError):
            decrypt_secret(token)


def test_last_four_never_reveals_short_secrets():
    assert last_four("abcdefgh1234") == "1234"
    assert last_four("short") == ""
