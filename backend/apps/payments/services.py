"""Payments: every status change goes through here (docs/ARCHITECTURE.md §6.4).

The rule: **only a server-to-server verification can make a payment successful.**
Callbacks, IPNs, the app and admins can only ask for a verification.

- ``initiate_payment``  — snapshot of the server-side package's price, currency and
  validity (the contract bought); gateway session.
- ``process_callback``  — browser callback / IPN → event → provider verification →
  ``apply_verification``. Fail/cancel callbacks also ask the provider (``query``), so a
  forged "cancel" cannot end a payment that was in fact paid.
- ``apply_verification`` — the single place where a provider answer changes a payment.
  It locks the payment row, re-reads its status and is idempotent: a payment that is
  already successful is returned unchanged, a terminal one never changes again. A
  ``PAID`` answer succeeds only if reference, amount and currency equal our snapshot
  and the provider transaction ID is not used by another payment; then, in the **same
  transaction**, ``subscriptions.services.grant_subscription`` creates or extends the
  subscription (4A renewal rules) for the payment's ``validity_days`` snapshot and the
  payment records it. Every success path (callback, IPN, late success, reconciliation,
  admin re-verify) goes through here, so all of them use the snapshot.
- ``reconcile_payments`` (Celery beat) and ``admin_reverify`` re-query the provider and
  use the same ``apply_verification``.
- **Late-success recovery** (the one exception to forward-only): a ``failed``/``cancelled``
  payment becomes ``success`` only inside ``apply_verification``, only for a provider
  answer (server to server) that says *paid* and matches provider, reference, amount,
  currency and an unused transaction ID. The real payment then creates/extends the
  subscription itself (never a manual grant). Anything contradictory is recorded and left
  for admin review.

Provider HTTP calls never run inside a transaction or while a row is locked.
Logs carry ids, references, provider and statuses only — never contact data, secrets
or provider payloads (those go, sanitized, to ``payment_events``).
"""

import logging
import math
import secrets
from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import F, Q
from django.urls import reverse
from django.utils import timezone

from apps.audit import services as audit
from apps.audit.services import AuditContext
from apps.notifications.services import notify_payment_success
from apps.subscriptions.models import Package, PackageStatus
from apps.subscriptions.services import grant_subscription

from .exceptions import (
    ALREADY_SUCCESSFUL_MESSAGE,
    IDEMPOTENCY_KEY_REUSED_MESSAGE,
    NOT_STUDENT_MESSAGE,
    PACKAGE_INACTIVE_MESSAGE,
    PACKAGE_MISSING_MESSAGE,
    PACKAGE_NOT_PURCHASABLE_MESSAGE,
    PAYMENT_UNAVAILABLE_MESSAGE,
    PAYMENTS_DISABLED_MESSAGE,
    PROVIDER_DISABLED_MESSAGE,
    PROVIDER_NOT_OFFERED_MESSAGE,
    REVERIFY_TOO_SOON_MESSAGE,
    PaymentError,
)
from .gateways import (
    PAYMENTS_UNAVAILABLE,
    CallbackKind,
    CallbackUrls,
    Customer,
    GatewayError,
    Outcome,
    VerificationResult,
    get_gateway,
    is_enabled,
    offered_providers,
)
from .models import (
    LATE_SUCCESS_REASON,
    OPEN_STATUSES,
    RECOVERY_TRANSITIONS,
    TERMINAL_STATUSES,
    TRANSITIONS,
    Payment,
    PaymentEvent,
    PaymentEventType,
    PaymentStatus,
)
from .sanitize import sanitize

logger = logging.getLogger(__name__)

REFERENCE_PREFIX = "MCQ"
SYSTEM = AuditContext()  # payment-driven grants have no human actor


# --------------------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------------------
def new_reference() -> str:
    """Our transaction ID sent to the provider: unguessable, ASCII, ≤ 30 characters."""
    return REFERENCE_PREFIX + secrets.token_hex(12).upper()


