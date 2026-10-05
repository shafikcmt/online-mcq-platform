import logging
import re
import threading
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path
from unittest import mock

import pytest
from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured
from django.db import connection
from django.db.migrations.loader import MigrationLoader
from django.test import override_settings
from django.utils import timezone, translation

from apps.verification import ratelimit, services
from apps.verification.exceptions import (
    InvalidMobileNumber,
    OtpExpired,
    OtpInvalid,
    OtpLocked,
    OtpRateLimited,
    OtpResendCooldown,
    OtpServiceUnavailable,
    VerificationTokenInvalid,
)
from apps.verification.hashing import generate_otp, hash_otp, hash_verification_token
from apps.verification.models import OtpCode, OtpPurpose, VerificationToken
from apps.verification.sms import SmsDeliveryError, get_sms_provider
from apps.verification.sms.mock import MockSmsProvider
from apps.verification.tasks import send_otp_sms
from apps.verification.templates_sms import (
    BANGLA_SEGMENT_LIMIT,
    LATIN_SEGMENT_LIMIT,
    render_otp_message,
)

REG = OtpPurpose.REGISTRATION
RESET = OtpPurpose.PASSWORD_RESET
MOBILE = "01712345678"
E164 = "+8801712345678"


@pytest.fixture(autouse=True)
def _clean_state():
    cache.clear()
    MockSmsProvider.outbox.clear()
    yield
    cache.clear()
    MockSmsProvider.outbox.clear()


@contextmanager
def frozen_at(moment):
    with mock.patch("django.utils.timezone.now", return_value=moment):
        yield


def later(seconds):
    """Move the clock forward. Clears the cache, as Redis keys would have expired."""
    cache.clear()
    return frozen_at(timezone.now() + timedelta(seconds=seconds))


def sms_code(index=-1):
    return re.search(r"\d{4,10}", MockSmsProvider.outbox[index].message).group()


@pytest.fixture
def request_code(django_capture_on_commit_callbacks):
    """Request an OTP and return the code from the mock SMS (test-only mechanism)."""

    def _request(mobile=MOBILE, purpose=REG, **kwargs):
        with django_capture_on_commit_callbacks(execute=True):
            services.request_otp(mobile, purpose, **kwargs)
        return sms_code()

    return _request


# ======================================================================================
# Generation & hashing
# ======================================================================================
pytestmark = pytest.mark.django_db


class TestGenerationAndHashing:
    def test_codes_are_numeric_and_configurable_length(self):
        assert re.fullmatch(r"\d{6}", generate_otp())
        with override_settings(OTP_LENGTH=8):
            assert re.fullmatch(r"\d{8}", generate_otp())

    def test_codes_come_from_the_secrets_module_and_keep_leading_zeros(self):
        with mock.patch(
            "apps.verification.hashing.secrets.randbelow", return_value=42
        ) as randbelow:
            assert generate_otp(6) == "000042"
        randbelow.assert_called_once_with(10**6)

    def test_codes_are_not_predictable(self):
        assert len({generate_otp() for _ in range(300)}) > 280

    def test_hash_is_keyed_and_bound_to_number_and_purpose(self):
        base = hash_otp(E164, REG, "123456")
        assert re.fullmatch(r"[0-9a-f]{64}", base)
        assert base != hash_otp("+8801812345678", REG, "123456")
        assert base != hash_otp(E164, RESET, "123456")
        with override_settings(SECRET_KEY="a-different-secret-key-for-this-test-only-123456789"):
            assert base != hash_otp(E164, REG, "123456")

    def test_otp_is_never_stored_in_plain_text(self, request_code):
        code = request_code()
        otp = OtpCode.objects.get()
        stored = [str(getattr(otp, f.attname)) for f in OtpCode._meta.concrete_fields]
        assert all(code not in value for value in stored if value != str(otp.pk))
        assert otp.otp_hash == hash_otp(E164, REG, code)

    def test_comparison_is_constant_time(self, request_code):
        code = request_code()
        with mock.patch(
            "apps.verification.hashing.constant_time_compare", wraps=lambda a, b: a == b
        ) as compare:
            services.verify_otp(MOBILE, REG, code)
        compare.assert_called_once()


