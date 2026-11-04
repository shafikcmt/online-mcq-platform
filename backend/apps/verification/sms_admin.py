"""Admin-controlled SMS gateway: validation, saving (secret encrypted), and test sends.

Security rules enforced here, not only in the UI:
- the gateway URL must be https, a hostname (not an IP, not localhost), with no credentials;
- the API key is write-only: saved encrypted, never returned, only a 4-character hint;
- every change is audited; the audit entry never contains the key;
- test SMS is rate-limited per admin and needs the encryption key to be configured.
"""

import ipaddress
import re
from urllib.parse import urlsplit

from django.conf import settings
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.audit import services as audit
from apps.audit.services import AuditContext
from apps.core.secret_box import encrypt_secret, last_four

from .models import SmsGatewaySettings, SmsNumberFormat
from .sms.base import get_sms_provider
from .sms.http_gateway import PLACEHOLDERS

TEST_SMS_PER_HOUR = 5
TEST_MESSAGE = "MCQ platform: SMS gateway test. Connection is working."
_KEY_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,40}$")
_CODE = re.compile(r"^[0-9]{1,6}$")
_SENDER = re.compile(r"^[A-Za-z0-9 ._-]{1,20}$")
_PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")

PRESETS = {
    "bulksmsbd": {
        "label": "BulkSMSBD",
        "api_url": "https://bulksmsbd.net/api/smsapi",
        "number_format": SmsNumberFormat.WITHOUT_PLUS,
        "request_template": {
            "api_key": "{api_key}",
            "senderid": "{sender_id}",
            "number": "{number}",
            "message": "{message}",
        },
        "success_codes": ["202"],
        "retry_codes": ["1005"],
        "code_field": "response_code",
    },
}


def _validate_url(url: str) -> None:
    parts = urlsplit(url)
    host = parts.hostname or ""
    if parts.scheme != "https" or not host:
        raise ValidationError("API URL must be an https:// address.")
    if parts.username or parts.password:
        raise ValidationError("API URL must not contain a username or password.")
    if host in ("localhost",) or "." not in host:
        raise ValidationError("API URL must use a public host name.")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return
    raise ValidationError("API URL must use a host name, not an IP address.")


def _validate_template(template) -> None:
    if not isinstance(template, dict) or not 1 <= len(template) <= 10:
        raise ValidationError("Request body must be an object with 1 to 10 fields.")
    used = set()
    for key, value in template.items():
        if not isinstance(key, str) or not _KEY_NAME.match(key):
            raise ValidationError(f"Invalid request field name: {key!r}.")
        if isinstance(value, str):
            if len(value) > 200:
                raise ValidationError(f"Request field {key!r} is too long.")
            for name in _PLACEHOLDER.findall(value):
                if name not in PLACEHOLDERS:
                    raise ValidationError(f"Unknown placeholder {{{name}}} in {key!r}.")
                used.add(name)
        elif not isinstance(value, (int, float, bool)) or value is None:
            raise ValidationError(f"Request field {key!r} must be text or a number.")
    if not {"number", "message"} <= used:
        raise ValidationError("Request body must contain {number} and {message}.")


def _validate_codes(codes, label: str) -> None:
    if not isinstance(codes, list) or len(codes) > 10:
        raise ValidationError(f"{label} must be a list of up to 10 codes.")
    for code in codes:
        if not isinstance(code, str) or not _CODE.match(code):
            raise ValidationError(f"{label} must contain numeric codes only.")


def validate(data: dict) -> None:
    if "api_url" in data:
        _validate_url(data["api_url"])
    if "sender_id" in data and data["sender_id"] and not _SENDER.match(data["sender_id"]):
        raise ValidationError("Sender ID: 1 to 20 letters, digits, space, dot, dash or underscore.")
    if "request_template" in data:
        _validate_template(data["request_template"])
    if "success_codes" in data:
        _validate_codes(data["success_codes"], "Success codes")
    if "retry_codes" in data:
        _validate_codes(data["retry_codes"], "Retry codes")
    if "code_field" in data and not _KEY_NAME.match(data["code_field"]):
        raise ValidationError("Response code field name is invalid.")


def _current(row) -> dict:
    if row is None:
        return {
            "enabled": False,
            "api_url": "",
            "sender_id": "",
            "number_format": "without_plus",
            "request_template": {},
            "success_codes": [],
            "retry_codes": [],
            "code_field": "response_code",
            "api_key_hint": "",
            "has_api_key": False,
        }
    return {
        "enabled": row.enabled,
        "api_url": row.api_url,
        "sender_id": row.sender_id,
        "number_format": row.number_format,
        "request_template": row.request_template,
        "success_codes": row.success_codes,
        "retry_codes": row.retry_codes,
        "code_field": row.code_field,
        "api_key_hint": row.api_key_hint,
        "has_api_key": bool(row.api_key_encrypted),
    }


