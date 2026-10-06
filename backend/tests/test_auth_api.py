"""Milestone 2C — authentication API (student accounts)."""

import logging
import re
import threading
from unittest import mock

import jwt
import pytest
from django.core.cache import cache
from django.db import connection
from django.db.migrations.loader import MigrationLoader
from django.test import Client, RequestFactory
from django.utils import translation
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

from apps.accounts.models import Role, StudentProfile, User
from apps.core.net import get_client_ip
from apps.core.throttling import SecurityThrottle
from apps.verification.models import OtpCode, VerificationToken
from apps.verification.sms.mock import MockSmsProvider

pytestmark = pytest.mark.django_db

MOBILE = "01712345678"
E164 = "+8801712345678"
OTHER = "01812345678"
PW = "Strong-Pass-2026"  # test-only values
NEW_PW = "Another-Pass-2027"


@pytest.fixture(autouse=True)
def _clean_state():
    cache.clear()
    MockSmsProvider.outbox.clear()
    yield
    cache.clear()
    MockSmsProvider.outbox.clear()


def post(client, path, data=None, token=None, **extra):
    if token:
        extra["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    return client.post(f"/api/v1{path}", data or {}, content_type="application/json", **extra)


def get(client, path, token=None, **extra):
    if token:
        extra["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    return client.get(f"/api/v1{path}", **extra)


def patch(client, path, data, token=None, **extra):
    if token:
        extra["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    return client.patch(f"/api/v1{path}", data, content_type="application/json", **extra)


def last_code():
    return re.search(r"\d{6}", MockSmsProvider.outbox[-1].message).group()


@pytest.fixture
def otp_request(client, django_capture_on_commit_callbacks):
    def _request(mobile=MOBILE, purpose="registration", **extra):
        with django_capture_on_commit_callbacks(execute=True):
            return post(
                client, "/auth/otp/request/", {"mobile_number": mobile, "purpose": purpose}, **extra
            )

    return _request


@pytest.fixture
def verification_token(client, otp_request):
    def _token(mobile=MOBILE, purpose="registration"):
        assert otp_request(mobile, purpose).status_code == 202
        response = post(
            client,
            "/auth/otp/verify/",
            {"mobile_number": mobile, "purpose": purpose, "code": last_code()},
        )
        assert response.status_code == 200, response.content
        return response.json()["verification_token"]

    return _token


@pytest.fixture
def register(client, verification_token):
    def _register(mobile=MOBILE, **fields):
        body = {
            "verification_token": verification_token(mobile),
            "mobile_number": mobile,
            "full_name": "Rahim Uddin",
            "password": PW,
            **fields,
        }
        return post(client, "/auth/register/", body)

    return _register


@pytest.fixture
def student(register):
    """A registered student: returns (response json with user/access/refresh)."""
    response = register()
    assert response.status_code == 201, response.content
    return response.json()


def login(client, mobile=MOBILE, password=PW, **extra):
    return post(client, "/auth/login/", {"mobile_number": mobile, "password": password}, **extra)


# ======================================================================================
# Registration
# ======================================================================================
class TestRegistration:
    def test_happy_path(self, register):
        response = register(email="Rahim@Example.com", preferred_language="en")
        assert response.status_code == 201
        body = response.json()
        assert set(body) == {"user", "access", "refresh"}
        assert body["user"]["mobile_number"] == E164
        assert body["user"]["email"] == "rahim@example.com"
        assert body["user"]["is_mobile_verified"] is True
        user = User.objects.get()
        assert user.role == Role.STUDENT and user.is_mobile_verified
        assert user.check_password(PW) and user.preferred_language == "en"
        assert StudentProfile.objects.filter(user=user).count() == 1

    def test_response_never_contains_secrets_or_flags(self, student):
        assert set(student["user"]) == {
            "id",
            "mobile_number",
            "full_name",
            "email",
            "preferred_language",
            "display_name",
            "is_mobile_verified",
            "date_joined",
        }

    @pytest.mark.parametrize(
        "field, value",
        [
            ("role", "admin"),
            ("is_staff", True),
            ("is_superuser", True),
            ("is_mobile_verified", False),
            ("auth_version", 99),
        ],
    )
    def test_protected_fields_are_rejected(self, client, verification_token, field, value):
        token = verification_token()
        body = {
            "verification_token": token,
            "mobile_number": MOBILE,
            "full_name": "Rahim Uddin",
            "password": PW,
        }
        response = post(client, "/auth/register/", {**body, field: value})
        assert response.status_code == 400
        error = response.json()["error"]
        assert error["code"] == "validation_error" and list(error["field_errors"]) == [field]
        assert not User.objects.exists()
        # The verification token was not consumed: a clean retry still works.
        assert post(client, "/auth/register/", body).status_code == 201

    def test_unknown_harmless_fields_are_ignored(self, register):
        assert register(favourite_colour="blue").status_code == 201

    def test_token_is_consumed_exactly_once(self, client, verification_token):
        token = verification_token()
        body = {
            "verification_token": token,
            "mobile_number": MOBILE,
            "full_name": "A",
            "password": PW,
        }
        assert post(client, "/auth/register/", body).status_code == 201
        again = post(client, "/auth/register/", {**body, "mobile_number": OTHER})
        assert again.status_code == 400
        assert again.json()["error"]["code"] == "verification_token_invalid"
        assert User.objects.count() == 1

    def test_token_must_match_the_mobile_number(self, client, verification_token):
        token = verification_token(MOBILE)
        body = {
            "verification_token": token,
            "mobile_number": OTHER,
            "full_name": "A",
            "password": PW,
        }
        response = post(client, "/auth/register/", body)
        assert response.json()["error"]["code"] == "verification_token_invalid"
        assert VerificationToken.objects.get().used_at is None  # not burned

    def test_password_reset_token_cannot_register(self, client, verification_token):
        User.objects.create_user(MOBILE, password=PW, full_name="A")
        token = verification_token(MOBILE, "password_reset")
        User.objects.all().delete()
        body = {
            "verification_token": token,
            "mobile_number": MOBILE,
            "full_name": "A",
            "password": PW,
        }
        response = post(client, "/auth/register/", body)
        assert response.json()["error"]["code"] == "verification_token_invalid"
        assert User.objects.count() == 0

    def test_weak_password_does_not_burn_the_token(self, client, verification_token):
        token = verification_token()
        body = {"verification_token": token, "mobile_number": MOBILE, "full_name": "A"}
        weak = post(client, "/auth/register/", {**body, "password": "12345678"})
        assert weak.status_code == 400 and "password" in weak.json()["error"]["field_errors"]
        assert post(client, "/auth/register/", {**body, "password": PW}).status_code == 201

    def test_rollback_when_account_creation_fails(self, client, verification_token):
        token = verification_token()
        body = {
            "verification_token": token,
            "mobile_number": MOBILE,
            "full_name": "A",
            "password": PW,
        }
        with mock.patch(
            "apps.accounts.services.tokens.issue_tokens", side_effect=RuntimeError("boom")
        ):
            with pytest.raises(RuntimeError):
                post(client, "/auth/register/", body)
        assert User.objects.count() == 0
        assert VerificationToken.objects.get().used_at is None  # token usable again
        assert post(client, "/auth/register/", body).status_code == 201

    def test_already_registered_number(self, client, student, verification_token, settings):
        settings.OTP_RESEND_COOLDOWN_SECONDS = 0
        token = verification_token(MOBILE)  # the owner can still verify the phone …
        body = {
            "verification_token": token,
            "mobile_number": MOBILE,
            "full_name": "B",
            "password": PW,
        }
        response = post(client, "/auth/register/", body)
        # … and only then learns the account exists.
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "account_exists"
        assert User.objects.count() == 1

    def test_duplicate_email_case_insensitive(self, register):
        assert register(MOBILE, email="same@example.com").status_code == 201
        response = register(OTHER, email="SAME@Example.COM")
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "email_taken"
        assert "email" in response.json()["error"]["field_errors"]
        assert User.objects.count() == 1

    def test_invalid_mobile_is_a_field_error(self, client):
        response = post(
            client,
            "/auth/register/",
            {"verification_token": "x", "mobile_number": "123", "full_name": "A", "password": PW},
        )
        assert response.status_code == 400
        assert "mobile_number" in response.json()["error"]["field_errors"]


@pytest.mark.django_db(transaction=True)
def test_duplicate_mobile_race_creates_one_account(settings):
    settings.OTP_RESEND_COOLDOWN_SECONDS = 0
    client = Client()
    tokens = []
    for _ in range(2):
        post(client, "/auth/otp/request/", {"mobile_number": MOBILE, "purpose": "registration"})
        verify = post(
            client,
            "/auth/otp/verify/",
            {"mobile_number": MOBILE, "purpose": "registration", "code": last_code()},
        )
        tokens.append(verify.json()["verification_token"])

    barrier = threading.Barrier(2)
    statuses = []

    def register_with(token):
        try:
            barrier.wait()
            response = post(
                Client(),
                "/auth/register/",
                {
                    "verification_token": token,
                    "mobile_number": MOBILE,
                    "full_name": "A",
                    "password": PW,
                },
            )
            statuses.append(response.status_code)
        finally:
            connection.close()

    threads = [threading.Thread(target=register_with, args=(t,)) for t in tokens]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert sorted(statuses) == [201, 409]
    assert User.objects.count() == 1
    assert VerificationToken.objects.filter(used_at__isnull=False).count() == 1  # loser rolled back


# ======================================================================================
# Login
# ======================================================================================
class TestLogin:
    def test_success_with_any_number_format(self, client, student):
        for raw in (MOBILE, "+880 1712-345678", "০১৭১২৩৪৫৬৭৮"):
            response = login(client, raw)
            assert response.status_code == 200
            assert set(response.json()) == {"user", "access", "refresh"}
        assert User.objects.get().last_login is not None

    @pytest.mark.parametrize(
        "case", ["unknown", "wrong_password", "inactive", "admin", "bad_format"]
    )
    def test_every_failure_looks_the_same(self, client, student, case):
        mobile, password = MOBILE, PW
        if case == "unknown":
            mobile = "01999999999"
        elif case == "wrong_password":
            password = "Wrong-Pass-1"
        elif case == "inactive":
            User.objects.filter(mobile_number=E164).update(is_active=False)
        elif case == "admin":
            User.objects.create_superuser("01612345678", PW, full_name="Ops")
            mobile = "01612345678"
        elif case == "bad_format":
            mobile = "not-a-number"
        response = login(client, mobile, password, HTTP_ACCEPT_LANGUAGE="en")
        assert response.status_code == 401
        assert response.json() == {
            "error": {
                "code": "invalid_credentials",
                "message": "The mobile number or password is incorrect.",
            }
        }

    def test_login_is_throttled_per_ip_and_number(self, client, student, settings):
        settings.AUTH_THROTTLE_RATES = {**settings.AUTH_THROTTLE_RATES, "login": "3/hour"}
        for _ in range(3):
            assert login(client, password="wrong").status_code == 401
        blocked = login(client)  # even the right password is throttled now
        assert blocked.status_code == 429
        assert blocked.json()["error"]["code"] == "throttled"
        assert int(blocked["Retry-After"]) > 0
        # Another number from the same IP is not locked out by this throttle.
        assert login(client, OTHER, "x").status_code == 401

    def test_login_ip_throttle(self, client, settings):
        settings.AUTH_THROTTLE_RATES = {**settings.AUTH_THROTTLE_RATES, "login_ip": "2/hour"}
        login(client, "01711111111", "x")
        login(client, "01722222222", "x")
        assert login(client, "01733333333", "x").status_code == 429


# ======================================================================================
# JWT
# ======================================================================================
class TestJwt:
    def test_claims_contain_no_personal_data(self, student):
        for name in ("access", "refresh"):
            claims = jwt.decode(student[name], options={"verify_signature": False})
            assert set(claims) == {"token_type", "exp", "iat", "jti", "user_id", "auth_version"}
            assert claims["auth_version"] == 1
            assert E164 not in student[name] and "Rahim" not in str(claims)

    def test_refresh_tokens_are_not_stored_in_the_database(self, student):
        assert OutstandingToken.objects.count() == 1
        assert OutstandingToken.objects.get().token == ""

    def test_access_token_works(self, client, student):
        response = get(client, "/me/", student["access"])
        assert response.status_code == 200 and response.json()["mobile_number"] == E164

    def test_missing_or_garbage_token_is_rejected(self, client):
        assert get(client, "/me/").status_code == 401
        assert get(client, "/me/", "garbage").status_code == 401

    def test_refresh_rotation(self, client, student):
        response = post(client, "/auth/token/refresh/", {"refresh": student["refresh"]})
        assert response.status_code == 200
        pair = response.json()
        assert set(pair) == {"access", "refresh"} and pair["refresh"] != student["refresh"]
        assert get(client, "/me/", pair["access"]).status_code == 200

    def test_old_refresh_token_is_rejected_after_rotation(self, client, student):
        post(client, "/auth/token/refresh/", {"refresh": student["refresh"]})
        again = post(client, "/auth/token/refresh/", {"refresh": student["refresh"]})
        assert again.status_code == 401
        assert again.json()["error"]["code"] == "token_not_valid"
        assert again["WWW-Authenticate"].startswith("Bearer")

    def test_access_token_cannot_be_used_as_refresh(self, client, student):
        assert (
            post(client, "/auth/token/refresh/", {"refresh": student["access"]}).status_code == 401
        )

    def test_inactive_user_is_rejected_everywhere(self, client, student):
        User.objects.update(is_active=False)
        assert get(client, "/me/", student["access"]).status_code == 401
        assert (
            post(client, "/auth/token/refresh/", {"refresh": student["refresh"]}).status_code == 401
        )

    def test_admin_users_cannot_use_the_student_api(self, client):
        from apps.accounts.tokens import issue_tokens

        admin = User.objects.create_superuser("01612345678", PW, full_name="Ops")
        pair = issue_tokens(admin)  # even if a token were somehow issued
        assert get(client, "/me/", pair["access"]).status_code == 401
        assert post(client, "/auth/token/refresh/", {"refresh": pair["refresh"]}).status_code == 401


@pytest.mark.django_db(transaction=True)
def test_concurrent_refresh_rotates_exactly_once(settings):
    client = Client()
    from apps.accounts.tokens import issue_tokens

    user = User.objects.create_user(MOBILE, password=PW, full_name="A")
    refresh = issue_tokens(user)["refresh"]
    barrier = threading.Barrier(4)
    statuses = []

    def attempt():
        try:
            barrier.wait()
            statuses.append(
                post(Client(), "/auth/token/refresh/", {"refresh": refresh}).status_code
            )
        finally:
            connection.close()

    threads = [threading.Thread(target=attempt) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(statuses) == [200, 401, 401, 401]
    assert client  # keep linter quiet about the unused client


# ======================================================================================
# Logout
# ======================================================================================
class TestLogout:
    def test_logout_blacklists_the_refresh_token(self, client, student):
        response = post(client, "/auth/logout/", {"refresh": student["refresh"]}, student["access"])
        assert response.status_code == 204
        assert BlacklistedToken.objects.count() == 1
        assert (
            post(client, "/auth/token/refresh/", {"refresh": student["refresh"]}).status_code == 401
        )

    def test_cannot_blacklist_another_users_token(self, client, student, register):
        other = register(OTHER).json()
        response = post(client, "/auth/logout/", {"refresh": other["refresh"]}, student["access"])
        assert response.status_code == 401
        assert BlacklistedToken.objects.count() == 0
        assert (
            post(client, "/auth/token/refresh/", {"refresh": other["refresh"]}).status_code == 200
        )

    def test_logout_requires_authentication(self, client, student):
        assert post(client, "/auth/logout/", {"refresh": student["refresh"]}).status_code == 401


# ======================================================================================
# auth_version: immediate revocation
# ======================================================================================
class TestAuthVersion:
    def test_mismatch_rejects_access_and_refresh(self, client, student):
        User.objects.update(auth_version=2)
        assert get(client, "/me/", student["access"]).status_code == 401
        assert (
            post(client, "/auth/token/refresh/", {"refresh": student["refresh"]}).status_code == 401
        )

    def test_password_change_logs_out_every_device_immediately(self, client, student):
        second = login(client).json()  # another device
        response = post(
            client,
            "/auth/password/change/",
            {"current_password": PW, "new_password": NEW_PW},
            student["access"],
        )
        assert response.status_code == 204
        user = User.objects.get()
        assert user.auth_version == 2 and user.check_password(NEW_PW)
        for pair in (student, second):
            assert get(client, "/me/", pair["access"]).status_code == 401  # current one too
            assert (
                post(client, "/auth/token/refresh/", {"refresh": pair["refresh"]}).status_code
                == 401
            )
        assert BlacklistedToken.objects.count() == OutstandingToken.objects.count() == 2
        assert login(client, password=NEW_PW).status_code == 200

    def test_wrong_current_password(self, client, student):
        response = post(
            client,
            "/auth/password/change/",
            {"current_password": "nope", "new_password": NEW_PW},
            student["access"],
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "invalid_current_password"
        assert User.objects.get().auth_version == 1

    def test_weak_new_password_changes_nothing(self, client, student):
        response = post(
            client,
            "/auth/password/change/",
            {"current_password": PW, "new_password": "123"},
            student["access"],
        )
        assert (
            response.status_code == 400
            and "new_password" in response.json()["error"]["field_errors"]
        )
        assert get(client, "/me/", student["access"]).status_code == 200


# ======================================================================================
# Password reset (+ enumeration)
# ======================================================================================
class TestPasswordReset:
    def reset_token(self, client, otp_request):
        assert otp_request(MOBILE, "password_reset").status_code == 202
        response = post(
            client,
            "/auth/otp/verify/",
            {"mobile_number": MOBILE, "purpose": "password_reset", "code": last_code()},
        )
        return response.json()["verification_token"]

    def test_reset_revokes_everything_immediately(self, client, student, otp_request):
        token = self.reset_token(client, otp_request)
        response = post(
            client,
            "/auth/password/reset/",
            {"verification_token": token, "mobile_number": MOBILE, "new_password": NEW_PW},
        )
        assert response.status_code == 204
        user = User.objects.get()
        assert user.auth_version == 2 and user.check_password(NEW_PW)
        assert get(client, "/me/", student["access"]).status_code == 401
        assert (
            post(client, "/auth/token/refresh/", {"refresh": student["refresh"]}).status_code == 401
        )
        assert login(client, password=PW).status_code == 401
        assert login(client, password=NEW_PW).status_code == 200

    def test_reset_token_is_single_use(self, client, student, otp_request):
        token = self.reset_token(client, otp_request)
        body = {"verification_token": token, "mobile_number": MOBILE, "new_password": NEW_PW}
        assert post(client, "/auth/password/reset/", body).status_code == 204
        again = post(client, "/auth/password/reset/", {**body, "new_password": "Third-Pass-2028"})
        assert again.json()["error"]["code"] == "verification_token_invalid"

    def test_weak_password_keeps_the_token_usable(self, client, student, otp_request):
        token = self.reset_token(client, otp_request)
        body = {"verification_token": token, "mobile_number": MOBILE}
        weak = post(client, "/auth/password/reset/", {**body, "new_password": "123"})
        assert weak.status_code == 400 and User.objects.get().auth_version == 1
        assert (
            post(client, "/auth/password/reset/", {**body, "new_password": NEW_PW}).status_code
            == 204
        )

    def test_registration_token_cannot_reset(self, client, student, verification_token, settings):
        settings.OTP_RESEND_COOLDOWN_SECONDS = 0
        token = verification_token(MOBILE, "registration")
        response = post(
            client,
            "/auth/password/reset/",
            {"verification_token": token, "mobile_number": MOBILE, "new_password": NEW_PW},
        )
        assert response.json()["error"]["code"] == "verification_token_invalid"

    @pytest.mark.parametrize("state", ["existing", "unknown", "inactive", "admin"])
    def test_otp_request_is_identical_for_every_account_state(self, client, otp_request, state):
        if state in ("existing", "inactive"):
            User.objects.create_user(
                MOBILE, password=PW, full_name="A", is_active=state == "existing"
            )
        elif state == "admin":
            User.objects.create_superuser(MOBILE, PW, full_name="Ops")
        first = otp_request(MOBILE, "password_reset", HTTP_ACCEPT_LANGUAGE="en")
        second = otp_request(MOBILE, "password_reset", HTTP_ACCEPT_LANGUAGE="en")  # cooldown

        assert first.status_code == 202
        assert first.json() == {
            "detail": "If the details are valid, a verification code will be sent by SMS."
        }
        assert second.status_code == 429
        assert second.json()["error"]["code"] == "otp_resend_cooldown"
        assert second["Retry-After"] == "60"
        sent = len(MockSmsProvider.outbox)
        assert sent == (1 if state == "existing" else 0)  # SMS only for real accounts

    def test_reset_rate_limit_retry_after_is_uniform(self, client, otp_request, settings):
        settings.OTP_RESEND_COOLDOWN_SECONDS = 0
        settings.OTP_REQUEST_LIMIT = 1
        User.objects.create_user(MOBILE, password=PW, full_name="A")
        results = {}
        for mobile in (MOBILE, OTHER):  # existing vs unknown
            otp_request(mobile, "password_reset")
            results[mobile] = otp_request(mobile, "password_reset")
        bodies = [r.json() for r in results.values()]
        assert bodies[0] == bodies[1]
        assert results[MOBILE]["Retry-After"] == results[OTHER]["Retry-After"]

    def test_reset_otp_verify_errors_are_identical(self, client, otp_request):
        User.objects.create_user(MOBILE, password=PW, full_name="A")
        otp_request(MOBILE, "password_reset")
        otp_request(OTHER, "password_reset")  # unknown number: nothing sent
        responses = [
            post(
                client,
                "/auth/otp/verify/",
                {"mobile_number": mobile, "purpose": "password_reset", "code": "000000"},
            )
            for mobile in (MOBILE, OTHER)
        ]
        assert responses[0].status_code == responses[1].status_code == 400
        assert responses[0].json() == responses[1].json()
        assert "attempts_remaining" not in str(responses[0].json())

    def test_reset_for_inactive_account_is_refused(self, client, student, otp_request):
        token = self.reset_token(client, otp_request)
        User.objects.update(is_active=False)
        response = post(
            client,
            "/auth/password/reset/",
            {"verification_token": token, "mobile_number": MOBILE, "new_password": NEW_PW},
        )
        assert response.json()["error"]["code"] == "verification_token_invalid"


class TestRegistrationOtpEnumeration:
    def test_registration_otp_is_sent_whatever_the_account_state(self, otp_request):
        User.objects.create_user(MOBILE, password=PW, full_name="A")
        known = otp_request(MOBILE, "registration")
        unknown = otp_request(OTHER, "registration")
        assert known.status_code == unknown.status_code == 202
        assert known.json() == unknown.json()
        assert len(MockSmsProvider.outbox) == 2  # same behaviour, no hint in the response


# ======================================================================================
# OTP verify error mapping
# ======================================================================================
class TestOtpVerifyMapping:
    def verify(self, client, code, mobile=MOBILE, purpose="registration"):
        return post(
            client,
            "/auth/otp/verify/",
            {"mobile_number": mobile, "purpose": purpose, "code": code},
        )

    def test_wrong_code_reports_attempts_remaining(self, client, otp_request):
        otp_request()
        response = self.verify(client, "000000" if last_code() != "000000" else "111111")
        assert response.status_code == 400
        error = response.json()["error"]
        assert error["code"] == "otp_invalid" and error["details"]["attempts_remaining"] == 4

    def test_lockout_and_expiry_codes(self, client, otp_request, settings):
        settings.OTP_MAX_ATTEMPTS = 1
        otp_request()
        wrong = "000000" if last_code() != "000000" else "111111"
        assert self.verify(client, wrong).json()["error"]["code"] == "otp_locked"

    def test_resend_cooldown_has_retry_after_header(self, otp_request):
        otp_request()
        response = otp_request()
        assert response.status_code == 429
        assert response.json()["error"]["details"]["retry_after"] == int(response["Retry-After"])

    def test_otp_verify_is_throttled(self, client, settings):
        settings.AUTH_THROTTLE_RATES = {**settings.AUTH_THROTTLE_RATES, "otp_verify": "2/hour"}
        for _ in range(2):
            self.verify(client, "123456")
        assert self.verify(client, "123456").status_code == 429


# ======================================================================================
# Client IP & throttling infrastructure
# ======================================================================================
class TestClientIp:
    factory = RequestFactory()

    def test_forwarded_header_is_ignored_by_default(self, settings):
        settings.TRUSTED_PROXY_COUNT = 0
        request = self.factory.get("/", REMOTE_ADDR="10.0.0.5", HTTP_X_FORWARDED_FOR="1.2.3.4")
        assert get_client_ip(request) == "10.0.0.5"

    def test_one_trusted_proxy(self, settings):
        settings.TRUSTED_PROXY_COUNT = 1
        request = self.factory.get(
            "/", REMOTE_ADDR="10.0.0.5", HTTP_X_FORWARDED_FOR="6.6.6.6, 203.0.113.9"
        )
        assert get_client_ip(request) == "203.0.113.9"  # the client-supplied 6.6.6.6 is ignored

    def test_two_trusted_proxies(self, settings):
        settings.TRUSTED_PROXY_COUNT = 2
        request = self.factory.get(
            "/", REMOTE_ADDR="10.0.0.5", HTTP_X_FORWARDED_FOR="6.6.6.6, 203.0.113.9, 172.16.0.1"
        )
        assert get_client_ip(request) == "203.0.113.9"

    def test_short_or_invalid_header_falls_back(self, settings):
        settings.TRUSTED_PROXY_COUNT = 2
        assert (
            get_client_ip(
                self.factory.get("/", REMOTE_ADDR="10.0.0.5", HTTP_X_FORWARDED_FOR="1.1.1.1")
            )
            == "10.0.0.5"
        )
        assert (
            get_client_ip(
                self.factory.get("/", REMOTE_ADDR="10.0.0.5", HTTP_X_FORWARDED_FOR="x, y")
            )
            == "10.0.0.5"
        )

    def test_spoofed_header_cannot_bypass_throttles(self, client, settings):
        settings.TRUSTED_PROXY_COUNT = 0
        settings.AUTH_THROTTLE_RATES = {**settings.AUTH_THROTTLE_RATES, "login_ip": "2/hour"}
        for i in range(2):
            login(client, f"0171111111{i}", "x", HTTP_X_FORWARDED_FOR=f"9.9.9.{i}")
        blocked = login(client, "01711111119", "x", HTTP_X_FORWARDED_FOR="9.9.9.99")
        assert blocked.status_code == 429

    def test_otp_request_ip_comes_from_the_safe_helper(self, otp_request, settings):
        settings.TRUSTED_PROXY_COUNT = 0
        otp_request(HTTP_X_FORWARDED_FOR="9.9.9.9")
        assert OtpCode.objects.get().request_ip == "127.0.0.1"


class TestThrottleFailure:
    def test_security_throttles_fail_closed(self, client):
        from redis.exceptions import ConnectionError as RedisConnectionError

        broken = mock.Mock()
        broken.get.side_effect = RedisConnectionError("down")
        with mock.patch.object(SecurityThrottle, "cache", broken):
            response = login(client)
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "temporarily_unavailable"

    def test_otp_request_fails_closed_without_redis(self, client):
        from redis.exceptions import ConnectionError as RedisConnectionError

        with mock.patch(
            "apps.verification.ratelimit.cache.add", side_effect=RedisConnectionError("down")
        ):
            response = post(
                client, "/auth/otp/request/", {"mobile_number": MOBILE, "purpose": "registration"}
            )
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "otp_unavailable"
        assert response["Retry-After"] == "30"


# ======================================================================================
# Profile
# ======================================================================================
class TestProfile:
    def test_get_me(self, client, student):
        body = get(client, "/me/", student["access"]).json()
        assert body["mobile_number"] == E164 and body["display_name"] == ""
        for hidden in ("password", "role", "is_staff", "is_superuser", "auth_version"):
            assert hidden not in body

    def test_patch_allowed_fields(self, client, student):
        response = patch(
            client,
            "/me/",
            {
                "full_name": "  Karim  ",
                "email": "Karim@Example.com",
                "preferred_language": "en",
                "display_name": "Star",
            },
            student["access"],
        )
        assert response.status_code == 200
        body = response.json()
        assert body["full_name"] == "Karim" and body["email"] == "karim@example.com"
        assert body["preferred_language"] == "en" and body["display_name"] == "Star"

    @pytest.mark.parametrize(
        "field, value",
        [
            ("mobile_number", "01999999999"),
            ("password", "Hacked-Pass-1"),
            ("role", "admin"),
            ("is_staff", True),
            ("is_superuser", True),
            ("is_mobile_verified", False),
            ("auth_version", 50),
        ],
    )
    def test_protected_fields_are_rejected(self, client, student, field, value):
        response = patch(client, "/me/", {"full_name": "Changed", field: value}, student["access"])
        assert response.status_code == 400
        error = response.json()["error"]
        assert error["code"] == "validation_error" and list(error["field_errors"]) == [field]
        user = User.objects.get()  # nothing changed, not even the allowed field
        assert user.full_name == "Rahim Uddin" and user.mobile_number == E164
        assert user.role == Role.STUDENT and not user.is_staff and not user.is_superuser
        assert user.is_mobile_verified and user.auth_version == 1 and user.check_password(PW)
        assert get(client, "/me/", student["access"]).status_code == 200

    def test_unknown_harmless_fields_are_ignored(self, client, student):
        response = patch(client, "/me/", {"full_name": "Karim", "nickname": "x"}, student["access"])
        assert response.status_code == 200 and response.json()["full_name"] == "Karim"

    def test_email_must_stay_unique_case_insensitive(self, client, student, register):
        register(OTHER, email="taken@example.com")
        response = patch(client, "/me/", {"email": "TAKEN@example.com"}, student["access"])
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "email_taken"

    def test_email_can_be_removed(self, client, student):
        patch(client, "/me/", {"email": "a@example.com"}, student["access"])
        assert patch(client, "/me/", {"email": ""}, student["access"]).json()["email"] is None

    def test_invalid_language_is_rejected(self, client, student):
        response = patch(client, "/me/", {"preferred_language": "fr"}, student["access"])
        assert response.status_code == 400

    def test_requires_authentication(self, client):
        assert get(client, "/me/").status_code == 401
        assert patch(client, "/me/", {"full_name": "X"}).status_code == 401


# ======================================================================================
# Language
# ======================================================================================
class TestLanguage:
    def test_authenticated_users_language_is_used_by_default(self, client, student):
        patch(client, "/me/", {"preferred_language": "en"}, student["access"])
        response = get(client, "/me/", student["access"])
        assert response["Content-Language"] == "en"

    def test_explicit_request_language_wins(self, client, student):
        patch(client, "/me/", {"preferred_language": "en"}, student["access"])
        response = get(client, "/me/", student["access"], HTTP_ACCEPT_LANGUAGE="bn")
        assert response["Content-Language"] == "bn"

    def test_platform_default_for_anonymous_requests(self, client):
        assert login(client, "01999999999", "x")["Content-Language"] == "bn"

    def test_api_messages_in_bangla_and_english(self, client):
        bangla = login(client, "01999999999", "x", HTTP_ACCEPT_LANGUAGE="bn").json()["error"]
        english = login(client, "01999999999", "x", HTTP_ACCEPT_LANGUAGE="en").json()["error"]
        assert bangla["code"] == english["code"] == "invalid_credentials"
        assert bangla["message"] != english["message"]
        assert re.search(r"[ঀ-৿]", bangla["message"])

    def test_user_language_applies_to_error_messages(self, client, student):
        patch(client, "/me/", {"preferred_language": "en"}, student["access"])
        response = post(
            client,
            "/auth/password/change/",
            {"current_password": "nope", "new_password": NEW_PW},
            student["access"],
        )
        assert response.json()["error"]["message"] == "Your current password is incorrect."


# ======================================================================================
# Security: logs, migrations
# ======================================================================================
def test_no_secrets_or_full_numbers_in_logs(client, verification_token, caplog):
    with caplog.at_level(logging.DEBUG):
        token = verification_token()
        registered = post(
            client,
            "/auth/register/",
            {
                "verification_token": token,
                "mobile_number": MOBILE,
                "full_name": "A",
                "password": PW,
            },
        ).json()
        login(client)
        login(client, password="Wrong-Pass-9")
        post(client, "/auth/token/refresh/", {"refresh": registered["refresh"]})
    text = caplog.text
    for secret in (PW, "Wrong-Pass-9", token, registered["access"], registered["refresh"], E164):
        assert secret not in text


def test_auth_version_migration():
    loader = MigrationLoader(None, ignore_no_migrations=True)
    migration = loader.disk_migrations[("accounts", "0003_user_auth_version")]
    assert migration.dependencies == [("accounts", "0002_user_is_mobile_verified")]
    tables = connection.introspection.table_names()
    assert {"token_blacklist_outstandingtoken", "token_blacklist_blacklistedtoken"} <= set(tables)
    assert "auth_user" not in tables


def test_jwt_signing_key_deploy_check(settings):
    from apps.accounts.checks import check_jwt_signing_key

    settings.SIMPLE_JWT = {**settings.SIMPLE_JWT, "SIGNING_KEY": "short"}
    assert [e.id for e in check_jwt_signing_key(None)] == ["accounts.E001"]
    settings.SIMPLE_JWT = {**settings.SIMPLE_JWT, "SIGNING_KEY": settings.SECRET_KEY * 5}
    settings.SECRET_KEY = settings.SECRET_KEY * 5
    assert [e.id for e in check_jwt_signing_key(None)] == ["accounts.E002"]


def test_production_requires_a_strong_separate_jwt_key():
    from django.core.exceptions import ImproperlyConfigured

    from config.settings.checks import validate_production_settings

    good = {
        "secret_key": "s" * 60,
        "debug": False,
        "allowed_hosts": ["api.example.com"],
        "db_password": "a-real-password",
        "sms_provider": "real-sms-gateway",
        "jwt_signing_key": "j" * 64,
    }
    validate_production_settings(**good)
    for bad in ("", "short", "dev-only-insecure-jwt-key-do-not-use-in-production", "s" * 60):
        with pytest.raises(ImproperlyConfigured, match="JWT_SIGNING_KEY"):
            validate_production_settings(**{**good, "jwt_signing_key": bad})


def test_translation_of_new_messages():
    from apps.accounts.exceptions import InvalidCredentials

    with translation.override("bn"):
        assert re.search(r"[ঀ-৿]", str(InvalidCredentials().message))


def test_account_exists_message_is_translated():
    from apps.accounts.exceptions import AccountExists

    with translation.override("bn"):
        assert str(AccountExists().message).startswith("এই মোবাইল নম্বরে ইতিমধ্যে")


# ======================================================================================
# Final security review: worker-side reset delivery, JTI-only storage, token integrity
# ======================================================================================
class TestPasswordResetDelivery:
    def test_request_does_no_account_work_and_masks_task_arguments(self, client):
        User.objects.create_user(MOBILE, password=PW, full_name="A")
        with mock.patch("apps.accounts.api.views.deliver_password_reset_otp") as task:
            response = post(
                client, "/auth/otp/request/", {"mobile_number": MOBILE, "purpose": "password_reset"}
            )
        assert response.status_code == 202
        assert not OtpCode.objects.exists()  # nothing created in the web request
        (call,) = task.apply_async.call_args_list
        assert call.kwargs["args"][0] == E164
        assert E164 not in call.kwargs["argsrepr"] and "127.0.0.1" not in call.kwargs["argsrepr"]

    @pytest.mark.parametrize(
        "state, expected", [("student", "issued"), ("unknown", "skipped"), ("inactive", "skipped")]
    )
    def test_task_issues_only_for_active_students(
        self, state, expected, django_capture_on_commit_callbacks
    ):
        from apps.accounts.tasks import deliver_password_reset_otp

        if state != "unknown":
            User.objects.create_user(
                MOBILE, password=PW, full_name="A", is_active=state == "student"
            )
        with django_capture_on_commit_callbacks(execute=True):
            result = deliver_password_reset_otp(E164, "en", "203.0.113.9")
        assert result == expected
        assert OtpCode.objects.count() == len(MockSmsProvider.outbox) == (expected == "issued")

    def test_task_skips_admin_accounts(self):
        from apps.accounts.tasks import deliver_password_reset_otp

        User.objects.create_superuser(MOBILE, PW, full_name="Ops")
        assert deliver_password_reset_otp(E164, "en") == "skipped"
        assert not OtpCode.objects.exists()


class TestJtiOnlyStorage:
    def test_no_flow_ever_stores_a_token(self, client, student):
        pair = post(client, "/auth/token/refresh/", {"refresh": student["refresh"]}).json()
        second = login(client).json()
        post(client, "/auth/logout/", {"refresh": second["refresh"]}, pair["access"])
        post(
            client,
            "/auth/password/change/",
            {"current_password": PW, "new_password": NEW_PW},
            pair["access"],
        )
        assert OutstandingToken.objects.count() == 3
        assert set(OutstandingToken.objects.values_list("token", flat=True)) == {""}
        assert BlacklistedToken.objects.count() == 3

    def test_flushexpiredtokens_works_with_blank_tokens(self, student):
        from datetime import timedelta

        from django.core.management import call_command
        from django.utils import timezone

        from apps.accounts.tokens import issue_tokens, revoke_all_refresh_tokens

        user = User.objects.get()
        issue_tokens(user)
        revoke_all_refresh_tokens(user)  # blacklist rows reference outstanding rows
        OutstandingToken.objects.filter(pk=OutstandingToken.objects.first().pk).update(
            expires_at=timezone.now() - timedelta(days=1)
        )
        call_command("flushexpiredtokens")
        assert OutstandingToken.objects.count() == 1
        assert BlacklistedToken.objects.count() == 1

    def test_django_admin_pages_load(self, client, student):
        from apps.accounts.tokens import revoke_all_refresh_tokens

        revoke_all_refresh_tokens(User.objects.get())
        admin = User.objects.create_superuser("01612345678", PW, full_name="Ops")
        client.force_login(admin)
        outstanding = OutstandingToken.objects.get()
        for url in (
            "/django-admin/token_blacklist/outstandingtoken/",
            f"/django-admin/token_blacklist/outstandingtoken/{outstanding.pk}/change/",
            "/django-admin/token_blacklist/blacklistedtoken/",
            f"/django-admin/token_blacklist/blacklistedtoken/{BlacklistedToken.objects.get().pk}/change/",
        ):
            assert client.get(url).status_code == 200, url


class TestTokenIntegrity:
    def test_token_signed_with_another_key_is_rejected(self, client, student):
        claims = jwt.decode(student["access"], options={"verify_signature": False})
        forged = jwt.encode(claims, "x" * 64, algorithm="HS256")
        assert get(client, "/me/", forged).status_code == 401
        refresh_claims = jwt.decode(student["refresh"], options={"verify_signature": False})
        forged_refresh = jwt.encode(refresh_claims, "x" * 64, algorithm="HS256")
        assert post(client, "/auth/token/refresh/", {"refresh": forged_refresh}).status_code == 401

    def test_tampered_user_id_is_rejected(self, client, student, register):
        import base64
        import json

        other = register(OTHER).json()["user"]["id"]
        header, payload, signature = student["access"].split(".")
        claims = json.loads(base64.urlsafe_b64decode(payload + "=="))
        claims["user_id"] = other
        tampered_payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=")
        tampered = f"{header}.{tampered_payload.decode()}.{signature}"
        assert get(client, "/me/", tampered).status_code == 401

    def test_rotated_tokens_keep_the_same_owner(self, client, student):
        pair = post(client, "/auth/token/refresh/", {"refresh": student["refresh"]}).json()
        for name in ("access", "refresh"):
            original = jwt.decode(student[name], options={"verify_signature": False})
            rotated = jwt.decode(pair[name], options={"verify_signature": False})
            assert rotated["user_id"] == original["user_id"] == User.objects.get().pk
            assert rotated["auth_version"] == 1


class TestClientIpEdgeCases:
    factory = RequestFactory()

    @pytest.mark.parametrize(
        "header", ["", " , ", "not-an-ip", "203.0.113.9:443", "6.6.6.6, garbage"]
    )
    def test_missing_or_malformed_header_falls_back_to_remote_addr(self, settings, header):
        settings.TRUSTED_PROXY_COUNT = 1
        request = self.factory.get("/", REMOTE_ADDR="10.0.0.5", HTTP_X_FORWARDED_FOR=header)
        assert get_client_ip(request) == "10.0.0.5"

    def test_spoofed_left_entries_are_ignored(self, settings):
        settings.TRUSTED_PROXY_COUNT = 1
        for spoof in ("1.1.1.1", "1.1.1.1, 2.2.2.2, 3.3.3.3"):
            request = self.factory.get(
                "/", REMOTE_ADDR="10.0.0.5", HTTP_X_FORWARDED_FOR=f"{spoof}, 198.51.100.7"
            )
            assert get_client_ip(request) == "198.51.100.7"

    def test_ipv6_is_supported(self, settings):
        settings.TRUSTED_PROXY_COUNT = 1
        request = self.factory.get("/", REMOTE_ADDR="::1", HTTP_X_FORWARDED_FOR="2001:db8::1")
        assert get_client_ip(request) == "2001:db8::1"
        settings.TRUSTED_PROXY_COUNT = 0
        assert get_client_ip(request) == "::1"


def test_protected_field_message_is_translated():
    with translation.override("bn"):
        assert re.search(r"[ঀ-৿]", str(translation.gettext("This field cannot be set.")))
