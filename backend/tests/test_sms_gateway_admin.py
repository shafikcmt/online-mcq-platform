"""Admin-controlled SMS gateway: API safety, validation, encrypted key, generic gateway, tests."""

import itertools
import json
from unittest import mock

import pytest
from cryptography.fernet import Fernet
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.audit.models import AuditLog
from apps.verification.models import SmsGatewaySettings
from apps.verification.sms import SmsDeliveryError, SmsRejectedError, get_sms_provider
from apps.verification.sms.http_gateway import HttpGatewayProvider, format_number

pytestmark = pytest.mark.django_db

KEY = Fernet.generate_key().decode()
SECRET = "ABCDEFGH-secret-key-9876"
URL = "https://sms.example-gateway.net/api/send"
GOOD_TEMPLATE = {
    "api_key": "{api_key}",
    "senderid": "{sender_id}",
    "number": "{number}",
    "message": "{message}",
}
_numbers = itertools.count(1)


@pytest.fixture(autouse=True)
def _env(settings):
    settings.SECRET_ENCRYPTION_KEY = KEY
    cache.clear()
    yield
    cache.clear()


def make_user(role):
    return User.objects.create_user(
        f"0171{next(_numbers):07d}", password="Strong-Pass-2026", full_name="Ops", role=role
    )


@pytest.fixture
def api():
    client = APIClient()
    client.force_login(make_user(Role.ADMIN))
    return client


def save(api, **body):
    return api.patch("/api/v1/admin/sms/gateway/", body, format="json")


def valid_body(**extra):
    body = {
        "api_url": URL,
        "sender_id": "MCQ",
        "request_template": GOOD_TEMPLATE,
        "success_codes": ["202"],
        "retry_codes": ["1005"],
        "code_field": "response_code",
    }
    body.update(extra)
    return body


class TestAdminAccess:
    def test_students_and_anonymous_are_refused(self):
        student = APIClient()
        student.force_login(make_user(Role.STUDENT))
        assert student.get("/api/v1/admin/sms/gateway/").status_code == 403
        assert APIClient().get("/api/v1/admin/sms/gateway/").status_code in (401, 403)


class TestSecretHandling:
    def test_key_is_saved_encrypted_and_never_returned(self, api):
        response = save(api, api_key=SECRET, **valid_body())
        assert response.status_code == 200
        assert SECRET not in json.dumps(response.data)
        assert response.data["has_api_key"] and response.data["api_key_hint"] == "9876"
        row = SmsGatewaySettings.objects.get(pk=1)
        assert SECRET not in row.api_key_encrypted
        assert SECRET not in api.get("/api/v1/admin/sms/gateway/").content.decode()

    def test_audit_never_contains_the_key(self, api):
        save(api, api_key=SECRET, **valid_body())
        entries = list(AuditLog.objects.filter(action="sms_gateway.update"))
        assert entries, "the change must be audited"
        assert all(SECRET not in json.dumps(e.metadata) for e in entries)

    def test_empty_key_keeps_the_stored_one_and_clear_removes_it(self, api):
        save(api, api_key=SECRET, **valid_body())
        before = SmsGatewaySettings.objects.get(pk=1).api_key_encrypted
        save(api, api_key="", sender_id="MCQ2")
        assert SmsGatewaySettings.objects.get(pk=1).api_key_encrypted == before
        response = save(api, clear_api_key=True)
        assert response.data["has_api_key"] is False

    def test_refuses_to_store_a_key_without_the_encryption_key(self, api, settings):
        settings.SECRET_ENCRYPTION_KEY = ""
        response = save(api, api_key=SECRET, **valid_body())
        assert response.status_code == 400
        assert not SmsGatewaySettings.objects.filter(api_key_encrypted__contains="x").exists()

    def test_key_shape_is_checked(self, api):
        assert save(api, api_key="short", **valid_body()).status_code == 400
        assert save(api, api_key="has spaces in it 123", **valid_body()).status_code == 400