def record_event(payment: Payment, event_type: str, payload: dict | None = None, ip=None):
    return PaymentEvent.objects.create(
        payment=payment, event_type=event_type, payload=sanitize(payload or {}), source_ip=ip
    )


def callback_urls(provider: str) -> CallbackUrls:
    """Server-configured return URLs (never taken from the client)."""
    base = settings.PAYMENT_CALLBACK_BASE_URL.rstrip("/")

    def url(kind: str) -> str:
        if kind == CallbackKind.IPN:
            return base + reverse("api_v1:payments:payment-ipn", kwargs={"provider": provider})
        return base + reverse(
            "api_v1:payments:payment-callback", kwargs={"provider": provider, "kind": kind}
        )

    return CallbackUrls(
        success=url(CallbackKind.SUCCESS),
        fail=url(CallbackKind.FAIL),
        cancel=url(CallbackKind.CANCEL),
        ipn=url(CallbackKind.IPN),
    )


def _log_change(payment: Payment, old: str, reason: str = "") -> None:
    logger.info(
        "Payment status changed payment=%s ref=%s provider=%s from=%s to=%s user=%s "
        "package=%s reason=%s",
        payment.public_id,
        payment.merchant_reference,
        payment.provider,
        old,
        payment.status,
        payment.user_id,
        payment.package_id,
        reason or "-",
    )


def _move(
    payment: Payment,
    target: str,
    *,
    reason: str = "",
    ip=None,
    fields=(),
    recovery: bool = False,
    previous_reason: str = "",
) -> None:
    """Forward-only transition (on a locked row); passes through ``pending`` when a
    provider answer arrives for a payment still marked ``initiated``. ``recovery`` (only
    passed by the provider-verified late-success path) additionally allows
    ``failed|cancelled → success``."""
    if target not in TRANSITIONS[payment.status] and payment.status == PaymentStatus.INITIATED:
        _move(payment, PaymentStatus.PENDING, reason="provider_answer", ip=ip)
    allowed = TRANSITIONS[payment.status]
    if recovery:
        allowed = (*allowed, *RECOVERY_TRANSITIONS.get(payment.status, ()))
    if target not in allowed:
        raise RuntimeError(f"Illegal payment transition {payment.status} → {target}")
    old = payment.status
    payment.status = target
    if reason and target in (PaymentStatus.FAILED, PaymentStatus.CANCELLED):
        payment.failure_reason = reason[:64]
    payment.save(update_fields=["status", "failure_reason", *fields, "updated_at"])
    payload = {"from": old, "to": target, "reason": reason}
    if previous_reason:
        payload["previous_reason"] = previous_reason
    record_event(payment, PaymentEventType.STATUS_CHANGED, payload, ip)
    _log_change(payment, old, reason)


