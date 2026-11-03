"""Generic HTTP SMS gateway, configured entirely from the admin panel.

The request body comes from ``SmsGatewaySettings.request_template``; placeholders are
filled at send time. The API key is decrypted only here, sent only to the saved HTTPS
URL, and never appears in logs or in exception messages. Redirects are not followed, so
the key cannot be forwarded to another host.
"""

import json
import logging
import urllib.error
import urllib.request

from django.core.exceptions import ImproperlyConfigured

from apps.core.secret_box import SecretBoxError, decrypt_secret

from .base import SmsDeliveryError, SmsProvider, SmsRejectedError, SmsResult

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 10
PLACEHOLDERS = ("api_key", "sender_id", "number", "message")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # a 3xx response surfaces as HTTPError; the key is never re-sent


_OPENER = urllib.request.build_opener(_NoRedirect)


def format_number(e164: str, number_format: str) -> str:
    digits = e164.lstrip("+")
    if number_format == "with_plus":
        return "+" + digits
    if number_format == "local":
        return "0" + digits[len("880") :] if digits.startswith("880") else digits
    return digits


class HttpGatewayProvider(SmsProvider):
    name = "http-gateway"

    def __init__(self, config):
        self.config = config

    def send(self, to: str, message: str) -> SmsResult:
        config = self.config
        if not config.api_url.startswith("https://"):
            raise ImproperlyConfigured("The SMS gateway URL must start with https://.")
        if not config.api_key_encrypted or not config.sender_id:
            raise ImproperlyConfigured("The SMS gateway needs an API key and a sender ID.")
        try:
            api_key = decrypt_secret(config.api_key_encrypted)
        except SecretBoxError as exc:
            raise ImproperlyConfigured("The stored SMS API key cannot be decrypted.") from exc

        values = {
            "api_key": api_key,
            "sender_id": config.sender_id,
            "number": format_number(to, config.number_format),
            "message": message,
        }
        body = {key: _fill(value, values) for key, value in config.request_template.items()}
        reply = _post(config.api_url, body)

        code = str(reply.get(config.code_field, "")).strip()
        if code and code in config.success_codes:
            message_id = str(reply.get("message_id") or f"gateway-{code}")
            return SmsResult(provider=self.name, message_id=message_id)
        if not code or code in config.retry_codes:
            raise SmsDeliveryError(f"SMS gateway temporary failure (code {code or '-'})")
        raise SmsRejectedError(f"SMS gateway rejected the message (code {code})")


def _fill(template, values: dict):
    if not isinstance(template, str):
        return template
    for name in PLACEHOLDERS:
        template = template.replace("{" + name + "}", values[name])
    return template


def _post(url: str, body: dict) -> dict:
    request = urllib.request.Request(  # noqa: S310 — https checked in send()
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with _OPENER.open(request, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310
            raw = response.read()
    except urllib.error.HTTPError as exc:
        if exc.code >= 500:
            raise SmsDeliveryError(f"SMS gateway HTTP {exc.code}") from None
        raise SmsRejectedError(f"SMS gateway HTTP {exc.code}") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise SmsDeliveryError("SMS gateway unreachable") from None
    try:
        reply = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise SmsDeliveryError("SMS gateway returned a non-JSON response") from None
    if not isinstance(reply, dict):
        raise SmsDeliveryError("SMS gateway returned an unexpected response")
    return reply