class TestUrlAndTemplateSafety:
    @pytest.mark.parametrize(
        "url",
        [
            "http://sms.example-gateway.net/api",  # plain HTTP
            "https://10.0.0.5/api",  # private IP literal
            "https://127.0.0.1/api",  # loopback IP
            "https://localhost/api",  # localhost
            "https://user:pass@sms.example-gateway.net/",  # credentials in URL
            "https://intranet/api",  # no dot: not a public host
        ],
    )
    def test_unsafe_urls_are_refused(self, api, url):
        response = save(api, api_key=SECRET, **valid_body(api_url=url))
        assert response.status_code == 400

    def test_template_must_carry_number_and_message(self, api):
        bad = {"api_key": "{api_key}", "message": "{message}"}
        assert save(api, api_key=SECRET, **valid_body(request_template=bad)).status_code == 400

    def test_unknown_placeholder_is_refused(self, api):
        bad = dict(GOOD_TEMPLATE, extra="{password}")
        assert save(api, api_key=SECRET, **valid_body(request_template=bad)).status_code == 400

    def test_codes_must_be_numeric(self, api):
        assert save(api, api_key=SECRET, **valid_body(success_codes=["ok"])).status_code == 400

    def test_unknown_fields_are_refused(self, api):
        assert save(api, api_key=SECRET, **valid_body(is_admin=True)).status_code == 400

    def test_cannot_enable_without_a_key(self, api):
        response = save(api, enabled=True, **valid_body())
        assert response.status_code == 400


class TestGenericGateway:
    def configure(self, api):
        save(api, api_key=SECRET, enabled=True, **valid_body())

    def test_enabled_gateway_becomes_the_runtime_provider(self, api, settings):
        settings.SMS_PROVIDER = "mock"
        self.configure(api)
        assert isinstance(get_sms_provider(), HttpGatewayProvider)

    def test_disabled_gateway_keeps_the_environment_provider(self, api, settings):
        settings.SMS_PROVIDER = "mock"
        save(api, api_key=SECRET, enabled=False, **valid_body())
        assert get_sms_provider().name == "mock"

    def test_request_body_is_filled_and_key_goes_only_to_the_saved_url(self, api):
        self.configure(api)
        cm = mock.MagicMock()
        cm.__enter__.return_value.read.return_value = (
            b'{"response_code": "202", "message_id": "m1"}'
        )
        with mock.patch(
            "apps.verification.sms.http_gateway._OPENER.open", return_value=cm
        ) as opened:
            result = get_sms_provider().send("+8801712345678", "code 123456")
        request = opened.call_args.args[0]
        assert request.full_url == URL
        sent = json.loads(request.data.decode())
        assert sent == {
            "api_key": SECRET,
            "senderid": "MCQ",
            "number": "8801712345678",
            "message": "code 123456",
        }
        assert result.message_id == "m1"

    def test_success_retry_and_rejection_by_code(self, api):
        self.configure(api)

        def reply(payload):
            cm = mock.MagicMock()
            cm.__enter__.return_value.read.return_value = json.dumps(payload).encode()
            return mock.patch("apps.verification.sms.http_gateway._OPENER.open", return_value=cm)

        with reply({"response_code": "1005"}), pytest.raises(SmsDeliveryError):
            get_sms_provider().send("+8801712345678", "x")
        with reply({"response_code": "1032"}), pytest.raises(SmsRejectedError):
            get_sms_provider().send("+8801712345678", "x")

    def test_redirects_are_not_followed(self):
        from apps.verification.sms.http_gateway import _NoRedirect

        assert _NoRedirect().redirect_request(None, None, 302, "Found", {}, "https://evil") is None

    @pytest.mark.parametrize(
        "fmt,expected",
        [
            ("with_plus", "+8801712345678"),
            ("without_plus", "8801712345678"),
            ("local", "01712345678"),
        ],
    )
    def test_number_formats(self, fmt, expected):
        assert format_number("+8801712345678", fmt) == expected


class TestTestSms:
    def test_rate_limited_per_hour(self, api, settings):
        settings.SMS_PROVIDER = "mock"
        codes = [
            api.post("/api/v1/admin/sms/test/", {"phone": "01712345678"}, format="json").status_code
            for _ in range(6)
        ]
        assert codes[:5] == [200] * 5 and codes[5] == 422

    def test_invalid_number_is_refused(self, api):
        response = api.post("/api/v1/admin/sms/test/", {"phone": "12345"}, format="json")
        assert response.status_code == 400

    def test_presets_are_available(self, api):
        assert "bulksmsbd" in api.get("/api/v1/admin/sms/presets/").data