# --------------------------------------------------------------------------------------
# Initiation
# --------------------------------------------------------------------------------------
def initiate_payment(user, package_id, *, idempotency_key: str = "", ip=None, provider: str = ""):
    """Start buying ``package_id``. Returns ``(payment, created)``; a repeated
    ``idempotency_key`` returns the earlier payment (``created=False``).

    The amount, currency and validity are the package's **current server-side** values,
    frozen on the payment (the package row is locked); the client only names the package
    and, optionally, which of the offered payment methods (``provider``) it wants. Without
    one, the first offered method is used."""
    if not (user.is_active and user.is_student):
        raise PaymentError("not_student", NOT_STUDENT_MESSAGE, status=403)
    if settings.PAYMENT_PROVIDER == PAYMENTS_UNAVAILABLE:
        # This server takes no payments (no merchant credentials yet): refuse before
        # anything is written — not even an earlier payment is replayed by its key.
        raise PaymentError("payment_unavailable", PAYMENTS_DISABLED_MESSAGE, status=503)
    requested = (provider or "").strip()
    with transaction.atomic():
        if idempotency_key:
            existing = Payment.objects.filter(user=user, idempotency_key=idempotency_key).first()
            if existing is not None:
                return _same_request(existing, package_id, requested), False
        offered = offered_providers()
        if not offered:
            logger.error("No payment provider is enabled")
            raise PaymentError("payment_unavailable", PAYMENT_UNAVAILABLE_MESSAGE, status=503)
        provider = requested or offered[0]
        if provider not in offered:
            raise PaymentError("provider_not_offered", PROVIDER_NOT_OFFERED_MESSAGE, status=400)
        # NO KEY UPDATE: a concurrent price change waits for this snapshot (or is seen).
        package = Package.objects.select_for_update(no_key=True).filter(pk=package_id).first()
        if package is None:
            raise ValidationError(
                {"package_id": ValidationError(PACKAGE_MISSING_MESSAGE, code="does_not_exist")}
            )
        if package.status != PackageStatus.ACTIVE:
            raise PaymentError("package_inactive", PACKAGE_INACTIVE_MESSAGE)
        if package.price <= 0:
            raise PaymentError("package_not_purchasable", PACKAGE_NOT_PURCHASABLE_MESSAGE)
        payment = Payment(
            merchant_reference=new_reference(),
            user=user,
            package=package,
            provider=provider,
            amount=package.price,
            currency=package.currency,
            validity_days=package.validity_days,
            idempotency_key=idempotency_key,
        )
        try:
            with transaction.atomic():
                payment.save()
        except IntegrityError:
            if not idempotency_key:
                raise
            # The same key raced in from another request: answer with that payment.
            existing = Payment.objects.get(user=user, idempotency_key=idempotency_key)
            return _same_request(existing, package_id, requested), False
        record_event(
            payment,
            PaymentEventType.INITIATED,
            {
                "provider": provider,
                "amount_expected": f"{payment.amount:.2f}",
                "currency_expected": payment.currency,
            },
            ip,
        )
        logger.info(
            "Payment initiated payment=%s ref=%s provider=%s user=%s package=%s",
            payment.public_id,
            payment.merchant_reference,
            provider,
            user.pk,
            package.pk,
        )

    # Provider session — outside any transaction (network call).
    try:
        session = get_gateway(provider).initiate(
            payment,
            urls=callback_urls(provider),
            customer=Customer(
                name=user.full_name or "", phone=user.mobile_number or "", email=user.email or ""
            ),
        )
        error = ""
    except GatewayError as exc:
        session, error = None, exc.reason

    with transaction.atomic():
        payment = Payment.objects.select_for_update().get(pk=payment.pk)
        if payment.status != PaymentStatus.INITIATED:
            return payment, True  # a provider answer already moved it on
        if session is None:
            _move(payment, PaymentStatus.FAILED, reason="initiation_failed", ip=ip)
            record_event(
                payment, PaymentEventType.VERIFY_RESPONSE, {"source": "initiate", "error": error}
            )
            logger.warning(
                "Payment initiation failed payment=%s provider=%s reason=%s",
                payment.public_id,
                provider,
                error,
            )
        else:
            payment.checkout_url = session.checkout_url[:500]
            payment.provider_payment_id = session.provider_payment_id[:100]
            _move(
                payment,
                PaymentStatus.PENDING,
                ip=ip,
                fields=("checkout_url", "provider_payment_id"),
            )
    return payment, True


def _same_request(existing: Payment, package_id, provider: str = "") -> Payment:
    if str(existing.package_id) != str(package_id) or (provider and existing.provider != provider):
        raise PaymentError("idempotency_key_reused", IDEMPOTENCY_KEY_REUSED_MESSAGE)
    return existing


# --------------------------------------------------------------------------------------
# Applying a provider answer (the only path to success)
# --------------------------------------------------------------------------------------
def _check_paid(payment: Payment, result: VerificationResult) -> str:
    """'' when the provider's facts match our record, else the failure reason."""
    if result.amount is None or result.amount != payment.amount:
        return "amount_mismatch"
    if result.currency != payment.currency:
        return "currency_mismatch"
    if (
        Payment.objects.filter(provider_transaction_id=result.provider_transaction_id)
        .exclude(pk=payment.pk)
        .exists()
    ):
        return "duplicate_transaction"
    return ""


