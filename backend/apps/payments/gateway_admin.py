"""Admin operations on payment gateways (used by ``api/gateway_views.py``).

Rules enforced here, in front of ``gateway_store``:

- only the fields the adapter's schema lists can be set (no arbitrary keys, no code);
- **credential and mode changes need the admin's own password again** (``confirm_password``,
  with a failure budget), on top of the admin session;
- every change is written to the gateway log and the audit log, with field NAMES only;
- secrets are write-only: views built here carry only ``set`` / 4-character hints;
- an adapter that is not implemented cannot be created, configured or enabled;
- sandbox purchases are only for designated testers, and what they buy is a test
  subscription that an admin can revoke.
"""

import logging
import re
from decimal import Decimal, InvalidOperation
from urllib.parse import urlsplit

from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured, ValidationError
from django.db import IntegrityError, transaction
from django.http import Http404
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from apps.accounts.models import Role, User
from apps.audit import services as audit
from apps.audit.services import AuditContext
from apps.subscriptions.models import Currency, Subscription
from apps.subscriptions.services import cancel_subscription

from . import gateway_manager, gateway_store
from .gateways import GatewayError
from .gateways.registry import REGISTRY, get_spec, is_implemented, validate_options
from .models import (
    GATEWAY_SLUG_PATTERN,
    GatewayLogType,
    GatewayMode,
    Payment,
    PaymentGateway,
    PaymentStatus,
    PaymentTester,
)

logger = logging.getLogger(__name__)

AUDIT_FIELDS = (
    "slug",
    "adapter",
    "name_en",
    "name_bn",
    "description_en",
    "description_bn",
    "logo_url",
    "priority",
    "web_enabled",
    "app_enabled",
    "web_return_url",
    "app_return_url",
    "currencies",
    "min_amount",
    "max_amount",
    "enabled",
    "mode",
)
EDITABLE = (
    "name_en",
    "name_bn",
    "description_en",
    "description_bn",
    "logo_url",
    "priority",
    "web_enabled",
    "app_enabled",
    "web_return_url",
    "app_return_url",
    "currencies",
    "min_amount",
    "max_amount",
)
REAUTH_FAILURES = 5
REAUTH_WINDOW_SECONDS = 15 * 60
TEST_COOLDOWN_SECONDS = 5
MAX_PRIORITY = 10_000
_APP_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]{1,30}$")
_UNSAFE_SCHEMES = {"javascript", "data", "file", "vbscript", "http", "ftp", "blob", "about"}


class GatewayAdminError(Exception):
    """A refused admin action: stable ``code`` + HTTP status (+ optional details)."""

    def __init__(self, code: str, message, status: int = 400, details: dict | None = None):
        super().__init__(code)
        self.code, self.message, self.status, self.details = code, message, status, details or {}


# --------------------------------------------------------------------------------------
# Password re-confirmation
# --------------------------------------------------------------------------------------
def confirm_password(user: User, password) -> None:
    """The admin proves it is still them before a credential or mode change. A wrong
    password counts against a small budget (``REAUTH_FAILURES`` per window), so a stolen
    session cannot be used to guess the password."""
    key = f"gateway-reauth:{user.pk}"
    failures = cache.get(key, 0)
    if failures >= REAUTH_FAILURES:
        raise GatewayAdminError(
            "reauth_locked",
            _("Too many wrong passwords. Try again later."),
            status=429,
        )
    if not isinstance(password, str) or not password or not user.check_password(password):
        cache.set(key, failures + 1, REAUTH_WINDOW_SECONDS)
        raise GatewayAdminError(
            "password_confirmation_failed", _("The password is not correct."), status=403
        )
    cache.delete(key)


# --------------------------------------------------------------------------------------
# Views (never any secret)
# --------------------------------------------------------------------------------------
def adapters_view() -> list[dict]:
    out = []
    for spec in REGISTRY.values():
        out.append(
            {
                "code": spec.code,
                "label_en": spec.label_en,
                "label_bn": spec.label_bn,
                "implemented": is_implemented(spec.code),
                "capabilities": list(spec.capabilities),
                "note": spec.note_en,
                "credentials": [_field_view(f) for f in spec.credentials],
                "options": [_field_view(f) for f in spec.options],
            }
        )
    return out