# ======================================================================================
# Requesting codes
# ======================================================================================
class TestRequestOtp:
    @pytest.mark.parametrize(
        "raw", ["01712345678", "+8801712345678", "০১৭১২৩৪৫৬৭৮", "017-1234 5678"]
    )
    def test_mobile_formats_are_normalized(self, raw, request_code):
        request_code(raw)
        assert OtpCode.objects.get().mobile_number == E164
        assert MockSmsProvider.outbox[-1].to == E164

    @pytest.mark.parametrize("bad", ["12345", "01212345678", "", None])
    def test_invalid_mobile_is_rejected_without_side_effects(self, bad):
        with pytest.raises(InvalidMobileNumber):
            services.request_otp(bad, REG)
        assert OtpCode.objects.count() == 0
        assert MockSmsProvider.outbox == []

    def test_unknown_purpose_is_a_programming_error(self):
        with pytest.raises(ValueError):
            services.request_otp(MOBILE, "login")

    def test_result_reports_expiry_and_resend_time(self, django_capture_on_commit_callbacks):
        now = timezone.now()
        with frozen_at(now), django_capture_on_commit_callbacks(execute=True):
            result = services.request_otp(MOBILE, REG)
        assert result.mobile_number == E164
        assert result.expires_at == now + timedelta(seconds=300)
        assert result.resend_available_at == now + timedelta(seconds=60)
        assert not hasattr(result, "code")

    def test_request_ip_and_language_are_recorded(self, request_code):
        request_code(language="en", request_ip="203.0.113.7")
        otp = OtpCode.objects.get()
        assert otp.request_ip == "203.0.113.7"
        assert otp.language == "en"

    def test_default_language_is_bangla(self, request_code):
        request_code()
        assert OtpCode.objects.get().language == "bn"

    def test_new_code_invalidates_the_previous_one(self, request_code):
        first = request_code()
        with later(61):
            request_code()
        old, new = OtpCode.objects.order_by("created_at")
        assert old.invalidated_at is not None and new.invalidated_at is None
        with pytest.raises(OtpInvalid):
            services.verify_otp(MOBILE, REG, first)


class TestResendCooldown:
    def test_second_request_inside_cooldown_is_refused(self, request_code):
        request_code()
        with pytest.raises(OtpResendCooldown) as exc:
            services.request_otp(MOBILE, REG)
        assert 1 <= exc.value.retry_after <= 60
        assert OtpCode.objects.count() == 1

    def test_request_allowed_after_cooldown(self, request_code):
        request_code()
        with later(61):
            request_code()
        assert OtpCode.objects.count() == 2

    def test_cooldown_cannot_be_bypassed_with_another_number_format(self, request_code):
        request_code("01712345678")
        with pytest.raises(OtpResendCooldown):
            services.request_otp("+880 1712-345678", REG)

    def test_cooldown_is_per_purpose(self, request_code):
        request_code(purpose=REG)
        request_code(purpose=RESET)
        assert OtpCode.objects.count() == 2

    def test_redis_claim_blocks_simultaneous_requests(self):
        # Another request already claimed the slot but has not written its row yet.
        assert ratelimit.acquire_cooldown("otp", f"{E164}:{REG}", seconds=60)
        with pytest.raises(OtpResendCooldown):
            services.request_otp(MOBILE, REG)

    @override_settings(OTP_RESEND_COOLDOWN_SECONDS=120)
    def test_cooldown_is_configurable(self, request_code):
        request_code()
        with later(61), pytest.raises(OtpResendCooldown):
            services.request_otp(MOBILE, REG)


