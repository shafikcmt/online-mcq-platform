"""Payments and their append-only event log (docs/DATABASE_DESIGN.md §4.9).

- A **payment** is one attempt by one student to buy one package through one provider.
  ``amount``/``currency``/``validity_days`` are a snapshot of the package's commercial
  contract **at initiation** (price and duration bought). Later package edits never touch
  them: verification compares the provider's figures with ``amount``/``currency`` only,
  and the subscription a verified payment creates or extends runs for ``validity_days``
  (never the package's current validity). A PostgreSQL trigger (migration 0002) rejects
  any change to the three snapshot columns after the row is created.
- ``status`` moves forward only (``services`` is the only writer)::

      initiated → pending → success | failed | cancelled
      initiated → failed                     (provider session could not be created)

  ``success`` never changes again. The **only** way out of ``failed``/``cancelled`` is the
  late-success recovery (``failed|cancelled → success``): when the provider itself, server
  to server, later proves the transaction was paid (``services.apply_verification``; event
  reason ``late_provider_success``). Provider authenticity is established only there, by
  the server-side gateway verification. A PostgreSQL trigger additionally prevents
  accidental or ordinary direct status mutations that violate the state machine (it guards
  the shape of transitions, not that a verification happened).
- ``subscription`` is the subscription this payment **created or extended** (set in the
  verification transaction). Renewals extend one row, so several payments may point to
  the same subscription; there is no ``subscriptions.payment_id``. Manual admin grants
  have no payment at all.
- ``provider_transaction_id`` is unique when present: one provider transaction can
  never pay for two payments.

**Payment events** are append-only (model, queryset and a PostgreSQL trigger refuse
UPDATE/DELETE). Payloads are sanitized by ``payments.sanitize`` before they get here.
"""

import uuid

from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.core.models import TimeStampedModel
from apps.subscriptions.models import (
    MAX_VALIDITY_DAYS,
    Currency,
    Package,
    Subscription,
    money_field,
)

MERCHANT_REFERENCE_MAX_LENGTH = 30  # SSLCommerz tran_id limit
IDEMPOTENCY_KEY_MAX_LENGTH = 64
PROVIDER_ID_MAX_LENGTH = 100
FAILURE_REASON_MAX_LENGTH = 64
CHECKOUT_URL_MAX_LENGTH = 500
PROVIDER_CODE_PATTERN = r"^[a-z][a-z0-9_]{0,19}$"


class PaymentStatus(models.TextChoices):
    INITIATED = "initiated", _("Initiated")
    PENDING = "pending", _("Pending")
    SUCCESS = "success", _("Successful")
    FAILED = "failed", _("Failed")
    CANCELLED = "cancelled", _("Cancelled")


TERMINAL_STATUSES = (PaymentStatus.SUCCESS, PaymentStatus.FAILED, PaymentStatus.CANCELLED)
OPEN_STATUSES = (PaymentStatus.INITIATED, PaymentStatus.PENDING)

# Allowed transitions (forward only). Enforced by ``services``; the database keeps the
# consistency rules of each status as the last guard.
TRANSITIONS = {
    PaymentStatus.INITIATED: (PaymentStatus.PENDING, PaymentStatus.FAILED),
    PaymentStatus.PENDING: (PaymentStatus.SUCCESS, PaymentStatus.FAILED, PaymentStatus.CANCELLED),
    PaymentStatus.SUCCESS: (),
    PaymentStatus.FAILED: (),
    PaymentStatus.CANCELLED: (),
}
# Provider-verified late success only (never a normal transition, never from a request).
RECOVERY_TRANSITIONS = {
    PaymentStatus.FAILED: (PaymentStatus.SUCCESS,),
    PaymentStatus.CANCELLED: (PaymentStatus.SUCCESS,),
}
LATE_SUCCESS_REASON = "late_provider_success"