def _field_view(field) -> dict:
    return {
        "name": field.name,
        "kind": field.kind,
        "label_en": field.label_en,
        "label_bn": field.label_bn,
        "required": field.required,
        "default": field.default,
        "choices": list(field.choices),
        "minimum": field.minimum,
        "maximum": field.maximum,
    }


def _money_text(value) -> str | None:
    """Money goes out as an exact string (never a float)."""
    return None if value is None else f"{value:.2f}"


def _health(gateway: PaymentGateway) -> str:
    if gateway.last_test_at is None:
        return "untested"
    if gateway.last_test_ok is None:
        return "unsupported"
    return "ok" if gateway.last_test_ok else "failed"


def gateway_view(gateway: PaymentGateway) -> dict:
    spec = get_spec(gateway.adapter)
    credentials = {}
    for mode in GatewayMode.values:
        hints = gateway_store.credential_hints(gateway, mode)
        credentials[mode] = {
            name: {"set": name in hints, "hint": hints.get(name, "")}
            for name in ([f.name for f in spec.credentials] if spec else [])
        }
    try:
        options = validate_options(gateway.adapter, gateway.options)
    except ValueError:
        options = {}
    required = [f.name for f in spec.credentials] if spec else []
    return {
        "id": str(gateway.public_id),
        "slug": gateway.slug,
        "adapter": gateway.adapter,
        "adapter_label": spec.label_en if spec else gateway.adapter,
        "implemented": is_implemented(gateway.adapter),
        "name_en": gateway.name_en,
        "name_bn": gateway.name_bn,
        "description_en": gateway.description_en,
        "description_bn": gateway.description_bn,
        "logo_url": gateway.logo_url,
        "enabled": gateway.enabled,
        "mode": gateway.mode,
        "priority": gateway.priority,
        "web_enabled": gateway.web_enabled,
        "app_enabled": gateway.app_enabled,
        "web_return_url": gateway.web_return_url,
        "app_return_url": gateway.app_return_url,
        "currencies": list(gateway.currencies),
        "min_amount": _money_text(gateway.min_amount),
        "max_amount": _money_text(gateway.max_amount),
        "options": options,
        "credentials": credentials,
        # Why it cannot take payments right now (empty = ready), and why it cannot go live.
        "issues": gateway_manager.gateway_issues(gateway),
        "live_blockers": gateway_store.live_blockers(gateway, required)
        if gateway.mode != GatewayMode.LIVE
        else [],
        "has_sandbox_payment": gateway_store.sandbox_payment_succeeded(gateway),
        "health": {
            "status": _health(gateway),
            "last_test_at": gateway.last_test_at,
            "last_connected_at": gateway.last_connected_at,
            "message": gateway.last_test_message,
        },
        "created_at": gateway.created_at,
        "updated_at": gateway.updated_at,
    }


# --------------------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------------------
def _invalid(field: str, message, code: str = "invalid") -> ValidationError:
    return ValidationError({field: ValidationError(message, code=code)})


def clean_url(field: str, value, *, allow_app_scheme: bool = False) -> str:
    text = (value or "").strip() if isinstance(value, str) or value is None else None
    if text is None:
        raise _invalid(field, _("Must be text."))
    if not text:
        return ""
    if len(text) > 500:
        raise _invalid(field, _("Too long."), "too_long")
    parts = urlsplit(text)
    scheme = parts.scheme.lower()
    if scheme == "https":
        if not parts.netloc:
            raise _invalid(field, _("Enter a full https:// address."), "https_required")
        return text
    if allow_app_scheme and _APP_SCHEME.match(scheme) and scheme not in _UNSAFE_SCHEMES:
        if parts.netloc or parts.path:
            return text
    raise _invalid(field, _("Enter a full https:// address."), "https_required")


def _clean_text(field: str, value, max_length: int, *, required: bool = False) -> str:
    if not isinstance(value, str):
        raise _invalid(field, _("Must be text."))
    text = " ".join(value.split())
    if required and not text:
        raise _invalid(field, _("This field is required."), "required")
    if len(text) > max_length:
        raise _invalid(field, _("Too long."), "too_long")
    return text


def _clean_money(field: str, value):
    if value in (None, ""):
        return None
    try:
        amount = Decimal(str(value))
    except InvalidOperation:
        raise _invalid(field, _("Enter a valid amount.")) from None
    if not amount.is_finite() or amount <= 0 or amount >= Decimal("100000000"):
        raise _invalid(field, _("Enter a valid amount."))
    return amount.quantize(Decimal("0.01"))