def gateway_view() -> dict:
    """What the admin page may see. Never contains the API key itself."""
    current = _current(SmsGatewaySettings.load())
    current.update(
        secret_storage_ready=bool(settings.SECRET_ENCRYPTION_KEY),
        active_provider="http-gateway" if current["enabled"] else settings.SMS_PROVIDER,
        presets=PRESETS,
    )
    return current


EDITABLE = (
    "enabled",
    "api_url",
    "sender_id",
    "number_format",
    "request_template",
    "success_codes",
    "retry_codes",
    "code_field",
)


def _audit_pair(old, new) -> dict:
    """Audit keeps scalars readable; structured values are recorded as 'changed' only."""
    if isinstance(old, (dict, list)) or isinstance(new, (dict, list)):
        return {"from": "changed", "to": "changed"}
    return {"from": old, "to": new}


@transaction.atomic  # select_for_update and the audit entry must share one transaction
def update_gateway(data: dict, *, api_key, clear_api_key: bool, ctx: AuditContext) -> dict:
    """Validate and save. ``api_key`` None = keep the stored key; a string = replace it."""
    unknown = set(data) - set(EDITABLE)
    if unknown:
        raise ValidationError(f"Unknown fields: {', '.join(sorted(unknown))}.")
    validate(data)
    row = SmsGatewaySettings.objects.select_for_update().filter(pk=1).first()
    if row is None:
        row = SmsGatewaySettings(pk=1)
    before = _current(row)
    key_change = None

    if clear_api_key:
        row.api_key_encrypted, row.api_key_hint = "", ""
        key_change = "cleared"
    elif api_key is not None:
        if not settings.SECRET_ENCRYPTION_KEY:
            raise ValidationError("SECRET_ENCRYPTION_KEY is not configured on the server.")
        if not (8 <= len(api_key) <= 200) or any(ch.isspace() for ch in api_key):
            raise ValidationError("API key looks invalid (8 to 200 characters, no spaces).")
        row.api_key_encrypted = encrypt_secret(api_key)
        row.api_key_hint = last_four(api_key)
        key_change = "replaced"

    for field, value in data.items():
        setattr(row, field, value)
    if row.enabled and not (row.api_url and row.sender_id and row.api_key_encrypted):
        raise ValidationError("To enable the gateway, set the URL, sender ID and API key first.")
    row.full_clean(exclude=["id"], validate_unique=False, validate_constraints=False)
    row.save()

    after = _current(row)
    changes = {
        f: _audit_pair(before[f], after[f]) for f in EDITABLE if before.get(f) != after.get(f)
    }
    if changes or key_change:
        # The audit layer forbids secret-looking field names, so the key change is only
        # described in the summary text — never with the key or its field name.
        summary = "SMS gateway settings"
        if key_change:
            summary += f" (stored credential {key_change})"
        audit.record(
            ctx,
            action="sms_gateway.update",
            entity_type="sms.gateway",
            entity_id=row.pk,
            summary=summary,
            metadata={"changed_fields": sorted(changes), "changes": changes},
            allowed_fields=tuple(EDITABLE),
        )
    return gateway_view()


def send_test(phone_e164: str, *, admin_id: int, ctx: AuditContext) -> dict:
    """Send one test SMS to ``phone_e164`` through the active provider. Rate-limited."""
    key = f"sms-test:{admin_id}:{timezone.now():%Y%m%d%H}"
    try:
        cache.add(key, 0, timeout=3600)
        count = cache.incr(key)
    except Exception:  # noqa: BLE001 — fail closed when the cache is down
        return {"ok": False, "reason": "Test is temporarily unavailable. Try again shortly."}
    if count > TEST_SMS_PER_HOUR:
        return {"ok": False, "reason": "Test SMS limit reached (5 per hour). Try later."}
    try:
        result = get_sms_provider().send(phone_e164, TEST_MESSAGE)
    except Exception as exc:  # noqa: BLE001 — provider errors carry no secrets by design
        reason = str(exc) or type(exc).__name__
        _audit_test(ctx, sent=False)
        return {"ok": False, "reason": reason}
    _audit_test(ctx, sent=True)
    return {"ok": True, "provider": result.provider}


def _audit_test(ctx: AuditContext, *, sent: bool) -> None:
    # audit.record() must run inside a transaction. The provider call above is
    # deliberately outside any transaction, so the audit write gets its own.
    with transaction.atomic():
        audit.record(
            ctx,
            action="sms_gateway.test",
            entity_type="sms.gateway",
            entity_id=1,
            summary="SMS gateway test sent" if sent else "SMS gateway test failed",
            metadata={"values": {"result": "sent" if sent else "failed"}},
            allowed_fields=("result",),
        )