class PaymentProvider(models.TextChoices):
    MOCK = "mock", _("Mock (development)")
    SSLCOMMERZ = "sslcommerz", _("SSLCommerz")
    BKASH = "bkash", _("bKash")  # future gateway (same interface, no schema change)
    NAGAD = "nagad", _("Nagad")  # registered, adapter not implemented
    ROCKET = "rocket", _("Rocket")  # registered, adapter not implemented


class Payment(TimeStampedModel):
    public_id = models.UUIDField(_("public ID"), default=uuid.uuid4, unique=True, editable=False)
    merchant_reference = models.CharField(
        _("merchant reference"), max_length=MERCHANT_REFERENCE_MAX_LENGTH, unique=True
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name=_("user"),
        on_delete=models.PROTECT,
        related_name="payments",
    )
    package = models.ForeignKey(
        Package, verbose_name=_("package"), on_delete=models.PROTECT, related_name="payments"
    )
    subscription = models.ForeignKey(
        Subscription,
        verbose_name=_("subscription"),
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="payments",
    )
    # The adapter code (``PaymentProvider`` lists the known ones). Deliberately NOT a fixed
    # choice list: a new adapter must not need a migration (see ``payments_provider_valid``).
    provider = models.CharField(_("provider"), max_length=20)
    # The configured gateway (merchant account) that took this payment, and the mode it was
    # in at initiation. NULL / "" for payments made before gateways were stored in the
    # database (those used the environment configuration). Frozen after creation.
    gateway = models.ForeignKey(
        "PaymentGateway",
        verbose_name=_("gateway"),
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="payments",
        editable=False,
    )
    mode = models.CharField(_("mode"), max_length=10, blank=True, default="", editable=False)
    amount = money_field(_("amount"))
    currency = models.CharField(_("currency"), max_length=3, choices=Currency.choices)
    # Snapshot of the package's validity at initiation: the duration this payment buys.
    validity_days = models.PositiveIntegerField(_("validity (days)"), editable=False)
    status = models.CharField(
        _("status"),
        max_length=10,
        choices=PaymentStatus.choices,
        default=PaymentStatus.INITIATED,
        editable=False,
    )
    provider_payment_id = models.CharField(
        _("provider payment ID"), max_length=PROVIDER_ID_MAX_LENGTH, blank=True
    )
    # NULL until verified (unique when present: a partial unique index).
    provider_transaction_id = models.CharField(  # noqa: DJ001
        _("provider transaction ID"), max_length=PROVIDER_ID_MAX_LENGTH, null=True, blank=True
    )
    checkout_url = models.CharField(
        _("checkout URL"), max_length=CHECKOUT_URL_MAX_LENGTH, blank=True
    )
    idempotency_key = models.CharField(
        _("idempotency key"), max_length=IDEMPOTENCY_KEY_MAX_LENGTH, blank=True
    )
    verified_at = models.DateTimeField(_("verified at"), null=True, blank=True)
    failure_reason = models.CharField(
        _("failure reason"), max_length=FAILURE_REASON_MAX_LENGTH, blank=True
    )
    raw_verification = models.JSONField(_("verification response"), null=True, blank=True)
    # Reconciliation bookkeeping: the least recently checked open payments go first.
    last_checked_at = models.DateTimeField(_("last checked at"), null=True, blank=True)

    class Meta:
        verbose_name = _("payment")
        verbose_name_plural = _("payments")
        ordering = ("-created_at", "-id")
        constraints = [
            models.CheckConstraint(condition=models.Q(amount__gt=0), name="payments_amount_valid"),
            models.CheckConstraint(
                condition=models.Q(currency__in=Currency.values), name="payments_currency_valid"
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=PaymentStatus.values), name="payments_status_valid"
            ),
            models.CheckConstraint(
                condition=models.Q(validity_days__gte=1, validity_days__lte=MAX_VALIDITY_DAYS),
                name="payments_validity_days_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(provider__regex=PROVIDER_CODE_PATTERN),
                name="payments_provider_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(mode__in=["", "sandbox", "live"]),
                name="payments_mode_valid",
            ),
            # Success always carries its proof and the subscription it paid for.
            models.CheckConstraint(
                condition=~models.Q(status=PaymentStatus.SUCCESS)
                | (
                    models.Q(verified_at__isnull=False)
                    & models.Q(provider_transaction_id__isnull=False)
                    & models.Q(subscription__isnull=False)
                ),
                name="payments_success_complete",
            ),
            # Only a successful payment is linked to a subscription.
            models.CheckConstraint(
                condition=models.Q(subscription__isnull=True)
                | models.Q(status=PaymentStatus.SUCCESS),
                name="payments_subscription_needs_success",
            ),
            models.UniqueConstraint(
                fields=["provider_transaction_id"],
                condition=models.Q(provider_transaction_id__isnull=False),
                name="payments_unique_provider_transaction",
            ),
            models.UniqueConstraint(
                fields=["user", "idempotency_key"],
                condition=~models.Q(idempotency_key=""),
                name="payments_unique_idempotency_key",
            ),
        ]
        indexes = [
            models.Index(fields=["user", "-created_at"], name="payments_user_created_idx"),
            models.Index(fields=["status", "created_at"], name="payments_status_created_idx"),
        ]

    def __str__(self) -> str:
        return f"payment {self.merchant_reference} · {self.status}"

    @property
    def is_open(self) -> bool:
        return self.status in OPEN_STATUSES


