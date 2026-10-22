"""Read-side helpers for the admin payments API (Milestone 7H).

The stored provider data (``raw_verification``, event payloads) is already sanitized,
but it still carries provider identifiers, merchant figures and — for callbacks — values
posted by an untrusted client. The admin API therefore never returns it whole: it
returns these **allow-listed** summaries, and every value must match a known set or a
strict pattern; anything else is dropped (never echoed).
"""

import re

from .gateways import CallbackKind, Outcome
from .models import PaymentStatus

TIMELINE_LIMIT = 50

_CODE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")  # our own reason/error codes
_PROVIDER_STATUS = re.compile(r"^[A-Z][A-Z_]{0,31}$")
_RISK_LEVEL = re.compile(r"^\d{1,2}$")
_CARD_BRAND = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._-]{0,31}$")
_PROVIDER_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$")

_OUTCOMES = frozenset(
    {
        Outcome.PAID,
        Outcome.FAILED,
        Outcome.CANCELLED,
        Outcome.PENDING,
        Outcome.NOT_FOUND,
        Outcome.ERROR,
    }
)
_KINDS = frozenset({CallbackKind.SUCCESS, CallbackKind.FAIL, CallbackKind.CANCEL, CallbackKind.IPN})
_SOURCES = _KINDS | {"initiate", "reconciliation", "admin_reverify"}
_STATUSES = frozenset(PaymentStatus.values)


def _in(allowed):
    return lambda value: isinstance(value, str) and value in allowed


def _matches(pattern):
    return lambda value: isinstance(value, str) and bool(pattern.fullmatch(value))


SUMMARY_RULES = {
    "from": _in(_STATUSES),
    "to": _in(_STATUSES),
    "reason": _matches(_CODE),
    "previous_reason": _matches(_CODE),
    "outcome": _in(_OUTCOMES),
    "source": _in(_SOURCES),
    "kind": _in(_KINDS),
    "signature_valid": lambda value: isinstance(value, bool),
    # Only our gateway/transport codes (``timeout``, ``http_500``…) — never provider text.
    "error": _matches(_CODE),
}


def event_summary(payload) -> dict:
    """The allow-listed short codes of one event payload (present, valid keys only)."""
    if not isinstance(payload, dict):
        return {}
    return {
        key: payload[key]
        for key, ok in SUMMARY_RULES.items()
        if key in payload and ok(payload[key])
    }


def _provider_value(raw: dict, key: str, pattern) -> str | None:
    value = raw.get(key)
    if isinstance(value, int) and not isinstance(value, bool):
        value = str(value)
    if not isinstance(value, str):
        return None
    value = value.strip()
    if key == "status":
        value = value.upper()
    return value if pattern.fullmatch(value) else None


def verification_summary(raw) -> dict | None:
    """Four allow-listed facts of the provider's verification answer, or ``None``."""
    if not isinstance(raw, dict) or not raw:
        return None
    summary = {
        "provider_status": _provider_value(raw, "status", _PROVIDER_STATUS),
        "risk_level": _provider_value(raw, "risk_level", _RISK_LEVEL),
        "card_brand": _provider_value(raw, "card_brand", _CARD_BRAND),
        "validated_on": _provider_value(raw, "validated_on", _PROVIDER_DATE),
    }
    return summary if any(value is not None for value in summary.values()) else None


def with_timeline(payment, limit: int = TIMELINE_LIMIT):
    """Attach the latest ``limit`` events (shown oldest → newest) and the stored total.
    Two bounded queries; the payloads of older events are never loaded."""
    latest = list(payment.events.order_by("-created_at", "-id")[:limit])
    payment.timeline = latest[::-1]
    payment.events_total = payment.events.count() if len(latest) == limit else len(latest)
    return payment