def _clean_fields(data: dict) -> dict:
    """Validated values for the non-secret fields present in ``data``."""
    clean = {}
    for name in ("name_en", "name_bn", "description_en", "description_bn"):
        if name in data:
            limit = 120 if name.startswith("name") else 300
            clean[name] = _clean_text(name, data[name], limit, required=name == "name_en")
    if "logo_url" in data:
        clean["logo_url"] = clean_url("logo_url", data["logo_url"])
    if "web_return_url" in data:
        clean["web_return_url"] = clean_url("web_return_url", data["web_return_url"])
    if "app_return_url" in data:
        clean["app_return_url"] = clean_url(
            "app_return_url", data["app_return_url"], allow_app_scheme=True
        )
    for name in ("web_enabled", "app_enabled"):
        if name in data:
            if not isinstance(data[name], bool):
                raise _invalid(name, _("Must be true or false."))
            clean[name] = data[name]
    if "priority" in data:
        value = data["priority"]
        if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= MAX_PRIORITY:
            raise _invalid("priority", _("Enter a whole number from 0 to 10000."))
        clean["priority"] = value
    if "currencies" in data:
        value = data["currencies"]
        if (
            not isinstance(value, list)
            or not value
            or not all(isinstance(c, str) and c in Currency.values for c in value)
        ):
            raise _invalid("currencies", _("Choose from the supported currencies."))
        clean["currencies"] = sorted(set(value))
    for name in ("min_amount", "max_amount"):
        if name in data:
            clean[name] = _clean_money(name, data[name])
    return clean


def _check_range(values: dict) -> None:
    low, high = values.get("min_amount"), values.get("max_amount")
    if low is not None and high is not None and high < low:
        raise _invalid("max_amount", _("The maximum cannot be below the minimum."), "range")


def _audit_value(value):
    if isinstance(value, list):
        return ",".join(str(v) for v in value)
    if isinstance(value, Decimal):
        return str(value)
    return value


def _audit_change(ctx, gateway, action: str, summary: str, changes: dict) -> None:
    audit.record(
        ctx,
        action=f"payment_gateway.{action}",
        entity_type=gateway_store.AUDIT_ENTITY,
        entity_id=gateway.pk,
        summary=f"{summary} ({gateway.slug})",
        metadata={
            "changed_fields": sorted(changes),
            "changes": {
                name: {"from": _audit_value(old), "to": _audit_value(new)}
                for name, (old, new) in changes.items()
            },
        },
        allowed_fields=AUDIT_FIELDS,
    )


# --------------------------------------------------------------------------------------
# Create / update
# --------------------------------------------------------------------------------------
def get_gateway_row(public_id) -> PaymentGateway:
    gateway = PaymentGateway.objects.filter(public_id=public_id).first()
    if gateway is None:
        raise Http404
    return gateway


def create_gateway(data: dict, *, ctx: AuditContext) -> PaymentGateway:
    adapter = data.get("adapter")
    spec = get_spec(adapter) if isinstance(adapter, str) else None
    if spec is None:
        raise _invalid("adapter", _("Unknown payment provider."), "unknown_adapter")
    if not is_implemented(adapter):
        # Nagad / Rocket (direct) are listed but have no verified adapter yet.
        raise GatewayAdminError(
            "adapter_not_implemented",
            _("This provider is not implemented yet and cannot be configured."),
            status=409,
        )
    slug = data.get("slug")
    if not isinstance(slug, str) or not re.match(GATEWAY_SLUG_PATTERN, slug):
        raise _invalid("slug", _("Use 2–40 lowercase letters, digits and hyphens."), "invalid_slug")
    values = _clean_fields({"currencies": ["BDT"], **data})
    values.setdefault("name_en", spec.label_en)
    _check_range(values)
    try:
        options = validate_options(adapter, data.get("options"))
    except ValueError as exc:
        raise _options_error(exc) from None
    try:
        with transaction.atomic():
            gateway = PaymentGateway.objects.create(
                slug=slug, adapter=adapter, options=options, **values
            )
            gateway_store.log_event(
                gateway,
                GatewayLogType.CREATED,
                ctx=ctx,
                summary=f"gateway created ({adapter})",
                details={"adapter": adapter},
            )
            audit.record(
                ctx,
                action="payment_gateway.create",
                entity_type=gateway_store.AUDIT_ENTITY,
                entity_id=gateway.pk,
                summary=f"gateway created ({slug})",
                metadata={"values": {"slug": slug, "adapter": adapter}},
                allowed_fields=AUDIT_FIELDS,
            )
    except IntegrityError:
        raise _invalid("slug", _("This slug is already used."), "slug_taken") from None
    return gateway