class PaymentEventType(models.TextChoices):
    INITIATED = "initiated", _("Initiated")
    CALLBACK_RECEIVED = "callback_received", _("Callback received")
    IPN_RECEIVED = "ipn_received", _("IPN received")
    VERIFY_REQUEST = "verify_request", _("Verification requested")
    VERIFY_RESPONSE = "verify_response", _("Verification response")
    STATUS_CHANGED = "status_changed", _("Status changed")
    RECONCILIATION = "reconciliation", _("Reconciliation")
    ADMIN_REVERIFY = "admin_reverify", _("Admin re-verification")


class PaymentEventImmutable(Exception):
    """Raised when code tries to change or delete a payment event."""


class PaymentEventQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise PaymentEventImmutable("Payment events cannot be changed.")

    def delete(self):
        raise PaymentEventImmutable("Payment events cannot be deleted.")


class PaymentEvent(models.Model):
    payment = models.ForeignKey(
        Payment, verbose_name=_("payment"), on_delete=models.PROTECT, related_name="events"
    )
    event_type = models.CharField(_("event type"), max_length=32, choices=PaymentEventType.choices)
    payload = models.JSONField(_("payload"), default=dict, blank=True)  # sanitized
    source_ip = models.GenericIPAddressField(_("source IP"), null=True, blank=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    objects = PaymentEventQuerySet.as_manager()

    class Meta:
        verbose_name = _("payment event")
        verbose_name_plural = _("payment events")
        ordering = ("created_at", "id")
        constraints = [
            models.CheckConstraint(
                condition=models.Q(event_type__in=PaymentEventType.values),
                name="payments_event_type_valid",
            ),
        ]
        indexes = [
            models.Index(fields=["payment", "created_at"], name="payments_event_payment_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.event_type} · payment #{self.payment_id}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise PaymentEventImmutable("Payment events cannot be changed.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise PaymentEventImmutable("Payment events cannot be deleted.")


# --------------------------------------------------------------------------------------
# Configured gateways (admin-managed). One row = one merchant account on one adapter, so
# the same adapter can be configured more than once (e.g. two bKash merchants).
# --------------------------------------------------------------------------------------
GATEWAY_SLUG_PATTERN = r"^[a-z][a-z0-9-]{1,39}$"
CREDENTIAL_FIELD_PATTERN = r"^[a-z][a-z0-9_]{0,39}$"
GATEWAY_TEXT_LENGTH = 120
GATEWAY_DESCRIPTION_LENGTH = 300
GATEWAY_URL_LENGTH = 500


class GatewayMode(models.TextChoices):
    SANDBOX = "sandbox", _("Sandbox")
    LIVE = "live", _("Live")


class PaymentGateway(TimeStampedModel):
    """A gateway configuration the admin manages. It holds NO secrets: those live encrypted
    in ``PaymentGatewayCredential``. ``adapter`` names the code that talks to the provider
    (``apps.payments.gateways``); a row cannot do anything the adapter does not implement.

    Going live is guarded by ``gateway_store`` (credentials complete AND one successful
    sandbox payment recorded for this gateway)."""

    public_id = models.UUIDField(_("public ID"), default=uuid.uuid4, unique=True, editable=False)
    slug = models.SlugField(_("slug"), max_length=40, unique=True)
    adapter = models.CharField(_("adapter"), max_length=20)

    name_en = models.CharField(_("name (English)"), max_length=GATEWAY_TEXT_LENGTH)
    name_bn = models.CharField(_("name (Bangla)"), max_length=GATEWAY_TEXT_LENGTH, blank=True)
    description_en = models.CharField(
        _("description (English)"), max_length=GATEWAY_DESCRIPTION_LENGTH, blank=True
    )
    description_bn = models.CharField(
        _("description (Bangla)"), max_length=GATEWAY_DESCRIPTION_LENGTH, blank=True
    )
    logo_url = models.CharField(_("logo URL (https)"), max_length=GATEWAY_URL_LENGTH, blank=True)

    enabled = models.BooleanField(_("enabled"), default=False)
    mode = models.CharField(
        _("mode"), max_length=10, choices=GatewayMode.choices, default=GatewayMode.SANDBOX
    )
    priority = models.PositiveSmallIntegerField(_("priority (lower first)"), default=100)

    # Where the gateway is offered, and where the student returns to afterwards.
    web_enabled = models.BooleanField(_("offered on the website"), default=True)
    app_enabled = models.BooleanField(_("offered in the mobile app"), default=True)
    web_return_url = models.CharField(
        _("website return URL"), max_length=GATEWAY_URL_LENGTH, blank=True
    )
    app_return_url = models.CharField(
        _("app return URL"), max_length=GATEWAY_URL_LENGTH, blank=True
    )

    currencies = models.JSONField(_("supported currencies"), default=list)
    min_amount = money_field(_("minimum amount"), null=True, blank=True)
    max_amount = money_field(_("maximum amount"), null=True, blank=True)
    # Non-secret, adapter-specific options (validated against the adapter's schema).
    options = models.JSONField(_("options"), default=dict, blank=True)

    # Health: written by the connection test only.
    last_test_at = models.DateTimeField(_("last test at"), null=True, blank=True)
    last_test_ok = models.BooleanField(_("last test passed"), null=True, blank=True)
    last_test_message = models.CharField(_("last test message"), max_length=200, blank=True)
    last_connected_at = models.DateTimeField(_("last successful connection"), null=True, blank=True)

    class Meta:
        verbose_name = _("payment gateway")
        verbose_name_plural = _("payment gateways")
        ordering = ("priority", "id")
        constraints = [
            models.CheckConstraint(
                condition=models.Q(slug__regex=GATEWAY_SLUG_PATTERN), name="gateway_slug_valid"
            ),
            models.CheckConstraint(
                condition=models.Q(adapter__regex=PROVIDER_CODE_PATTERN),
                name="gateway_adapter_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(mode__in=GatewayMode.values), name="gateway_mode_valid"
            ),
            models.CheckConstraint(
                condition=models.Q(min_amount__isnull=True) | models.Q(min_amount__gt=0),
                name="gateway_min_amount_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(max_amount__isnull=True)
                | models.Q(min_amount__isnull=True)
                | models.Q(max_amount__gte=models.F("min_amount")),
                name="gateway_amount_range_valid",
            ),
        ]
        indexes = [models.Index(fields=["adapter", "enabled"], name="gateway_adapter_enabled_idx")]

    def __str__(self) -> str:
        return f"{self.slug} ({self.adapter}, {self.mode})"

    def name_for(self, lang: str) -> str:
        return self.name_bn if lang.startswith("bn") and self.name_bn else self.name_en

    def description_for(self, lang: str) -> str:
        if lang.startswith("bn") and self.description_bn:
            return self.description_bn
        return self.description_en


class PaymentGatewayCredential(TimeStampedModel):
    """One secret of one gateway in one mode (sandbox and live never share a row). The value
    is Fernet-encrypted (``apps.core.secret_box``; the key is only in the environment) and is
    never returned by any API: only the last four characters are kept as a hint."""

    gateway = models.ForeignKey(
        PaymentGateway,
        verbose_name=_("gateway"),
        on_delete=models.CASCADE,
        related_name="credentials",
    )
    mode = models.CharField(_("mode"), max_length=10, choices=GatewayMode.choices)
    field = models.CharField(_("field"), max_length=40)
    value_encrypted = models.TextField(editable=False)
    hint = models.CharField(max_length=4, blank=True, editable=False)

    class Meta:
        verbose_name = _("payment gateway credential")
        verbose_name_plural = _("payment gateway credentials")
        ordering = ("gateway_id", "mode", "field")
        constraints = [
            models.UniqueConstraint(
                fields=["gateway", "mode", "field"], name="gateway_credential_unique"
            ),
            models.CheckConstraint(
                condition=models.Q(mode__in=GatewayMode.values),
                name="gateway_credential_mode_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(field__regex=CREDENTIAL_FIELD_PATTERN),
                name="gateway_credential_field_valid",
            ),
        ]

    def __str__(self) -> str:  # never includes the value
        return f"{self.gateway.slug}/{self.mode}/{self.field}"

    def __repr__(self) -> str:
        return f"<PaymentGatewayCredential {self}>"


class GatewayLogType(models.TextChoices):
    CREATED = "created", _("Created")
    CONFIG_CHANGED = "config_changed", _("Configuration changed")
    CREDENTIAL_CHANGED = "credential_changed", _("Credential changed")
    MODE_CHANGED = "mode_changed", _("Mode changed")
    ENABLED = "enabled", _("Enabled")
    DISABLED = "disabled", _("Disabled")
    CONNECTION_TEST = "connection_test", _("Connection test")
    ERROR = "error", _("Gateway error")


class PaymentGatewayLogQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise PaymentEventImmutable("Gateway log entries cannot be changed.")

    def delete(self):
        raise PaymentEventImmutable("Gateway log entries cannot be deleted.")


class PaymentGatewayLog(models.Model):
    """Append-only history of one gateway: who changed what, connection tests, provider
    errors. ``details`` is sanitized and never holds a secret value (only field NAMES)."""

    gateway = models.ForeignKey(
        PaymentGateway, verbose_name=_("gateway"), on_delete=models.PROTECT, related_name="logs"
    )
    event_type = models.CharField(_("event type"), max_length=24, choices=GatewayLogType.choices)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name=_("actor"),
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
    )
    summary = models.CharField(_("summary"), max_length=200, blank=True)
    details = models.JSONField(_("details"), default=dict, blank=True)
    source_ip = models.GenericIPAddressField(_("source IP"), null=True, blank=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    objects = PaymentGatewayLogQuerySet.as_manager()

    class Meta:
        verbose_name = _("gateway log entry")
        verbose_name_plural = _("gateway log entries")
        ordering = ("-created_at", "-id")
        constraints = [
            models.CheckConstraint(
                condition=models.Q(event_type__in=GatewayLogType.values),
                name="gateway_log_type_valid",
            ),
        ]
        indexes = [models.Index(fields=["gateway", "-created_at"], name="gateway_log_gateway_idx")]

    def __str__(self) -> str:
        return f"{self.event_type} · gateway #{self.gateway_id}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise PaymentEventImmutable("Gateway log entries cannot be changed.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise PaymentEventImmutable("Gateway log entries cannot be deleted.")