RECOVERY_AUDIT_FIELDS = ("merchant_reference", "subscription_id", "status")


def _succeed(payment: Payment, result: VerificationResult, now, ip, *, recovery=False) -> str:
    """Grant/extend the subscription and mark the payment successful — together or not
    at all (savepoint). Returns '' on success, else why the database/grant refused
    (a racing duplicate provider transaction ID, or a grant rule). ``recovery``: the
    provider-verified late success of a ``failed``/``cancelled`` payment."""
    previous_status, previous_reason = payment.status, payment.failure_reason
    try:
        with transaction.atomic():
            grant = grant_subscription(
                payment.user_id,
                payment.package_id,
                ctx=SYSTEM,
                price_paid=payment.amount,
                validity_days=payment.validity_days,  # the snapshot, never the package
                for_verified_payment=True,
            )
            payment.subscription = grant.subscription
            payment.provider_transaction_id = result.provider_transaction_id
            payment.verified_at = now
            payment.raw_verification = result.raw
            payment.failure_reason = ""
            _move(
                payment,
                PaymentStatus.SUCCESS,
                reason=LATE_SUCCESS_REASON if recovery else "",
                ip=ip,
                fields=(
                    "subscription",
                    "provider_transaction_id",
                    "verified_at",
                    "raw_verification",
                ),
                recovery=recovery,
                previous_reason=previous_reason if recovery else "",
            )
            # Same savepoint: rolled back with the success; one per payment (DB guard).
            notify_payment_success(payment)
            if recovery:
                audit.record(
                    SYSTEM,
                    action="payment.late_success_recover",
                    entity_type="payments.payment",
                    entity_id=payment.pk,
                    summary=f"payment {payment.merchant_reference}",
                    metadata={
                        "values": {
                            "merchant_reference": payment.merchant_reference,
                            "subscription_id": grant.subscription.pk,
                        },
                        "changes": {
                            "status": {"from": previous_status, "to": PaymentStatus.SUCCESS}
                        },
                    },
                    allowed_fields=RECOVERY_AUDIT_FIELDS,
                )
                logger.warning(
                    "Payment recovered by late provider success payment=%s from=%s",
                    payment.public_id,
                    previous_status,
                )
    except IntegrityError:
        payment.refresh_from_db()
        return "duplicate_transaction"
    except ValidationError as exc:
        payment.refresh_from_db()
        logger.error(
            "Verified payment could not be granted payment=%s codes=%s",
            payment.public_id,
            sorted({e.code for errors in exc.error_dict.values() for e in errors})
            if hasattr(exc, "error_dict")
            else "-",
        )
        return "grant_failed"
    logger.info(
        "Payment activated subscription payment=%s subscription=%s extended=%s",
        payment.public_id,
        grant.subscription.pk,
        grant.extended,
    )
    return ""


