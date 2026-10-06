"""Write audit entries: ``record(ctx, action, ...)``.

Rules:
- Call it inside the same ``transaction.atomic()`` block as the change it describes,
  so a change is never committed without its audit entry (and vice versa).
- ``metadata`` has a fixed shape and an explicit allow-list of field names, given by the
  caller (e.g. ``Category.AUDIT_VALUE_FIELDS``). Anything else is a programming error
  and raises ``ValueError`` (rolling back the change) — request payloads, headers,
  cookies, tokens or passwords therefore cannot end up in the log by accident.

Allowed metadata shape (all sections optional)::

    {
        "values":         {field: scalar},              # create: identity values
        "snapshot":       {field: scalar},              # delete: what was deleted
        "changes":        {field: {"from": scalar, "to": scalar}},  # update
        "changed_fields": [field, ...],                 # update (incl. text fields)
        "descriptions":   [field, ...],                 # which text fields are filled
    }
"""

import unicodedata
from dataclasses import dataclass
from typing import Any

from django.db import connection

from apps.core.net import get_client_ip

from .models import AuditLog

# Field names that are never allowed, even if a caller lists them (defence in depth).
FORBIDDEN_FRAGMENTS = (
    "password",
    "token",
    "secret",
    "otp",
    "authorization",
    "cookie",
    "session",
    "csrf",
    "key",
    "hash",
)
MAX_VALUE_LENGTH = 300
SUMMARY_LENGTH = 255
USER_AGENT_LENGTH = 255

_FIELD_MAP_SECTIONS = ("values", "snapshot")
_FIELD_LIST_SECTIONS = ("changed_fields", "descriptions")
_ALLOWED_SECTIONS = (*_FIELD_MAP_SECTIONS, *_FIELD_LIST_SECTIONS, "changes")


def clean_text(value: str | None, max_length: int) -> str:
    """Printable, single-line text: control/format characters become spaces, then trim."""
    text = unicodedata.normalize("NFC", str(value or ""))
    text = "".join(
        " " if unicodedata.category(ch) in ("Cc", "Cf", "Zl", "Zp") else ch for ch in text
    )
    text = " ".join(text.split())
    return text[:max_length]


@dataclass(frozen=True)
class AuditContext:
    """Who did it and from where."""

    actor: Any = None
    ip_address: str | None = None
    user_agent: str = ""

    @classmethod
    def from_request(cls, request) -> "AuditContext":
        user = getattr(request, "user", None)
        actor = user if user is not None and user.is_authenticated else None
        return cls(
            actor=actor,
            ip_address=get_client_ip(request),  # validated IP or None
            user_agent=clean_text(request.META.get("HTTP_USER_AGENT"), USER_AGENT_LENGTH),
        )


def _check_field(name: Any, allowed: frozenset[str]) -> str:
    if not isinstance(name, str) or name not in allowed:
        raise ValueError(f"Audit metadata field {name!r} is not allow-listed.")
    if any(fragment in name.lower() for fragment in FORBIDDEN_FRAGMENTS):
        raise ValueError(f"Audit metadata field {name!r} looks sensitive.")
    return name


def _scalar(value: Any) -> Any:
    if value is None or isinstance(value, bool | int | float):
        return value
    if isinstance(value, str):
        return clean_text(value, MAX_VALUE_LENGTH)
    raise ValueError(f"Audit metadata values must be scalars, not {type(value).__name__}.")


def build_metadata(metadata: dict | None, allowed_fields) -> dict:
    """Validate ``metadata`` against the fixed shape and the field allow-list."""
    allowed = frozenset(allowed_fields)
    clean: dict = {}
    for section, content in (metadata or {}).items():
        if section not in _ALLOWED_SECTIONS:
            raise ValueError(f"Unknown audit metadata section {section!r}.")
        if section in _FIELD_MAP_SECTIONS:
            clean[section] = {_check_field(k, allowed): _scalar(v) for k, v in content.items()}
        elif section in _FIELD_LIST_SECTIONS:
            clean[section] = [_check_field(name, allowed) for name in content]
        else:  # changes
            clean[section] = {
                _check_field(k, allowed): {"from": _scalar(v["from"]), "to": _scalar(v["to"])}
                for k, v in content.items()
            }
    return clean


def record(
    ctx: AuditContext,
    *,
    action: str,
    entity_type: str,
    entity_id: Any,
    summary: str = "",
    metadata: dict | None = None,
    allowed_fields=(),
) -> AuditLog:
    if not connection.in_atomic_block:
        raise RuntimeError("audit.record() must run inside the transaction of the change.")
    return AuditLog.objects.create(
        actor=ctx.actor,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id),
        summary=clean_text(summary, SUMMARY_LENGTH),
        metadata=build_metadata(metadata, allowed_fields),
        ip_address=ctx.ip_address,
        user_agent=clean_text(ctx.user_agent, USER_AGENT_LENGTH),
    )
