"""Storage rules for admin-managed payment gateways (``models.PaymentGateway``).

This module is the only writer of gateway credentials and of the sandbox → live switch:

- credentials are Fernet-encrypted (``apps.core.secret_box``, key only in the environment),
  one row per (gateway, mode, field), write-only: nothing here ever returns a stored value
  except ``read_credentials`` for the adapter that must use it, in memory, never logged;
- every change writes the gateway's own append-only log AND the admin audit log, in the same
  transaction, with field NAMES only, never values;
- **going live** needs (1) every required live credential present and (2) at least one
  successful *sandbox* payment recorded in our database for this gateway
  (``Payment.gateway`` + ``mode="sandbox"`` + ``status=success``): the money flow was proven
  against the provider's sandbox before real money can move.

Authorization (admin only, password re-confirmation) is enforced by the API layer in front
of these functions; they assume the caller is allowed.
"""

import re
from collections.abc import Iterable, Mapping

from django.db import transaction

from apps.audit import services as audit
from apps.audit.services import AuditContext
from apps.core.secret_box import decrypt_secret, encrypt_secret, last_four

from .models import (
    CREDENTIAL_FIELD_PATTERN,
    GatewayLogType,
    GatewayMode,
    Payment,
    PaymentGateway,
    PaymentGatewayCredential,
    PaymentGatewayLog,
    PaymentStatus,
)

MAX_SECRET_LENGTH = 2000
AUDIT_ENTITY = "payments.gateway"
_FIELD_RE = re.compile(CREDENTIAL_FIELD_PATTERN)
_DETAIL_TEXT = 200
_DETAIL_ITEMS = 30


class GatewayStoreError(Exception):
    """A rule was broken. ``code`` is stable (APIs map it); ``blockers`` lists what is missing."""

    def __init__(self, code: str, blockers: Iterable[str] = ()):
        super().__init__(code)
        self.code = code
        self.blockers = list(blockers)


# --------------------------------------------------------------------------------------
# Log
# --------------------------------------------------------------------------------------
def _detail_value(value):
    if value is None or isinstance(value, bool | int):
        return value
    if isinstance(value, str):
        return value[:_DETAIL_TEXT]
    if isinstance(value, list | tuple):
        return [str(item)[:_DETAIL_TEXT] for item in value[:_DETAIL_ITEMS]]
    return str(value)[:_DETAIL_TEXT]


def log_event(
    gateway: PaymentGateway,
    event_type: str,
    *,
    ctx: AuditContext | None = None,
    summary: str = "",
    details: Mapping | None = None,
) -> PaymentGatewayLog:
    """Append to the gateway's history. ``details`` must be scalars/short lists chosen by the
    caller (field names, modes, counts): never provider payloads and never secret values."""
    return PaymentGatewayLog.objects.create(
        gateway=gateway,
        event_type=event_type,
        actor=getattr(ctx, "actor", None),
        summary=summary[:200],
        details={str(k)[:40]: _detail_value(v) for k, v in (details or {}).items()},
        source_ip=getattr(ctx, "ip_address", None),
    )


def _audit(ctx: AuditContext, gateway: PaymentGateway, action: str, summary: str) -> None:
    # No metadata on purpose: credential field names such as "app_key" are forbidden in the
    # audit allow-list, and the per-gateway log already carries the names.
    audit.record(
        ctx,
        action=f"payment_gateway.{action}",
        entity_type=AUDIT_ENTITY,
        entity_id=gateway.pk,
        summary=f"{summary} ({gateway.slug})",
    )


# --------------------------------------------------------------------------------------
# Credentials
# --------------------------------------------------------------------------------------
def _check_field(field: str) -> str:
    if not isinstance(field, str) or not _FIELD_RE.match(field):
        raise GatewayStoreError("invalid_credential_field", [str(field)[:40]])
    return field