def apply_verification(payment_id, result: VerificationResult, *, source: str, ip=None):
    """Apply one provider answer to a payment. Idempotent and safe under concurrency
    (row lock + status re-read); returns the payment."""
    with transaction.atomic():
        payment = Payment.objects.select_for_update().get(pk=payment_id)
        now = timezone.now()
        payment.last_checked_at = now
        payment.save(update_fields=["last_checked_at"])
        decision = _decide(payment, result)
        record_event(
            payment,
            PaymentEventType.VERIFY_RESPONSE,
            {
                **result.raw,
                "source": source,
                "outcome": result.outcome,
                "reason": (LATE_SUCCESS_REASON if decision == "recover_paid" else decision)
                or result.reason,
                "merchant_reference": result.merchant_reference,
            },
            ip,
        )
        if decision == "apply_paid":
            refused = _succeed(payment, result, now, ip)
            if refused == "duplicate_transaction":
                payment.raw_verification = result.raw
                _move(
                    payment,
                    PaymentStatus.FAILED,
                    reason=refused,
                    ip=ip,
                    fields=("raw_verification",),
                )
            elif refused:
                # Paid but not grantable (should never happen): keep it open for support.
                payment.failure_reason = refused
                payment.raw_verification = result.raw
                payment.save(update_fields=["failure_reason", "raw_verification", "updated_at"])
        elif decision == "recover_paid":
            refused = _succeed(payment, result, now, ip, recovery=True)
            if refused:
                # Stays failed/cancelled; the answer is in the event log for admin review.
                logger.error(
                    "Late provider success not recovered payment=%s reason=%s",
                    payment.public_id,
                    refused,
                )
        elif decision.startswith("late_success_"):
            logger.error(
                "Late provider success rejected for review payment=%s reason=%s",
                payment.public_id,
                decision,
            )
        elif decision in ("amount_mismatch", "currency_mismatch", "duplicate_transaction"):
            logger.warning(
                "Payment verification mismatch payment=%s reason=%s", payment.public_id, decision
            )
            payment.raw_verification = result.raw
            _move(
                payment, PaymentStatus.FAILED, reason=decision, ip=ip, fields=("raw_verification",)
            )
        elif decision in ("apply_failed", "apply_cancelled"):
            payment.raw_verification = result.raw
            target = PaymentStatus.FAILED if decision == "apply_failed" else PaymentStatus.CANCELLED
            _move(
                payment,
                target,
                reason=result.reason or target,
                ip=ip,
                fields=("raw_verification",),
            )
        elif decision == "hold" and payment.failure_reason != result.reason:
            payment.failure_reason = result.reason[:64]
            payment.save(update_fields=["failure_reason", "updated_at"])
            logger.warning(
                "Payment held by provider payment=%s reason=%s", payment.public_id, result.reason
            )
        return payment


def _decide(payment: Payment, result: VerificationResult) -> str:
    """What a provider answer means for this payment (no side effects)."""
    if payment.status == PaymentStatus.SUCCESS:
        return "already_success"
    if result.outcome in (Outcome.PAID, Outcome.FAILED, Outcome.CANCELLED) and (
        result.merchant_reference != payment.merchant_reference
    ):
        # The answer is about another transaction (e.g. a replayed val_id): ignore it and
        # leave this payment untouched.
        logger.warning("Payment verification for another reference payment=%s", payment.public_id)
        return "reference_mismatch"
    if result.outcome == Outcome.PAID and result.provider != payment.provider:
        logger.warning("Payment verification from another provider payment=%s", payment.public_id)
        return "provider_mismatch"
    if payment.status in TERMINAL_STATUSES:
        if result.outcome != Outcome.PAID:
            return "already_closed"
        # The provider itself (server to server) says this closed payment was paid:
        # recover only if every fact matches; anything else is left for admin review.
        if not result.provider_transaction_id:
            return "late_success_missing_transaction_id"
        problem = _check_paid(payment, result)
        return f"late_success_{problem}" if problem else "recover_paid"
    if result.outcome == Outcome.PAID:
        if not result.provider_transaction_id:
            return "missing_transaction_id"
        return _check_paid(payment, result) or "apply_paid"
    if result.outcome == Outcome.FAILED:
        return "apply_failed"
    if result.outcome == Outcome.CANCELLED:
        return "apply_cancelled"
    if result.outcome == Outcome.PENDING and result.reason:
        return "hold"
    return ""  # pending / not found / error: nothing changes


# --------------------------------------------------------------------------------------
# Callbacks / IPN
# --------------------------------------------------------------------------------------
def _payment_for_callback(provider: str, callback) -> Payment | None:
    """Find the payment a callback is about: by our merchant reference, or — for providers
    whose callback carries only their own payment id — by (provider, provider_payment_id).
    Only a lookup: nothing is granted from it; the server-to-server check decides."""
    if callback.merchant_reference:
        return Payment.objects.filter(
            merchant_reference=callback.merchant_reference, provider=provider
        ).first()
    if callback.provider_payment_id:
        return Payment.objects.filter(
            provider=provider, provider_payment_id=callback.provider_payment_id
        ).first()
    return None


