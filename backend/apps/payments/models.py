"""Payments and their append-only event log (docs/DATABASE_DESIGN.md §4.9).

- A **payment** is one attempt by one student to buy one package through one provider.
  ``amount``/``currency`` are a snapshot of the package price **at initiation**; later
  price changes never touch it, and verification compares the provider's figures with
  this snapshot only.
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
from apps.subscriptions.models import Currency, Package, Subscription, money_field

MERCHANT_REFERENCE_MAX_LENGTH = 30  # SSLCommerz tran_id limit
IDEMPOTENCY_KEY_MAX_LENGTH = 64
PROVIDER_ID_MAX_LENGTH = 100
FAILURE_REASON_MAX_LENGTH = 64
CHECKOUT_URL_MAX_LENGTH = 500


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
    NAGAD = "nagad", _("Nagad")  # future gateway


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
    provider = models.CharField(_("provider"), max_length=20, choices=PaymentProvider.choices)
    amount = money_field(_("amount"))
    currency = models.CharField(_("currency"), max_length=3, choices=Currency.choices)
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
                condition=models.Q(provider__in=PaymentProvider.values),
                name="payments_provider_valid",
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