class TestPerNumberLimit:
    @pytest.fixture(autouse=True)
    def _limits(self, settings):
        settings.OTP_RESEND_COOLDOWN_SECONDS = 0
        settings.OTP_REQUEST_LIMIT = 3

    def test_limit_per_number_within_window(self, request_code):
        for _ in range(3):
            request_code()
        with pytest.raises(OtpRateLimited) as exc:
            services.request_otp(MOBILE, REG)
        assert 1 <= exc.value.retry_after <= 3600

    def test_limit_counts_all_purposes(self, request_code):
        request_code(purpose=REG)
        request_code(purpose=RESET)
        request_code(purpose=REG)
        with pytest.raises(OtpRateLimited):
            services.request_otp(MOBILE, RESET)

    def test_limit_cannot_be_bypassed_with_number_formats(self, request_code):
        for raw in ["01712345678", "+8801712345678", "০১৭১২৩৪৫৬৭৮"]:
            request_code(raw)
        with pytest.raises(OtpRateLimited):
            services.request_otp("8801712345678", REG)

    def test_other_numbers_are_not_affected(self, request_code):
        for _ in range(3):
            request_code()
        request_code("01812345678")

    def test_window_expires(self, request_code):
        for _ in range(3):
            request_code()
        with later(3601):
            request_code()


class TestPerIpLimit:
    @pytest.fixture(autouse=True)
    def _limits(self, settings):
        settings.OTP_IP_REQUEST_LIMIT = 2
        settings.OTP_RESEND_COOLDOWN_SECONDS = 0

    def test_limit_per_ip_across_numbers(self, request_code):
        request_code("01712345678", request_ip="198.51.100.1")
        request_code("01812345678", request_ip="198.51.100.1")
        with pytest.raises(OtpRateLimited) as exc:
            services.request_otp("01912345678", REG, request_ip="198.51.100.1")
        assert exc.value.retry_after >= 1
        assert OtpCode.objects.count() == 2

    def test_other_ips_are_not_affected(self, request_code):
        request_code("01712345678", request_ip="198.51.100.1")
        request_code("01812345678", request_ip="198.51.100.1")
        request_code("01912345678", request_ip="198.51.100.2")

    def test_refused_requests_still_count(self, request_code):
        request_code(request_ip="198.51.100.1")
        with pytest.raises(OtpResendCooldown), override_settings(OTP_RESEND_COOLDOWN_SECONDS=60):
            services.request_otp(MOBILE, REG, request_ip="198.51.100.1")
        with pytest.raises(OtpRateLimited):
            services.request_otp("01812345678", REG, request_ip="198.51.100.1")


