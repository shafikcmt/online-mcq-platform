"""bKash Tokenized Checkout gateway.

STATUS: written from the public description of the Tokenized Checkout flow and covered by
tests with a fake bKash. It has NOT yet been run against bKash's sandbox (we have no merchant
credentials yet). Before it takes real money, run the sandbox checklist in
docs/PAYMENT_METHODS.md: every item there is something this code assumes about bKash.

Flow:

1. ``initiate``: get an ``id_token`` (grant token, cached), then *create payment* → bKash
   answers with ``paymentID`` and ``bkashURL`` (the page where the student confirms with
   bKash number, OTP and PIN). We keep ``paymentID`` as ``provider_payment_id``.
   ``merchantInvoiceNumber`` is OUR merchant reference.
2. The student confirms; bKash sends the browser to our callback with
   ``?paymentID=…&status=success|failure|cancel``. The callback carries bKash's id, not our
   reference, so the payment is found by ``(provider, provider_payment_id)`` — a lookup only.
3. ``verify`` (server to server, never trusting the callback's ``status``): ask bKash for the
   payment's status; if the student authorized it (``Authorized``) *execute* it — that is the
   step that actually takes the money — and read the final answer. A timed-out or refused
   execute is followed by a fresh status query: the money may have moved anyway.
4. ``query`` (reconciliation, admin re-verify) is read-only: it NEVER executes, so a
   background job can never take money from a student who already walked away.

Credentials (app key/secret, username, password) are read from settings (environment) and
sent only to bKash over HTTPS; the token is cached (it is rate-limited) and never logged,
stored in the database or returned. Answers pass through ``payments.sanitize``.
"""

import logging
from collections.abc import Mapping

from django.conf import settings
from django.core.cache import cache

from ..sanitize import sanitize
from .base import (
    CallbackData,
    CallbackUrls,
    Customer,
    GatewayError,
    InitiateResult,
    Outcome,
    PaymentGateway,
    VerificationResult,
    parse_amount,
)
from .http import request_json

logger = logging.getLogger(__name__)

SANDBOX_HOST = "https://tokenized.sandbox.bka.sh"
LIVE_HOST = "https://tokenized.pay.bka.sh"
SUCCESS_CODE = "0000"
# bKash's code for an invalid/expired id_token; an HTTP 401 means the same. To be confirmed
# in the sandbox (docs/PAYMENT_METHODS.md).
TOKEN_ERROR_CODES = ("2079",)
TOKEN_CACHE_SECONDS = 50 * 60  # the token lives an hour; refresh a little early

_STATUS_OUTCOMES = {
    "Initiated": (Outcome.PENDING, ""),
    "Authorized": (Outcome.PENDING, ""),
    "Failed": (Outcome.FAILED, "provider_failed"),
    "Cancelled": (Outcome.CANCELLED, "provider_cancelled"),
}
# Non-secret provider facts kept for troubleshooting (also on the sanitizer's allow-list).
_RAW_KEYS = (
    "transactionStatus",
    "statusCode",
    "statusMessage",
    "merchantInvoiceNumber",
    "trxID",
    "amount",
    "currency",
    "intent",
    "paymentExecuteTime",
)


def _clip(value: object, length: int) -> str:
    return " ".join(str(value or "").split())[:length]


