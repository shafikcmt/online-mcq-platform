"""Changing SECRET_ENCRYPTION_KEY: old secrets stay readable and can be re-encrypted."""

from io import StringIO

import pytest
from cryptography.fernet import Fernet
from django.core.exceptions import ImproperlyConfigured
from django.core.management import CommandError, call_command
from django.test import override_settings

from apps.core.secret_box import decrypt_secret, encrypt_secret, uses_current_key
from apps.payments.models import PaymentGateway, PaymentGatewayCredential
from apps.verification.models import SmsGatewaySettings

OLD = Fernet.generate_key().decode()
NEW = Fernet.generate_key().decode()
SECRET = "gateway-secret-value-9876"
SMS_KEY = "sms-api-key-value-4321"

old_only = override_settings(SECRET_ENCRYPTION_KEY=OLD, SECRET_ENCRYPTION_KEY_PREVIOUS=[])
rotating = override_settings(SECRET_ENCRYPTION_KEY=NEW, SECRET_ENCRYPTION_KEY_PREVIOUS=[OLD])
new_only = override_settings(SECRET_ENCRYPTION_KEY=NEW, SECRET_ENCRYPTION_KEY_PREVIOUS=[])


def run(*args):
    out, err = StringIO(), StringIO()
    call_command("rotate_secrets", *args, stdout=out, stderr=err)
    return out.getvalue() + err.getvalue()


@pytest.fixture
def stored(db):
    """One gateway credential and the SMS key, both written with the old key."""
    gateway = PaymentGateway.objects.create(
        slug="rot-gw", adapter="bkash", name_en="Rotation", currencies=["BDT"]
    )
    with old_only:
        credential = PaymentGatewayCredential.objects.create(
            gateway=gateway,
            mode="sandbox",
            field="app_secret",
            value_encrypted=encrypt_secret(SECRET),
            hint="9876",
        )
        sms = SmsGatewaySettings.objects.create(
            api_key_encrypted=encrypt_secret(SMS_KEY), api_key_hint="4321"
        )
    return credential, sms


def test_previous_key_still_decrypts_and_new_writes_use_the_new_key():
    with old_only:
        token = encrypt_secret(SECRET)
    with rotating:
        assert decrypt_secret(token) == SECRET
        assert not uses_current_key(token)
        fresh = encrypt_secret(SECRET)
    with new_only:
        assert decrypt_secret(fresh) == SECRET


def test_invalid_previous_key_is_refused():
    with override_settings(SECRET_ENCRYPTION_KEY=NEW, SECRET_ENCRYPTION_KEY_PREVIOUS=["nope"]):
        with pytest.raises(ImproperlyConfigured):
            encrypt_secret("x")


def test_report_only_changes_nothing(stored):
    credential, sms = stored
    before = (credential.value_encrypted, sms.api_key_encrypted)
    with rotating:
        output = run()
    assert "Need re-encryption: 2" in output
    credential.refresh_from_db()
    sms.refresh_from_db()
    assert (credential.value_encrypted, sms.api_key_encrypted) == before


def test_apply_reencrypts_everything_and_the_old_key_can_go(stored):
    credential, sms = stored
    with rotating:
        output = run("--apply")
        assert "Re-encrypted with the current key: 2" in output
        assert "Nothing to do." in run()
    credential.refresh_from_db()
    sms.refresh_from_db()
    with new_only:
        assert decrypt_secret(credential.value_encrypted) == SECRET
        assert decrypt_secret(sms.api_key_encrypted) == SMS_KEY
    # The hints and everything else are untouched.
    assert (credential.hint, sms.api_key_hint) == ("9876", "4321")


def test_output_never_contains_a_secret_or_a_key(stored):
    with rotating:
        output = run() + run("--apply")
    for forbidden in (SECRET, SMS_KEY, OLD, NEW, "9876", "4321"):
        assert forbidden not in output


def test_unreadable_secret_stops_the_run_and_writes_nothing(stored):
    credential, sms = stored
    with override_settings(SECRET_ENCRYPTION_KEY=Fernet.generate_key().decode()):
        sms.api_key_encrypted = encrypt_secret("written-with-a-third-key")
        sms.save(update_fields=["api_key_encrypted"])
    before = credential.value_encrypted
    with rotating:
        with pytest.raises(CommandError, match="1 secret"):
            run("--apply")
    credential.refresh_from_db()
    assert credential.value_encrypted == before


def test_missing_key_fails_closed(stored):
    with override_settings(SECRET_ENCRYPTION_KEY="", SECRET_ENCRYPTION_KEY_PREVIOUS=[OLD]):
        with pytest.raises(ImproperlyConfigured):
            run("--apply")


@pytest.mark.django_db
def test_empty_database_is_fine():
    with new_only:
        assert "Nothing to do." in run()
        assert "Re-encrypted with the current key: 0" in run("--apply")