# ======================================================================================
# Verifying codes
# ======================================================================================
class TestVerifyOtp:
    def test_correct_code_returns_a_verification_token(self, request_code):
        code = request_code()
        result = services.verify_otp(MOBILE, REG, code)

        assert result.mobile_number == E164 and result.purpose == REG
        assert len(result.verification_token) >= 40
        otp = OtpCode.objects.get()
        assert otp.used_at is not None
        token = VerificationToken.objects.get()
        assert token.otp == otp and token.used_at is None
        assert token.token_hash == hash_verification_token(result.verification_token)
        assert result.verification_token not in token.token_hash

    def test_bangla_digit_code_and_other_number_format_are_accepted(self, request_code):
        code = request_code()
        bangla_code = code.translate(str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯"))
        services.verify_otp("+880 1712 345678", REG, bangla_code)

    def test_wrong_code_counts_a_failed_attempt(self, request_code):
        code = request_code()
        wrong = str((int(code) + 1) % 10**6).zfill(6)
        with pytest.raises(OtpInvalid) as exc:
            services.verify_otp(MOBILE, REG, wrong)
        assert exc.value.attempts_remaining == 4
        assert OtpCode.objects.get().failed_attempts == 1  # saved despite the error

    @pytest.mark.parametrize("garbage", ["", "abc", "12 34", None])
    def test_malformed_codes_are_wrong_attempts(self, request_code, garbage):
        request_code()
        with pytest.raises(OtpInvalid):
            services.verify_otp(MOBILE, REG, garbage)
        assert OtpCode.objects.get().failed_attempts == 1

    def test_lockout_after_max_attempts(self, request_code):
        code = request_code()
        wrong = str((int(code) + 1) % 10**6).zfill(6)
        for _ in range(4):
            with pytest.raises(OtpInvalid):
                services.verify_otp(MOBILE, REG, wrong)
        with pytest.raises(OtpLocked):
            services.verify_otp(MOBILE, REG, wrong)
        # Even the right code no longer works …
        with pytest.raises(OtpLocked):
            services.verify_otp(MOBILE, REG, code)
        assert OtpCode.objects.get().failed_attempts == 5
        # … a new code must be requested.
        with later(61):
            new_code = request_code()
            services.verify_otp(MOBILE, REG, new_code)

    @override_settings(OTP_MAX_ATTEMPTS=2)
    def test_max_attempts_is_configurable(self, request_code):
        request_code()
        with pytest.raises(OtpInvalid):
            services.verify_otp(MOBILE, REG, "000000")
        with pytest.raises(OtpLocked):
            services.verify_otp(MOBILE, REG, "000001")

    def test_expired_code_fails(self, request_code):
        code = request_code()
        with later(301), pytest.raises(OtpExpired):
            services.verify_otp(MOBILE, REG, code)

    @override_settings(OTP_TTL_SECONDS=30)
    def test_expiry_is_configurable(self, request_code):
        code = request_code()
        with later(31), pytest.raises(OtpExpired):
            services.verify_otp(MOBILE, REG, code)

    def test_code_is_single_use(self, request_code):
        code = request_code()
        services.verify_otp(MOBILE, REG, code)
        with pytest.raises(OtpInvalid):
            services.verify_otp(MOBILE, REG, code)
        assert VerificationToken.objects.count() == 1

    def test_wrong_purpose_fails(self, request_code):
        code = request_code(purpose=REG)
        with pytest.raises(OtpInvalid):
            services.verify_otp(MOBILE, RESET, code)

    def test_wrong_mobile_fails(self, request_code):
        code = request_code()
        with pytest.raises(OtpInvalid):
            services.verify_otp("01812345678", REG, code)

    def test_invalid_mobile_on_verify_gives_the_generic_error(self):
        with pytest.raises(OtpInvalid):
            services.verify_otp("not-a-number", REG, "123456")

    def test_no_code_requested_gives_the_generic_error(self):
        with pytest.raises(OtpInvalid):
            services.verify_otp(MOBILE, REG, "123456")


@pytest.mark.django_db(transaction=True)
def test_concurrent_verification_issues_exactly_one_token(django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        services.request_otp(MOBILE, REG)
    code = sms_code()
    barrier = threading.Barrier(4)
    outcomes = []

    def attempt():
        try:
            barrier.wait()
            services.verify_otp(MOBILE, REG, code)
            outcomes.append("ok")
        except OtpInvalid:
            outcomes.append("invalid")
        finally:
            connection.close()

    threads = [threading.Thread(target=attempt) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert sorted(outcomes) == ["invalid", "invalid", "invalid", "ok"]
    assert VerificationToken.objects.count() == 1


# ======================================================================================
# Verification tokens
# ======================================================================================
@pytest.fixture
def verified(request_code):
    def _verified(mobile=MOBILE, purpose=REG):
        return services.verify_otp(
            mobile, purpose, request_code(mobile, purpose)
        ).verification_token

    return _verified


class TestVerificationToken:
    def test_token_can_be_consumed_once(self, verified):
        token = verified()
        assert services.consume_verification_token(token, MOBILE, REG) == E164
        with pytest.raises(VerificationTokenInvalid):
            services.consume_verification_token(token, MOBILE, REG)
        assert VerificationToken.objects.get().used_at is not None

    def test_token_is_bound_to_purpose(self, verified):
        token = verified(purpose=REG)
        with pytest.raises(VerificationTokenInvalid):
            services.consume_verification_token(token, MOBILE, RESET)
        # A rejected attempt does not burn the token for its real purpose.
        services.consume_verification_token(token, MOBILE, REG)

    def test_token_is_bound_to_mobile_number(self, verified):
        token = verified()
        with pytest.raises(VerificationTokenInvalid):
            services.consume_verification_token(token, "01812345678", REG)
        services.consume_verification_token(token, "০১৭১২৩৪৫৬৭৮", REG)  # same number

    def test_token_expires(self, verified):
        token = verified()
        with later(601), pytest.raises(VerificationTokenInvalid):
            services.consume_verification_token(token, MOBILE, REG)

    @override_settings(VERIFICATION_TOKEN_TTL_SECONDS=60)
    def test_token_lifetime_is_configurable(self, verified):
        token = verified()
        with later(61), pytest.raises(VerificationTokenInvalid):
            services.consume_verification_token(token, MOBILE, REG)

    @pytest.mark.parametrize("bad", ["", None, "made-up-token", "x" * 43])
    def test_unknown_tokens_fail(self, bad):
        with pytest.raises(VerificationTokenInvalid):
            services.consume_verification_token(bad, MOBILE, REG)

    def test_invalid_mobile_gives_the_same_error(self, verified):
        token = verified()
        with pytest.raises(VerificationTokenInvalid):
            services.consume_verification_token(token, "garbage", REG)

    def test_only_the_hash_is_stored(self, verified):
        token = verified()
        record = VerificationToken.objects.get()
        values = [str(getattr(record, f.attname)) for f in VerificationToken._meta.concrete_fields]
        assert all(token not in value for value in values)

    def test_tokens_are_unique(self, verified):
        first = verified("01712345678")
        second = verified("01812345678")
        assert first != second


@pytest.mark.django_db(transaction=True)
def test_concurrent_token_consumption_succeeds_once(django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        services.request_otp(MOBILE, REG)
    token = services.verify_otp(MOBILE, REG, sms_code()).verification_token
    barrier = threading.Barrier(4)
    outcomes = []

    def attempt():
        try:
            barrier.wait()
            services.consume_verification_token(token, MOBILE, REG)
            outcomes.append("ok")
        except VerificationTokenInvalid:
            outcomes.append("invalid")
        finally:
            connection.close()

    threads = [threading.Thread(target=attempt) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(outcomes) == ["invalid", "invalid", "invalid", "ok"]


# ======================================================================================
# SMS provider, Celery task, templates
# ======================================================================================
class TestSmsProvider:
    def test_mock_provider_is_selected_by_default(self):
        assert isinstance(get_sms_provider(), MockSmsProvider)

    def test_mock_provider_records_messages(self):
        result = get_sms_provider().send(E164, "hello")
        assert result.provider == "mock" and result.message_id.startswith("mock-")
        assert MockSmsProvider.outbox[-1].to == E164
        assert MockSmsProvider.outbox[-1].message == "hello"

    @override_settings(SMS_PROVIDER="does-not-exist")
    def test_unknown_provider_is_a_configuration_error(self):
        with pytest.raises(ImproperlyConfigured):
            get_sms_provider()

    def test_mock_logs_neither_message_nor_full_number_by_default(self, caplog):
        with caplog.at_level(logging.DEBUG):
            get_sms_provider().send(E164, "secret 987654")
        assert "987654" not in caplog.text
        assert E164 not in caplog.text

    @override_settings(DEBUG=False, SMS_MOCK_LOG_CONTENT=True)
    def test_content_logging_is_ignored_unless_debug(self, caplog):
        with caplog.at_level(logging.DEBUG):
            get_sms_provider().send(E164, "secret 987654")
        assert "987654" not in caplog.text

    @override_settings(DEBUG=True, SMS_MOCK_LOG_CONTENT=True)
    def test_content_logging_works_for_local_development(self, caplog):
        with caplog.at_level(logging.DEBUG):
            get_sms_provider().send(E164, "secret 987654")
        assert "987654" in caplog.text


class TestCeleryTask:
    def test_sms_is_only_queued_after_the_transaction_commits(self):
        services.request_otp(MOBILE, REG)  # on_commit callbacks not executed in this test
        assert MockSmsProvider.outbox == []

    def test_only_the_otp_id_goes_through_the_broker(self, django_capture_on_commit_callbacks):
        with (
            mock.patch.object(send_otp_sms, "delay") as delay,
            django_capture_on_commit_callbacks(execute=True),
        ):
            services.request_otp(MOBILE, REG)
        delay.assert_called_once_with(OtpCode.objects.get().pk)  # no code, no number

    def test_web_request_never_holds_the_code(self):
        # Until the worker runs there is no code at all — only an empty hash.
        services.request_otp(MOBILE, REG)  # on_commit (the worker) not executed
        otp = OtpCode.objects.get()
        assert otp.otp_hash == ""
        with pytest.raises(OtpInvalid):
            services.verify_otp(MOBILE, REG, "123456")

    def test_worker_generates_the_code_and_stores_only_its_hash(self, request_code):
        code = request_code()
        otp = OtpCode.objects.get()
        assert otp.otp_hash == hash_otp(E164, REG, code)

    def test_a_retry_replaces_a_possibly_undelivered_code(self, django_capture_on_commit_callbacks):
        with mock.patch("apps.verification.tasks.generate_otp", side_effect=["111111", "222222"]):
            with django_capture_on_commit_callbacks(execute=True):
                services.request_otp(MOBILE, REG)
            assert send_otp_sms(OtpCode.objects.get().pk) == "sent"  # e.g. a retry
        with pytest.raises(OtpInvalid):
            services.verify_otp(MOBILE, REG, "111111")
        services.verify_otp(MOBILE, REG, "222222")

    def test_task_sends_the_message_in_the_otp_language(self, request_code):
        code = request_code(language="en")
        assert MockSmsProvider.outbox[-1].message.startswith("Your verification code is")
        assert code in MockSmsProvider.outbox[-1].message

    @pytest.mark.parametrize("state", ["used", "invalidated", "expired"])
    def test_task_skips_codes_that_are_no_longer_active(self, state):
        otp = OtpCode.objects.create(
            mobile_number=E164,
            purpose=REG,
            language="bn",
            expires_at=timezone.now() + timedelta(minutes=5),
        )
        if state == "expired":
            otp.expires_at = timezone.now() - timedelta(seconds=1)
        else:
            setattr(otp, f"{state}_at", timezone.now())
        otp.save()

        assert send_otp_sms(otp.pk) == "skipped"
        assert MockSmsProvider.outbox == []
        otp.refresh_from_db()
        assert otp.otp_hash == ""  # no code was generated

    def test_task_retries_temporary_provider_failures(self):
        assert SmsDeliveryError in send_otp_sms.autoretry_for
        assert send_otp_sms.max_retries == 3


class TestSmsTemplates:
    def test_bangla_message_is_short_and_contains_the_code(self):
        message = render_otp_message("482913", 5, "bn")
        assert "482913" in message
        assert re.search(r"[ঀ-৿]", message)  # Bangla script
        assert len(message) <= BANGLA_SEGMENT_LIMIT

    def test_english_message_fits_one_sms(self):
        message = render_otp_message("482913", 5, "en")
        assert message == "Your verification code is 482913. Valid for 5 min. Don't share it."
        assert len(message) <= LATIN_SEGMENT_LIMIT

    def test_bangla_is_used_by_default(self, request_code):
        request_code()
        assert re.search(r"[ঀ-৿]", MockSmsProvider.outbox[-1].message)

    def test_regional_language_codes_are_accepted(self, request_code):
        request_code(language="en-US")
        assert OtpCode.objects.get().language == "en"


# ======================================================================================
# Security properties
# ======================================================================================
class TestSecurity:
    def test_codes_and_tokens_never_appear_in_logs(self, request_code, caplog):
        with caplog.at_level(logging.DEBUG):
            code = request_code()
            token = services.verify_otp(MOBILE, REG, code).verification_token
            services.consume_verification_token(token, MOBILE, REG)
        assert code not in caplog.text
        assert token not in caplog.text
        assert E164 not in caplog.text  # only masked numbers are logged

    def test_error_messages_are_localized(self):
        with translation.override("bn"):
            assert str(OtpInvalid().message) == "কোডটি সঠিক নয়।"
        with translation.override("en"):
            assert str(OtpInvalid().message) == "The code is incorrect."

    def test_verification_module_does_not_depend_on_accounts(self):
        source = "\n".join(path.read_text() for path in Path("apps/verification").rglob("*.py"))
        assert "apps.accounts" not in source and "get_user_model" not in source

    def test_no_public_otp_or_auth_endpoints_exist_yet(self, client):
        for path in (
            "/api/v1/auth/otp/request/",
            "/api/v1/auth/otp/verify/",
            "/api/v1/auth/login/",
        ):
            assert client.post(path, {}, content_type="application/json").status_code == 404


class TestUserVerificationFlag:
    def test_is_mobile_verified_defaults_to_false(self):
        from apps.accounts.models import User

        student = User.objects.create_user(MOBILE, password="Test-Pass-91", full_name="S")
        admin = User.objects.create_superuser("01812345678", "Test-Pass-91", full_name="A")
        assert student.is_mobile_verified is False
        assert admin.is_mobile_verified is False

    def test_otp_activity_does_not_mark_the_user_verified(self, request_code):
        from apps.accounts.models import User

        user = User.objects.create_user(MOBILE, password="Test-Pass-91", full_name="S")
        services.verify_otp(MOBILE, REG, request_code())
        user.refresh_from_db()
        assert user.is_mobile_verified is False


# ======================================================================================
# Configuration & migrations
# ======================================================================================
class TestConfigurationChecks:
    def run_checks(self):
        from apps.verification.checks import check_otp_settings

        return [e.id for e in check_otp_settings(None)]

    def test_default_configuration_is_valid(self):
        assert self.run_checks() == []

    @pytest.mark.parametrize(
        ("name", "value"),
        [
            ("OTP_LENGTH", 4),
            ("OTP_LENGTH", 11),
            ("OTP_TTL_SECONDS", 0),
            ("OTP_MAX_ATTEMPTS", 0),
            ("OTP_MAX_ATTEMPTS", 50),
            ("OTP_REQUEST_LIMIT", 0),
            ("OTP_REQUEST_WINDOW_SECONDS", 0),
            ("OTP_IP_REQUEST_LIMIT", 0),
            ("OTP_IP_REQUEST_WINDOW_SECONDS", 0),
            ("VERIFICATION_TOKEN_TTL_SECONDS", 0),
            ("OTP_RESEND_COOLDOWN_SECONDS", -1),
        ],
    )
    def test_out_of_range_values_are_rejected(self, settings, name, value):
        setattr(settings, name, value)
        assert "verification.E001" in self.run_checks()

    @override_settings(OTP_RESEND_COOLDOWN_SECONDS=300, OTP_TTL_SECONDS=300)
    def test_cooldown_must_be_shorter_than_expiry(self):
        assert "verification.E002" in self.run_checks()

    @override_settings(DEBUG=False, SMS_MOCK_LOG_CONTENT=True)
    def test_content_logging_flag_without_debug_is_flagged(self):
        assert "verification.W001" in self.run_checks()

    @override_settings(SMS_PROVIDER="nope")
    def test_unknown_provider_is_reported(self):
        assert "verification.E004" in self.run_checks()


class TestProductionSafety:
    GOOD = {
        "secret_key": "x" * 60,
        "debug": False,
        "allowed_hosts": ["api.example.com"],
        "db_password": "a-real-password",
    }

    def test_mock_sms_is_refused_in_production(self):
        from config.settings.checks import validate_production_settings

        with pytest.raises(ImproperlyConfigured, match="SMS_PROVIDER=mock"):
            validate_production_settings(**self.GOOD, sms_provider="mock")

    def test_mock_sms_only_with_explicit_permission(self):
        from config.settings.checks import validate_production_settings

        validate_production_settings(**self.GOOD, sms_provider="mock", allow_mock_sms=True)

    def test_production_settings_force_content_logging_off(self):
        source = Path("config/settings/prod.py").read_text()
        assert "SMS_MOCK_LOG_CONTENT = False" in source


class TestMigrations:
    loader = MigrationLoader(None, ignore_no_migrations=True)

    def test_verification_migration_is_independent_of_users(self):
        migration = self.loader.disk_migrations[("verification", "0001_initial")]
        assert migration.dependencies == []

    def test_accounts_history_stays_linear(self):
        migration = self.loader.disk_migrations[("accounts", "0002_user_is_mobile_verified")]
        assert migration.dependencies == [("accounts", "0001_initial")]
        assert self.loader.graph.leaf_nodes("accounts") == [
            ("accounts", "0002_user_is_mobile_verified")
        ]

    def test_tables_exist_and_auth_user_does_not(self):
        tables = connection.introspection.table_names()
        assert {"verification_otpcode", "verification_verificationtoken"} <= set(tables)
        assert "auth_user" not in tables


# ======================================================================================
# Redis failure: requesting fails closed, verification keeps working
# ======================================================================================
class TestRedisFailure:
    @pytest.fixture
    def redis_down(self):
        from redis.exceptions import ConnectionError as RedisConnectionError

        broken = mock.Mock(side_effect=RedisConnectionError("Redis is down"))
        with (
            mock.patch("apps.verification.ratelimit.cache.add", broken),
            mock.patch("apps.verification.ratelimit.cache.incr", broken),
        ):
            yield

    @pytest.mark.parametrize("ip", ["198.51.100.1", None])
    def test_requests_are_refused_not_unlimited(self, redis_down, ip):
        with pytest.raises(OtpServiceUnavailable) as exc:
            services.request_otp(MOBILE, REG, request_ip=ip)
        assert exc.value.code == "otp_unavailable" and exc.value.retry_after == 30
        assert OtpCode.objects.count() == 0
        assert MockSmsProvider.outbox == []

    def test_cooldown_and_number_limit_also_fail_closed(self, settings):
        from redis.exceptions import ConnectionError as RedisConnectionError

        # IP check skipped (no IP) and only the later Redis steps break.
        with (
            mock.patch(
                "apps.verification.ratelimit.cache.add",
                side_effect=RedisConnectionError("down"),
            ),
            pytest.raises(OtpServiceUnavailable),
        ):
            services.request_otp(MOBILE, REG)
        settings.OTP_RESEND_COOLDOWN_SECONDS = 0  # skip the cooldown claim
        with (
            mock.patch(
                "apps.verification.ratelimit.cache.incr",
                side_effect=RedisConnectionError("down"),
            ),
            pytest.raises(OtpServiceUnavailable),
        ):
            services.request_otp(MOBILE, REG)
        assert OtpCode.objects.count() == 0

    def test_verify_and_consume_work_while_redis_is_down(self, request_code):
        from redis.exceptions import ConnectionError as RedisConnectionError

        code = request_code()
        broken = mock.Mock(side_effect=RedisConnectionError("down"))
        with (
            mock.patch("django.core.cache.cache.add", broken),
            mock.patch("django.core.cache.cache.incr", broken),
            mock.patch("django.core.cache.cache.get", broken),
        ):
            token = services.verify_otp(MOBILE, REG, code).verification_token
            assert services.consume_verification_token(token, MOBILE, REG) == E164


# ======================================================================================
# Concurrency of the abuse limits (real threads, real PostgreSQL transactions)
# ======================================================================================
def _run_concurrently(target, count):
    barrier = threading.Barrier(count)
    outcomes = []

    def run(index):
        try:
            barrier.wait()
            target(index)
            outcomes.append("ok")
        except (OtpResendCooldown, OtpRateLimited) as exc:
            outcomes.append(exc.code)
        finally:
            connection.close()

    threads = [threading.Thread(target=run, args=(i,)) for i in range(count)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return outcomes


@pytest.mark.django_db(transaction=True)
def test_simultaneous_requests_cannot_bypass_the_cooldown():
    outcomes = _run_concurrently(lambda i: services.request_otp(MOBILE, REG), 6)
    assert outcomes.count("ok") == 1
    assert outcomes.count("otp_resend_cooldown") == 5
    assert OtpCode.objects.count() == 1


@pytest.mark.django_db(transaction=True)
def test_simultaneous_requests_cannot_bypass_the_number_limit(settings):
    settings.OTP_REQUEST_LIMIT = 3
    settings.OTP_RESEND_COOLDOWN_SECONDS = 0  # worst case: no cooldown to serialize requests
    purposes = [REG, RESET]
    outcomes = _run_concurrently(lambda i: services.request_otp(MOBILE, purposes[i % 2]), 8)
    assert outcomes.count("ok") == 3
    assert outcomes.count("otp_rate_limited") == 5
    assert OtpCode.objects.count() == 3


def test_unavailable_message_is_translated():
    with translation.override("bn"):
        assert str(OtpServiceUnavailable().message).startswith("এই মুহূর্তে কোড পাঠানো যাচ্ছে না")
    with translation.override("en"):
        assert str(OtpServiceUnavailable().message).startswith("Codes cannot be sent right now")