def _options_error(exc: ValueError) -> ValidationError:
    detail = exc.args[0] if exc.args and isinstance(exc.args[0], dict) else {"options": "invalid"}
    return ValidationError(
        {
            f"options.{name}": ValidationError(str(code), code=str(code))
            for name, code in detail.items()
        }
    )


def update_gateway(gateway: PaymentGateway, data: dict, *, ctx: AuditContext) -> PaymentGateway:
    unknown = set(data) - set(EDITABLE) - {"options"}
    if unknown:
        raise ValidationError(
            {
                name: ValidationError(_("This field cannot be changed here."), code="read_only")
                for name in sorted(unknown)
            }
        )
    values = _clean_fields({k: v for k, v in data.items() if k != "options"})
    with transaction.atomic():
        row = PaymentGateway.objects.select_for_update().get(pk=gateway.pk)
        merged = {
            "min_amount": values.get("min_amount", row.min_amount),
            "max_amount": values.get("max_amount", row.max_amount),
        }
        _check_range(merged)
        changes = {
            name: (getattr(row, name), value)
            for name, value in values.items()
            if getattr(row, name) != value
        }
        if "options" in data:
            try:
                options = validate_options(row.adapter, data["options"])
            except ValueError as exc:
                raise _options_error(exc) from None
            if options != validate_options(row.adapter, row.options):
                row.options = options
                changes["options"] = ("changed", "changed")
        if not changes:
            return row
        for name, (_old, new) in changes.items():
            if name != "options":
                setattr(row, name, new)
        row.save()
        shown = {n: c for n, c in changes.items() if n != "options"}
        gateway_store.log_event(
            row,
            GatewayLogType.CONFIG_CHANGED,
            ctx=ctx,
            summary=f"{len(changes)} setting(s) changed",
            details={"fields": sorted(changes)},
        )
        audit.record(
            ctx,
            action="payment_gateway.update",
            entity_type=gateway_store.AUDIT_ENTITY,
            entity_id=row.pk,
            summary=f"gateway updated ({row.slug})",
            metadata={
                "changed_fields": sorted(shown),
                "changes": {
                    n: {"from": _audit_value(o), "to": _audit_value(v)}
                    for n, (o, v) in shown.items()
                },
            }
            if shown
            else {},
            allowed_fields=AUDIT_FIELDS,
        )
    return row


# --------------------------------------------------------------------------------------
# Credentials, mode, enable
# --------------------------------------------------------------------------------------
def set_credentials(
    gateway: PaymentGateway, mode: str, values: dict, *, user: User, password, ctx: AuditContext
) -> list[str]:
    confirm_password(user, password)
    if mode not in GatewayMode.values:
        raise _invalid("mode", _("Choose sandbox or live."), "invalid_mode")
    if not is_implemented(gateway.adapter):
        raise GatewayAdminError(
            "adapter_not_implemented", _("This provider is not implemented yet."), status=409
        )
    allowed = {f.name for f in get_spec(gateway.adapter).credentials}
    if not isinstance(values, dict) or not values:
        raise _invalid("values", _("Send at least one credential."), "required")
    unknown = sorted(set(values) - allowed)
    if unknown:
        raise ValidationError(
            {
                f"values.{name}": ValidationError(
                    _("Unknown credential."), code="unknown_credential"
                )
                for name in unknown
            }
        )
    for name, value in values.items():
        if value is not None and not isinstance(value, str):
            raise _invalid(f"values.{name}", _("Must be text."))
    try:
        return gateway_store.save_credentials(gateway, mode, values, ctx=ctx)
    except ImproperlyConfigured:
        # SECRET_ENCRYPTION_KEY missing or invalid: secrets are never stored in plaintext.
        raise GatewayAdminError(
            "encryption_unavailable",
            _("Secrets cannot be stored: the server has no valid encryption key."),
            status=503,
        ) from None
    except gateway_store.GatewayStoreError as exc:
        raise GatewayAdminError(
            exc.code, _("The credentials could not be saved."), details={"fields": exc.blockers}
        ) from None