def process_callback(provider: str, kind: str, data, *, ip=None) -> Payment | None:
    """Handle a browser callback (``success``/``fail``/``cancel``) or an IPN. Never grants
    anything by itself; returns the payment (``None`` for an unknown reference)."""
    if not is_enabled(provider):
        logger.warning("Payment callback for a disabled provider provider=%s", provider)
        return None
    gateway = get_gateway(provider)
    callback = gateway.handle_callback(data)
    payment = _payment_for_callback(provider, callback)
    if payment is None:
        logger.warning(
            "Payment callback for an unknown reference provider=%s kind=%s", provider, kind
        )
        return None
    event_type = (
        PaymentEventType.IPN_RECEIVED
        if kind == CallbackKind.IPN
        else PaymentEventType.CALLBACK_RECEIVED
    )
    record_event(
        payment,
        event_type,
        {**callback.raw, "kind": kind, "signature_valid": callback.signature_valid},
        ip,
    )
    if not callback.signature_valid:
        logger.warning(
            "Payment callback signature invalid payment=%s kind=%s", payment.public_id, kind
        )
        return payment
    if payment.status == PaymentStatus.SUCCESS:
        return payment  # replay: nothing to do, no provider call
    record_event(payment, PaymentEventType.VERIFY_REQUEST, {"kind": kind, "source": kind}, ip)
    if kind in (CallbackKind.SUCCESS, CallbackKind.IPN):
        result = gateway.verify(payment, callback)
    else:
        result = gateway.query(payment)
    return apply_verification(payment.pk, result, source=kind, ip=ip)


# --------------------------------------------------------------------------------------
# Reconciliation (Celery beat) and admin re-verify
# --------------------------------------------------------------------------------------
def _abandon(payment_id) -> None:
    with transaction.atomic():
        payment = Payment.objects.select_for_update().get(pk=payment_id)
        if payment.status in OPEN_STATUSES:
            _move(payment, PaymentStatus.FAILED, reason="abandoned")


def reconcile_payments(*, batch_size: int | None = None, max_batches: int | None = None) -> int:
    """Re-query the provider for open payments older than the minimum age, least recently
    checked first, in bounded batches. Only a provider answer changes a payment (through
    ``apply_verification``); a payment the provider has never heard of is closed as
    ``abandoned`` after ``PAYMENT_ABANDON_AFTER_SECONDS``. Idempotent."""
    batch_size = batch_size or settings.PAYMENT_RECONCILE_BATCH_SIZE
    max_batches = max_batches or settings.PAYMENT_RECONCILE_MAX_BATCHES
    started = timezone.now()
    min_created = started - timedelta(seconds=settings.PAYMENT_RECONCILE_MIN_AGE_SECONDS)
    abandon_before = started - timedelta(seconds=settings.PAYMENT_ABANDON_AFTER_SECONDS)
    total = 0
    for _batch in range(max_batches):
        with transaction.atomic():
            ids = list(
                Payment.objects.select_for_update(skip_locked=True)
                .filter(status__in=OPEN_STATUSES, created_at__lte=min_created)
                .filter(Q(last_checked_at__isnull=True) | Q(last_checked_at__lt=started))
                .order_by(F("last_checked_at").asc(nulls_first=True), "created_at", "id")
                .values_list("pk", flat=True)[:batch_size]
            )
            Payment.objects.filter(pk__in=ids).update(last_checked_at=timezone.now())
        for payment_id in ids:
            payment = Payment.objects.get(pk=payment_id)
            if payment.status not in OPEN_STATUSES:
                continue
            if not is_enabled(payment.provider):
                logger.warning(
                    "Reconciliation skipped: provider disabled payment=%s provider=%s",
                    payment.public_id,
                    payment.provider,
                )
                continue
            result = get_gateway(payment.provider).query(payment)
            record_event(
                payment,
                PaymentEventType.RECONCILIATION,
                {"outcome": result.outcome, "reason": result.reason},
            )
            if result.outcome == Outcome.NOT_FOUND and payment.created_at <= abandon_before:
                _abandon(payment.pk)
            else:
                apply_verification(payment.pk, result, source="reconciliation")
        total += len(ids)
        if len(ids) < batch_size:
            break
    return total