class BkashGateway(PaymentGateway):
    code = "bkash"

    # ----------------------------------------------------------------------------------
    @property
    def _base(self) -> str:
        host = SANDBOX_HOST if settings.BKASH_SANDBOX else LIVE_HOST
        return f"{host}/{settings.BKASH_API_VERSION.strip('/')}/tokenized/checkout"

    def _credentials(self) -> tuple[str, str, str, str]:
        creds = (
            settings.BKASH_APP_KEY,
            settings.BKASH_APP_SECRET,
            settings.BKASH_USERNAME,
            settings.BKASH_PASSWORD,
        )
        if not all(creds):
            raise GatewayError("not_configured")
        return creds

    @property
    def _token_cache_key(self) -> str:
        return f"payments:bkash:id_token:{'sandbox' if settings.BKASH_SANDBOX else 'live'}"

    def _token(self, *, refresh: bool = False) -> str:
        if not refresh:
            cached = cache.get(self._token_cache_key)
            if cached:
                return cached
        app_key, app_secret, username, password = self._credentials()
        answer = request_json(
            "POST",
            f"{self._base}/token/grant",
            body={"app_key": app_key, "app_secret": app_secret},
            headers={"username": username, "password": password},
            timeout=settings.BKASH_TIMEOUT_SECONDS,
        )
        token = answer.get("id_token")
        if (
            str(answer.get("statusCode", SUCCESS_CODE)) != SUCCESS_CODE
            or not isinstance(token, str)
            or not token
        ):
            raise GatewayError("token_refused")
        cache.set(self._token_cache_key, token, TOKEN_CACHE_SECONDS)
        return token

    def _call(self, path: str, body: dict) -> dict:
        """An authenticated call; a refused token is replaced once and the call repeated."""
        app_key = self._credentials()[0]
        for attempt in (0, 1):
            token = self._token(refresh=attempt == 1)
            try:
                answer = request_json(
                    "POST",
                    f"{self._base}{path}",
                    body=body,
                    headers={"Authorization": token, "X-APP-Key": app_key},
                    timeout=settings.BKASH_TIMEOUT_SECONDS,
                )
            except GatewayError as exc:
                if attempt == 0 and exc.reason == "http_401":
                    continue
                raise
            if attempt == 0 and str(answer.get("statusCode", "")) in TOKEN_ERROR_CODES:
                continue
            return answer
        raise GatewayError("token_refused")  # pragma: no cover — the loop always returns/raises

    # ----------------------------------------------------------------------------------
    def initiate(self, payment, *, urls: CallbackUrls, customer: Customer) -> InitiateResult:
        payer = "".join(ch for ch in customer.phone if ch.isdigit()) or payment.merchant_reference
        answer = self._call(
            "/create",
            {
                "mode": "0011",
                "payerReference": _clip(payer, 30),
                "callbackURL": urls.success,
                "amount": f"{payment.amount:.2f}",
                "currency": payment.currency,
                "intent": "sale",
                "merchantInvoiceNumber": payment.merchant_reference,
            },
        )
        code = str(answer.get("statusCode", ""))
        url, payment_id = answer.get("bkashURL"), answer.get("paymentID")
        if code != SUCCESS_CODE:
            raise GatewayError(f"status_{_clip(code, 12) or 'none'}")
        if (
            not isinstance(url, str)
            or not url.startswith("https://")
            or not isinstance(payment_id, str)
            or not payment_id
        ):
            raise GatewayError("bad_response")
        return InitiateResult(
            checkout_url=url,
            provider_payment_id=payment_id,
            raw=sanitize({key: answer.get(key) for key in _RAW_KEYS}),
        )

    def handle_callback(self, data: Mapping) -> CallbackData:
        # bKash signs nothing in the browser callback: it is only used to find the payment,
        # and everything is decided by the server-to-server calls in ``verify``.
        return CallbackData(
            provider_payment_id=_clip(data.get("paymentID"), 100),
            reported_status=_clip(data.get("status"), 20).lower(),
            raw=sanitize({"status": _clip(data.get("status"), 20)}),
        )

    # ----------------------------------------------------------------------------------
    def _status_raw(self, payment) -> dict:
        return self._call("/payment/status", {"paymentID": payment.provider_payment_id})

    def _result(self, payment, answer: dict) -> VerificationResult:
        """bKash's answer → the normalized result. Anything unexpected is ``ERROR`` (nothing
        changes; reconciliation asks again later)."""
        raw = sanitize({key: answer.get(key) for key in _RAW_KEYS})
        code = str(answer.get("statusCode", ""))
        if code != SUCCESS_CODE:
            return VerificationResult(
                Outcome.ERROR,
                provider=self.code,
                reason=f"status_{_clip(code, 12) or 'none'}",
                raw=raw,
            )
        status = str(answer.get("transactionStatus", ""))
        if status == "Completed":
            return VerificationResult(
                Outcome.PAID,
                provider=self.code,
                merchant_reference=_clip(answer.get("merchantInvoiceNumber"), 60),
                amount=parse_amount(answer.get("amount")),
                currency=_clip(answer.get("currency"), 10),
                provider_transaction_id=_clip(answer.get("trxID"), 100),
                provider_payment_id=_clip(
                    answer.get("paymentID") or payment.provider_payment_id, 100
                ),
                raw=raw,
            )
        mapped = _STATUS_OUTCOMES.get(status)
        if mapped is None:
            return VerificationResult(
                Outcome.ERROR, provider=self.code, reason="unknown_status", raw=raw
            )
        outcome, reason = mapped
        return VerificationResult(
            outcome,
            provider=self.code,
            merchant_reference=_clip(answer.get("merchantInvoiceNumber"), 60)
            or payment.merchant_reference,
            reason=reason,
            raw=raw,
        )

    def _error(self, reason: str) -> VerificationResult:
        return VerificationResult(Outcome.ERROR, provider=self.code, reason=reason)

    def query(self, payment) -> VerificationResult:
        if not payment.provider_payment_id:
            # Our session never got a bKash payment id (it died between create and saving):
            # bKash cannot know it; reconciliation closes it as abandoned after a day.
            return VerificationResult(
                Outcome.NOT_FOUND, provider=self.code, reason="no_provider_payment_id"
            )
        try:
            return self._result(payment, self._status_raw(payment))
        except GatewayError as exc:
            return self._error(exc.reason)

    def verify(self, payment, callback: CallbackData) -> VerificationResult:
        # The callback's ``status`` is untrusted and decides nothing: the payment's real
        # state is whatever bKash says. A callback that does not claim success only asks
        # for the state; it never triggers an execute.
        if not payment.provider_payment_id:
            return self.query(payment)
        try:
            answer = self._status_raw(payment)
        except GatewayError as exc:
            return self._error(exc.reason)
        result = self._result(payment, answer)
        authorized = (
            str(answer.get("statusCode", "")) == SUCCESS_CODE
            and answer.get("transactionStatus") == "Authorized"
        )
        if not authorized or (callback.reported_status and callback.reported_status != "success"):
            return result
        # The student authorized the payment: executing it is what takes the money.
        try:
            executed = self._call("/execute", {"paymentID": payment.provider_payment_id})
        except GatewayError:
            executed = None  # timed out / refused: the money may have moved all the same
        if executed is not None and str(executed.get("statusCode", "")) == SUCCESS_CODE:
            final = self._result(payment, executed)
            if final.outcome != Outcome.ERROR:
                return final
        return self.query(payment)