def save_credentials(
    gateway: PaymentGateway, mode: str, values: Mapping[str, str], *, ctx: AuditContext
) -> list[str]:
    """Create or replace credentials. A blank value means "leave as it is" (the admin form
    never receives the old value, so it cannot send it back). Returns the field names that
    changed. Raises ``ImproperlyConfigured`` without ``SECRET_ENCRYPTION_KEY``."""
    if mode not in GatewayMode.values:
        raise GatewayStoreError("invalid_mode", [str(mode)[:20]])
    changed: list[str] = []
    with transaction.atomic():
        for field, raw in values.items():
            _check_field(field)
            value = (raw or "").strip()
            if not value:
                continue
            if len(value) > MAX_SECRET_LENGTH:
                raise GatewayStoreError("credential_too_long", [field])
            PaymentGatewayCredential.objects.update_or_create(
                gateway=gateway,
                mode=mode,
                field=field,
                defaults={"value_encrypted": encrypt_secret(value), "hint": last_four(value)},
            )
            changed.append(field)
        if changed:
            changed.sort()
            log_event(
                gateway,
                GatewayLogType.CREDENTIAL_CHANGED,
                ctx=ctx,
                summary=f"{len(changed)} credential(s) set in {mode} mode",
                details={"mode": mode, "fields": changed},
            )
            _audit(ctx, gateway, "credentials", f"{len(changed)} credential(s) set, {mode}")
    return changed


def remove_credential(gateway: PaymentGateway, mode: str, field: str, *, ctx: AuditContext) -> bool:
    _check_field(field)
    with transaction.atomic():
        deleted, _ = PaymentGatewayCredential.objects.filter(
            gateway=gateway, mode=mode, field=field
        ).delete()
        if deleted:
            log_event(
                gateway,
                GatewayLogType.CREDENTIAL_CHANGED,
                ctx=ctx,
                summary=f"credential removed in {mode} mode",
                details={"mode": mode, "fields": [field], "removed": True},
            )
            _audit(ctx, gateway, "credentials", f"credential removed, {mode}")
    return bool(deleted)


def credential_hints(gateway: PaymentGateway, mode: str) -> dict[str, str]:
    """Which credentials are set in ``mode`` and their 4-character hints: the only thing the
    admin ever sees of a secret."""
    rows = PaymentGatewayCredential.objects.filter(gateway=gateway, mode=mode)
    return {row.field: row.hint for row in rows}


def read_credentials(gateway: PaymentGateway, mode: str) -> dict[str, str]:
    """Decrypted credentials for the adapter that calls the provider. In memory only: never
    return this from an API, log it or put it in an exception message. Raises
    ``SecretBoxError`` if a value cannot be decrypted."""
    rows = PaymentGatewayCredential.objects.filter(gateway=gateway, mode=mode)
    return {row.field: decrypt_secret(row.value_encrypted) for row in rows}


def missing_credentials(gateway: PaymentGateway, mode: str, required: Iterable[str]) -> list[str]:
    present = set(credential_hints(gateway, mode))
    return sorted(set(required) - present)


# --------------------------------------------------------------------------------------
# Sandbox → live
# --------------------------------------------------------------------------------------
def sandbox_payment_succeeded(gateway: PaymentGateway) -> bool:
    """At least one sandbox payment on THIS gateway was verified as paid by the provider."""
    return Payment.objects.filter(
        gateway=gateway, mode=GatewayMode.SANDBOX, status=PaymentStatus.SUCCESS
    ).exists()


def live_blockers(gateway: PaymentGateway, required_live_fields: Iterable[str]) -> list[str]:
    """Why this gateway may not go live yet (empty list = it may)."""
    blockers = [
        f"missing_credential:{name}"
        for name in missing_credentials(gateway, GatewayMode.LIVE, required_live_fields)
    ]
    if not sandbox_payment_succeeded(gateway):
        blockers.append("no_successful_sandbox_payment")
    return blockers


def change_mode(
    gateway: PaymentGateway, new_mode: str, *, ctx: AuditContext, required_live_fields=()
) -> PaymentGateway:
    """Switch sandbox ⇄ live. Going live is refused unless ``live_blockers`` is empty."""
    if new_mode not in GatewayMode.values:
        raise GatewayStoreError("invalid_mode", [str(new_mode)[:20]])
    with transaction.atomic():
        locked = PaymentGateway.objects.select_for_update().get(pk=gateway.pk)
        if locked.mode == new_mode:
            return locked
        if new_mode == GatewayMode.LIVE:
            blockers = live_blockers(locked, required_live_fields)
            if blockers:
                raise GatewayStoreError("live_not_ready", blockers)
        old = locked.mode
        locked.mode = new_mode
        locked.save(update_fields=["mode", "updated_at"])
        log_event(
            locked,
            GatewayLogType.MODE_CHANGED,
            ctx=ctx,
            summary=f"mode {old} -> {new_mode}",
            details={"from": old, "to": new_mode},
        )
        _audit(ctx, locked, "mode", f"mode {old} -> {new_mode}")
    gateway.mode = locked.mode
    return locked