def change_mode(
    gateway: PaymentGateway, mode: str, *, user: User, password, ctx: AuditContext
) -> PaymentGateway:
    confirm_password(user, password)
    if not is_implemented(gateway.adapter):
        raise GatewayAdminError(
            "adapter_not_implemented", _("This provider is not implemented yet."), status=409
        )
    required = [f.name for f in get_spec(gateway.adapter).credentials]
    try:
        return gateway_store.change_mode(gateway, mode, ctx=ctx, required_live_fields=required)
    except gateway_store.GatewayStoreError as exc:
        if exc.code == "live_not_ready":
            raise GatewayAdminError(
                "live_not_ready",
                _("Live mode needs the live credentials and one successful sandbox payment."),
                status=409,
                details={"blockers": exc.blockers},
            ) from None
        raise _invalid("mode", _("Choose sandbox or live."), exc.code) from None


def set_enabled(gateway: PaymentGateway, enabled: bool, *, ctx: AuditContext) -> PaymentGateway:
    with transaction.atomic():
        row = PaymentGateway.objects.select_for_update().get(pk=gateway.pk)
        if row.enabled == enabled:
            return row
        if enabled:
            issues = gateway_manager.gateway_issues(row)
            if issues:
                raise GatewayAdminError(
                    "gateway_not_ready",
                    _("This gateway is not ready to be enabled."),
                    status=409,
                    details={"issues": issues},
                )
        row.enabled = enabled
        row.save(update_fields=["enabled", "updated_at"])
        gateway_store.log_event(
            row,
            GatewayLogType.ENABLED if enabled else GatewayLogType.DISABLED,
            ctx=ctx,
            summary="enabled" if enabled else "disabled",
            details={"mode": row.mode},
        )
        _audit_change(
            ctx,
            row,
            "enable" if enabled else "disable",
            "gateway enabled" if enabled else "gateway disabled",
            {"enabled": (not enabled, enabled)},
        )
    return row


# --------------------------------------------------------------------------------------
# Connection test
# --------------------------------------------------------------------------------------
def test_connection(gateway: PaymentGateway, *, ctx: AuditContext) -> dict:
    """Ask the adapter to check its credentials without starting a payment. Adapters
    with no safe check say so (``supported: false``): that is reported, never as a pass."""
    if not cache.add(f"gateway-test:{gateway.pk}", 1, TEST_COOLDOWN_SECONDS):
        raise GatewayAdminError(
            "test_too_soon", _("Wait a few seconds before testing again."), status=429
        )
    issues = gateway_manager.gateway_issues(gateway)
    if issues:
        result = {"supported": True, "ok": False, "message": issues[0]}
    else:
        try:
            adapter = gateway_manager.adapter_for_offer(gateway_manager._db_offer(gateway))
            outcome = adapter.test_connection()
            result = {"supported": outcome.supported, "ok": outcome.ok, "message": outcome.message}
        except GatewayError as exc:
            result = {"supported": True, "ok": False, "message": exc.reason}
        except Exception as exc:  # noqa: BLE001 - an adapter bug must not become a 500 here
            # Only the exception TYPE is logged: its text may quote request headers.
            logger.error(
                "Gateway connection test crashed gateway=%s type=%s", gateway.pk, type(exc).__name__
            )
            result = {"supported": True, "ok": False, "message": "unexpected_error"}
    now = timezone.now()
    with transaction.atomic():
        row = PaymentGateway.objects.select_for_update().get(pk=gateway.pk)
        row.last_test_at = now
        row.last_test_ok = result["ok"] if result["supported"] else None
        row.last_test_message = str(result["message"])[:200]
        update = ["last_test_at", "last_test_ok", "last_test_message", "updated_at"]
        if result["supported"] and result["ok"]:
            row.last_connected_at = now
            update.append("last_connected_at")
        row.save(update_fields=update)
        gateway_store.log_event(
            row,
            GatewayLogType.CONNECTION_TEST,
            ctx=ctx,
            summary="passed"
            if result["ok"]
            else ("not supported" if not result["supported"] else "failed"),
            details={
                "mode": row.mode,
                "supported": result["supported"],
                "ok": result["ok"],
                "message": result["message"],
            },
        )
    return result


