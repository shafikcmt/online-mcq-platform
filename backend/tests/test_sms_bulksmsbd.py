"""BulkSMSBD adapter: response-code mapping, secrets, HTTPS-only, provider registration."""

import json
import urllib.error
from unittest import mock

import pytest
from django.core.exceptions import ImproperlyConfigured
from django.test import override_settings

from apps.verification.sms import SmsDeliveryError, SmsRejectedError, get_sms_provider
from apps.verification.sms.bulksmsbd import RESPONSE_MEANINGS, BulkSmsBdProvider

KEY = "test-key-never-logged-123"
URLOPEN = "apps.verification.sms.bulksmsbd.urllib.request.urlopen"


def fake_response(raw: bytes):
    cm = mock.MagicMock()
    cm.__enter__.return_value.read.return_value = raw
    return cm


def reply(payload):
    raw = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
    return mock.patch(URLOPEN, return_value=fake_response(raw))


@pytest.fixture
def configured():
    with override_settings(
        SMS_API_KEY=KEY,
        SMS_SENDER_ID="MCQ",
        SMS_API_URL="https://bulksmsbd.example/api/smsapi",
    ):
        yield


@pytest.mark.usefixtures("configured")
class TestSend:
    def test_202_is_success_and_sends_the_documented_fields(self):
        with reply({"response_code": 202, "message_id": "m-1"}) as urlopen:
            result = BulkSmsBdProvider().send("+8801712345678", "Your code is 123456")
        assert result.provider == "bulksmsbd" and result.message_id == "m-1"
        request = urlopen.call_args.args[0]
        assert request.full_url.startswith("https://")
        sent = json.loads(request.data.decode())
        assert sent == {
            "api_key": KEY,
            "senderid": "MCQ",
            "number": "8801712345678",
            "message": "Your code is 123456",
        }

    def test_202_without_message_id_still_succeeds(self):
        with reply({"response_code": "202"}):
            assert BulkSmsBdProvider().send("+8801712345678", "x").message_id == "bulksmsbd-202"

    @pytest.mark.parametrize("code", ["1002", "1007", "1032", "1031", "1012"])
    def test_rejection_codes_are_permanent(self, code):
        with reply({"response_code": code}), pytest.raises(SmsRejectedError) as info:
            BulkSmsBdProvider().send("+8801712345678", "x")
        assert RESPONSE_MEANINGS[code] in str(info.value)

    def test_internal_error_is_retried(self):
        with reply({"response_code": 1005}), pytest.raises(SmsDeliveryError):
            BulkSmsBdProvider().send("+8801712345678", "x")

    def test_unknown_code_is_a_rejection_not_a_success(self):
        with reply({"response_code": 9999}), pytest.raises(SmsRejectedError):
            BulkSmsBdProvider().send("+8801712345678", "x")

    def test_missing_code_is_retried(self):
        with reply({"error": "?"}), pytest.raises(SmsDeliveryError):
            BulkSmsBdProvider().send("+8801712345678", "x")

    def test_non_json_body_is_retried(self):
        with reply(b"<html>maintenance</html>"), pytest.raises(SmsDeliveryError):
            BulkSmsBdProvider().send("+8801712345678", "x")

    def test_http_500_is_retried_and_400_is_rejected(self):
        error_500 = urllib.error.HTTPError("https://x", 500, "boom", None, None)
        with mock.patch(URLOPEN, side_effect=error_500), pytest.raises(SmsDeliveryError):
            BulkSmsBdProvider().send("+8801712345678", "x")
        error_400 = urllib.error.HTTPError("https://x", 400, "bad", None, None)
        with mock.patch(URLOPEN, side_effect=error_400), pytest.raises(SmsRejectedError):
            BulkSmsBdProvider().send("+8801712345678", "x")

    def test_network_failure_is_retried(self):
        with mock.patch(URLOPEN, side_effect=urllib.error.URLError("down")):
            with pytest.raises(SmsDeliveryError):
                BulkSmsBdProvider().send("+8801712345678", "x")

    def test_errors_never_contain_the_api_key(self):
        error = urllib.error.HTTPError("https://x", 500, "boom", None, None)
        with mock.patch(URLOPEN, side_effect=error), pytest.raises(SmsDeliveryError) as info:
            BulkSmsBdProvider().send("+8801712345678", "x")
        assert KEY not in str(info.value)
        with reply({"response_code": 1032}), pytest.raises(SmsRejectedError) as info:
            BulkSmsBdProvider().send("+8801712345678", "x")
        assert KEY not in str(info.value)


class TestConfiguration:
    def test_refuses_plain_http_so_the_key_is_never_sent_unencrypted(self):
        with (
            override_settings(
                SMS_API_KEY=KEY, SMS_SENDER_ID="MCQ", SMS_API_URL="http://bulksmsbd.net/api/smsapi"
            ),
            mock.patch(URLOPEN) as urlopen,
            pytest.raises(ImproperlyConfigured, match="https"),
        ):
            BulkSmsBdProvider().send("+8801712345678", "x")
        urlopen.assert_not_called()

    def test_refuses_without_key_or_sender(self):
        with override_settings(SMS_API_KEY="", SMS_SENDER_ID="MCQ"):
            with pytest.raises(ImproperlyConfigured):
                BulkSmsBdProvider().send("+8801712345678", "x")
        with override_settings(SMS_API_KEY=KEY, SMS_SENDER_ID=""):
            with pytest.raises(ImproperlyConfigured):
                BulkSmsBdProvider().send("+8801712345678", "x")

    def test_is_registered_and_selectable_by_name(self):
        with override_settings(SMS_PROVIDER="bulksmsbd"):
            assert isinstance(get_sms_provider(), BulkSmsBdProvider)
