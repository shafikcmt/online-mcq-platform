"""Mock payment provider for development and tests (never in production).

It behaves like a real provider from the service's point of view: a checkout session,
a "provider-side" ledger, callbacks that carry only a reference and a validation token,
and a server-side ``verify``/``query`` that reads the ledger — never the callback data.
So the mock exercises exactly the same verification code as SSLCommerz.

The ledger lives in the Django cache (Redis in development, local memory in tests).
``complete()`` plays the provider's checkout page: tests call it directly (optionally
with a tampered amount/currency or a reused transaction ID); in development the mock
checkout endpoint (``/api/v1/payments/mock/checkout/<reference>/``) calls it.
"""

import secrets
from collections.abc import Mapping
from decimal import Decimal

from django.conf import settings
from django.core.cache import cache

from ..sanitize import sanitize
from .base import (
    CallbackData,
    CallbackUrls,
    Customer,
    InitiateResult,
    Outcome,
    PaymentGateway,
    VerificationResult,
    parse_amount,
)

LEDGER_TTL_SECONDS = 2 * 24 * 3600
MOCK_CHECKOUT_PATH = "/api/v1/payments/mock/checkout/{reference}/"

# Ledger statuses (SSLCommerz-like words).
PENDING, VALID, FAILED, CANCELLED = "PENDING", "VALID", "FAILED", "CANCELLED"
RESULTS = {"success": VALID, "fail": FAILED, "cancel": CANCELLED}
_OUTCOMES = {
    PENDING: Outcome.PENDING,
    VALID: Outcome.PAID,
    FAILED: Outcome.FAILED,
    CANCELLED: Outcome.CANCELLED,
}


def _ref_key(reference: str) -> str:
    return f"payments:mock:ref:{reference}"


def _val_key(val_id: str) -> str:
    return f"payments:mock:val:{val_id}"


def ledger_entry(reference: str) -> dict | None:
    return cache.get(_ref_key(reference))


def open_session(reference: str, amount: Decimal, currency: str) -> None:
    cache.set(
        _ref_key(reference),
        {"status": PENDING, "amount": str(amount), "currency": currency, "tran_id": reference},
        LEDGER_TTL_SECONDS,
    )


def complete(
    reference: str,
    result: str,
    *,
    amount: Decimal | str | None = None,
    currency: str | None = None,
    bank_tran_id: str | None = None,
) -> str:
    """Record the checkout outcome (``success``/``fail``/``cancel``) for ``reference`` and
    return the validation token (``val_id``) a callback would carry. ``amount``,
    ``currency`` and ``bank_tran_id`` override what was charged (tamper tests)."""
    entry = ledger_entry(reference)
    if entry is None:
        raise KeyError(reference)
    val_id = f"MOCKVAL{secrets.token_hex(8).upper()}"
    entry.update(
        status=RESULTS[result],
        val_id=val_id,
        bank_tran_id=bank_tran_id or f"MOCKTXN{secrets.token_hex(8).upper()}",
    )
    if amount is not None:
        entry["amount"] = str(amount)
    if currency is not None:
        entry["currency"] = currency
    cache.set(_ref_key(reference), entry, LEDGER_TTL_SECONDS)
    cache.set(_val_key(val_id), reference, LEDGER_TTL_SECONDS)
    return val_id


def _result(entry: dict | None, reason: str = "") -> VerificationResult:
    if entry is None:
        return VerificationResult(outcome=Outcome.NOT_FOUND, reason=reason or "not_found")
    outcome = _OUTCOMES.get(entry.get("status"), Outcome.ERROR)
    return VerificationResult(
        outcome=outcome,
        provider="mock",
        merchant_reference=entry.get("tran_id", ""),
        amount=parse_amount(entry.get("amount")),
        currency=entry.get("currency", ""),
        provider_transaction_id=entry.get("bank_tran_id", "") if outcome == Outcome.PAID else "",
        reason=reason,
        raw=sanitize(entry),
    )


class MockGateway(PaymentGateway):
    code = "mock"

    def initiate(self, payment, *, urls: CallbackUrls, customer: Customer) -> InitiateResult:
        open_session(payment.merchant_reference, payment.amount, payment.currency)
        base = settings.PAYMENT_CALLBACK_BASE_URL.rstrip("/")
        return InitiateResult(
            checkout_url=base + MOCK_CHECKOUT_PATH.format(reference=payment.merchant_reference),
            provider_payment_id=f"MOCKSESSION-{payment.merchant_reference}",
        )

    def handle_callback(self, data: Mapping) -> CallbackData:
        return CallbackData(
            merchant_reference=str(data.get("tran_id", "")),
            verification_token=str(data.get("val_id", "")),
            reported_status=str(data.get("status", "")),
            signature_valid=True,
            raw=sanitize(dict(data)),
        )

    def verify(self, payment, callback: CallbackData) -> VerificationResult:
        if not callback.verification_token:
            return self.query(payment)
        reference = cache.get(_val_key(callback.verification_token))
        if reference is None:
            return _result(None, "unknown_token")
        return _result(ledger_entry(reference))

    def query(self, payment) -> VerificationResult:
        return _result(ledger_entry(payment.merchant_reference))