REVERIFY_AUDIT_FIELDS = ("outcome", "status", "merchant_reference")


def _claim_reverify(payment: Payment) -> None:
    """One provider query per payment per ``PAYMENT_REVERIFY_COOLDOWN_SECONDS``.

    A single conditional UPDATE claims the slot (``last_checked_at``, which every provider
    answer also sets): of two simultaneous re-verifies — a double click, two admins — only
    one queries the provider; the other gets 429 with Retry-After. A successful payment is
    final and is never re-queried (409 ``already_successful``)."""
    now = timezone.now()
    cooldown = timedelta(seconds=max(settings.PAYMENT_REVERIFY_COOLDOWN_SECONDS, 0))
    claimed = (
        Payment.objects.filter(pk=payment.pk)
        .exclude(status=PaymentStatus.SUCCESS)
        .filter(Q(last_checked_at__isnull=True) | Q(last_checked_at__lte=now - cooldown))
        .update(last_checked_at=now)
    )
    if claimed:
        return
    payment.refresh_from_db(fields=["status", "last_checked_at"])
    if payment.status == PaymentStatus.SUCCESS:
        raise PaymentError("already_successful", ALREADY_SUCCESSFUL_MESSAGE)
    remaining = cooldown - (now - payment.last_checked_at)
    seconds = max(1, math.ceil(remaining.total_seconds()))
    raise PaymentError(
        "reverify_too_soon",
        REVERIFY_TOO_SOON_MESSAGE % {"seconds": seconds},
        status=429,
        retry_after=seconds,
    )


def admin_reverify(public_id, *, ctx: AuditContext) -> Payment:
    """Ask the provider again (``query``) and apply the answer like any other — an admin
    can never set a status directly. Audited.

    Guards (refusals change nothing and are not audited): a successful payment is final
    (409 ``already_successful``); a disabled provider (409 ``provider_disabled``); at most
    one query per payment per cooldown (429 ``reverify_too_soon``). ``failed`` and
    ``cancelled`` payments can still be re-verified — that is the late-success recovery."""
    payment = Payment.objects.filter(public_id=public_id).first()
    if payment is None:
        from django.http import Http404

        raise Http404
    if payment.status == PaymentStatus.SUCCESS:
        raise PaymentError("already_successful", ALREADY_SUCCESSFUL_MESSAGE)
    if not is_enabled(payment.provider):
        raise PaymentError("provider_disabled", PROVIDER_DISABLED_MESSAGE)
    _claim_reverify(payment)
    before = payment.status
    result = get_gateway(payment.provider).query(payment)  # outside any transaction
    with transaction.atomic():
        record_event(
            payment,
            PaymentEventType.ADMIN_REVERIFY,
            {"outcome": result.outcome, "reason": result.reason},
            ctx.ip_address,
        )
        payment = apply_verification(payment.pk, result, source="admin_reverify", ip=ctx.ip_address)
        audit.record(
            ctx,
            action="payment.reverify",
            entity_type="payments.payment",
            entity_id=payment.pk,
            summary=f"payment {payment.merchant_reference}",
            metadata={
                "values": {
                    "outcome": result.outcome,
                    "merchant_reference": payment.merchant_reference,
                },
                "changes": {"status": {"from": before, "to": payment.status}}
                if before != payment.status
                else {},
            },
            allowed_fields=REVERIFY_AUDIT_FIELDS,
        )
    return payment