# --------------------------------------------------------------------------------------
# Testers and test subscriptions
# --------------------------------------------------------------------------------------
def tester_view(tester: PaymentTester) -> dict:
    user = tester.user
    return {
        "user_id": user.pk,
        "full_name": user.full_name,
        "mobile_number": _mask(user.mobile_number),
        "added_at": tester.created_at,
    }


def _mask(number: str) -> str:
    return f"{number[:3]}{'*' * max(len(number) - 6, 0)}{number[-3:]}" if number else ""


def add_tester(user_id, *, ctx: AuditContext) -> PaymentTester:
    user = User.objects.filter(pk=user_id, role=Role.STUDENT, is_active=True).first()
    if user is None:
        raise GatewayAdminError(
            "tester_not_found", _("No active student account with this id."), status=404
        )
    with transaction.atomic():
        tester, created = PaymentTester.objects.get_or_create(
            user=user, defaults={"added_by": ctx.actor}
        )
        if created:
            audit.record(
                ctx,
                action="payment_tester.add",
                entity_type="payments.tester",
                entity_id=user.pk,
                summary=f"payment tester added (user {user.pk})",
            )
    return tester


def remove_tester(user_id, *, ctx: AuditContext) -> None:
    with transaction.atomic():
        deleted, _count = PaymentTester.objects.filter(user_id=user_id).delete()
        if not deleted:
            raise Http404
        audit.record(
            ctx,
            action="payment_tester.remove",
            entity_type="payments.tester",
            entity_id=user_id,
            summary=f"payment tester removed (user {user_id})",
        )


def revoke_test_subscription(subscription_id, *, ctx: AuditContext) -> Subscription:
    """Cancel a TEST subscription at once. Real subscriptions are refused here (they have
    their own cancel); a test one that is already over reports that."""
    with transaction.atomic():
        subscription = Subscription.objects.filter(pk=subscription_id, is_test=True).first()
        if subscription is None:
            raise Http404
        return cancel_subscription(subscription.pk, ctx=ctx)


# --------------------------------------------------------------------------------------
# Statistics (sandbox kept apart from business numbers)
# --------------------------------------------------------------------------------------
def stats() -> dict:
    from django.db.models import Count, Q, Sum

    columns = {
        "total": Count("id"),
        "success": Count("id", filter=Q(status=PaymentStatus.SUCCESS)),
        "failed": Count("id", filter=Q(status__in=[PaymentStatus.FAILED, PaymentStatus.CANCELLED])),
        "pending": Count(
            "id", filter=Q(status__in=[PaymentStatus.INITIATED, PaymentStatus.PENDING])
        ),
        "collected": Sum("amount", filter=Q(status=PaymentStatus.SUCCESS)),
    }

    def block(queryset):
        result = queryset.aggregate(**columns)
        result["collected"] = f"{result['collected'] or 0:.2f}"
        return result

    real = Payment.objects.exclude(mode=GatewayMode.SANDBOX)
    sandbox = Payment.objects.filter(mode=GatewayMode.SANDBOX)
    per_gateway = []
    for gateway in PaymentGateway.objects.all():
        per_gateway.append(
            {
                "id": str(gateway.public_id),
                "slug": gateway.slug,
                "adapter": gateway.adapter,
                "live": block(real.filter(gateway=gateway)),
                "sandbox": block(sandbox.filter(gateway=gateway)),
            }
        )
    return {
        "real": block(real),
        "sandbox": block(sandbox),
        "gateways": per_gateway,
        "payment_switch": payment_switch(),
    }


def payment_switch() -> str:
    """The server-level ``PAYMENT_PROVIDER`` setting as a stable code for the panel (never a
    credential): ``unavailable`` (nothing is offered), ``database`` (only this panel's gateways)
    or ``environment`` (this panel's gateways plus the environment fallback)."""
    from django.conf import settings

    from .gateways import PAYMENTS_DATABASE, PAYMENTS_UNAVAILABLE

    if settings.PAYMENT_PROVIDER in (PAYMENTS_UNAVAILABLE, PAYMENTS_DATABASE):
        return settings.PAYMENT_PROVIDER
    return "environment"
