"""BulkSMSBD gateway adapter (non-masking SMS).

Request: HTTPS POST, JSON body ``api_key``, ``senderid``, ``number`` (``8801XXXXXXXXX``,
no ``+``) and ``message``. Success is response code ``202`` only; every other code is a
rejection. Code ``1005`` (internal error) is the only one retried.

The API key is a secret: it is never logged, never put in an exception message and
never sent over plain HTTP (``SMS_API_URL`` must start with ``https://``).
"""

import json
import logging
import urllib.error
import urllib.request

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

from .base import SmsDeliveryError, SmsProvider, SmsRejectedError, SmsResult

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 10
SUCCESS_CODE = "202"
RETRYABLE_CODES = frozenset({"1005"})

# Provider response codes → meaning (for logs and the admin page; never shown to students).
RESPONSE_MEANINGS = {
    "202": "SMS submitted successfully",
    "1001": "invalid number",
    "1002": "sender ID incorrect or disabled",
    "1003": "required fields missing",
    "1005": "provider internal error",
    "1006": "balance validity not available",
    "1007": "balance insufficient",
    "1011": "user ID not found",
    "1012": "masking SMS must be in Bangla",
    "1013": "sender not found for this API key",
    "1014": "gateway not found for this API key",
    "1015": "gateway not found for this API key",
    "1016": "price information missing",
    "1017": "price information disabled",
    "1018": "account owner disabled",
    "1019": "price information missing",
    "1020": "parent account not found",
    "1021": "price not found",
    "1031": "account not verified",
    "1032": "server IP not whitelisted",
}


class BulkSmsBdProvider(SmsProvider):
    name = "bulksmsbd"

    def send(self, to: str, message: str) -> SmsResult:
        api_key, sender_id, url = _configuration()
        payload = {
            "api_key": api_key,
            "senderid": sender_id,
            "number": to.lstrip("+"),
            "message": message,
        }
        body = _post_json(url, payload)
        code = str(body.get("response_code", "")).strip()
        if code == SUCCESS_CODE:
            message_id = str(body.get("message_id") or f"bulksmsbd-{SUCCESS_CODE}")
            return SmsResult(provider=self.name, message_id=message_id)

        meaning = RESPONSE_MEANINGS.get(code, "unknown response")
        if code in RETRYABLE_CODES or not code:
            raise SmsDeliveryError(f"BulkSMSBD code {code or '-'}: {meaning}")
        raise SmsRejectedError(f"BulkSMSBD code {code}: {meaning}")


def _configuration() -> tuple[str, str, str]:
    api_key = settings.SMS_API_KEY
    sender_id = settings.SMS_SENDER_ID
    url = settings.SMS_API_URL
    if not api_key or not sender_id:
        raise ImproperlyConfigured("BulkSMSBD needs SMS_API_KEY and SMS_SENDER_ID.")
    if not url.startswith("https://"):
        # Refuse plain HTTP: the API key would travel unencrypted.
        raise ImproperlyConfigured("SMS_API_URL must start with https://.")
    return api_key, sender_id, url


def _post_json(url: str, payload: dict) -> dict:
    if not url.startswith("https://"):  # defence in depth; _configuration() checks first
        raise ImproperlyConfigured("SMS_API_URL must start with https://.")
    request = urllib.request.Request(  # noqa: S310 — https only, enforced above
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310
            raw = response.read()
    except urllib.error.HTTPError as exc:
        if exc.code >= 500:
            raise SmsDeliveryError(f"BulkSMSBD HTTP {exc.code}") from None
        raise SmsRejectedError(f"BulkSMSBD HTTP {exc.code}") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise SmsDeliveryError("BulkSMSBD unreachable") from None

    try:
        body = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise SmsDeliveryError("BulkSMSBD returned a non-JSON response") from None
    if not isinstance(body, dict):
        raise SmsDeliveryError("BulkSMSBD returned an unexpected response")
    return body
