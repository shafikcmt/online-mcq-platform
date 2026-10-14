"""SSLCommerz gateway (first real provider; sandbox first, then live).

Flow (docs/API_PLAN.md §3.7):

1. ``initiate``: create a session (``POST /gwprocess/v4/api.php``) → ``GatewayPageURL``.
   Our success/fail/cancel/IPN URLs come from server settings, never from the client.
2. The student pays on SSLCommerz; the browser is posted back to a callback URL and
   SSLCommerz posts an IPN. Both carry ``tran_id`` (our merchant reference), ``val_id``,
   ``verify_sign`` and ``verify_key``.
3. ``handle_callback`` checks ``verify_sign`` (MD5 over the listed fields + the MD5 of the
   store password — SSLCommerz's own scheme) and extracts reference + ``val_id``.
4. ``verify``: the **Validation API** (``validationserverAPI.php?val_id=…``) is the only
   source of truth. ``query``: the transaction query API by ``tran_id``
   (``merchantTransIDvalidationAPI.php``), then the Validation API for a valid element.

The store password is sent only to SSLCommerz over HTTPS; it is never stored, logged or
returned (responses pass through ``payments.sanitize``). HTTP uses the standard library
with a timeout and certificate verification; any network/HTTP/JSON problem becomes a
``GatewayError`` (initiation) or ``Outcome.ERROR`` (verification) with a short reason.
"""

import hashlib
import hmac
import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Mapping

from django.conf import settings

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

logger = logging.getLogger(__name__)

SANDBOX_HOST = "https://sandbox.sslcommerz.com"
LIVE_HOST = "https://securepay.sslcommerz.com"
SESSION_PATH = "/gwprocess/v4/api.php"
VALIDATION_PATH = "/validator/api/validationserverAPI.php"
QUERY_PATH = "/validator/api/merchantTransIDvalidationAPI.php"
MAX_RESPONSE_BYTES = 256 * 1024

PAID_STATUSES = ("VALID", "VALIDATED")
_STATUS_OUTCOMES = {
    "FAILED": (Outcome.FAILED, "provider_failed"),
    "CANCELLED": (Outcome.CANCELLED, "provider_cancelled"),
    "EXPIRED": (Outcome.FAILED, "provider_expired"),
    "PENDING": (Outcome.PENDING, ""),
    "UNATTEMPTED": (Outcome.PENDING, ""),
    "INVALID_TRANSACTION": (Outcome.NOT_FOUND, "invalid_transaction"),
}
HIGH_RISK = "1"


def http_request(method: str, url: str, *, form: dict | None = None, timeout: float) -> dict:
    """One HTTPS request to SSLCommerz → parsed JSON object. Raises ``GatewayError``."""
    if not url.startswith("https://"):
        raise GatewayError("insecure_url")
    data = urllib.parse.urlencode(form).encode() if form is not None else None
    request = urllib.request.Request(  # noqa: S310 — https only (checked above)
        url, data=data, method=method, headers={"Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
            body = response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as exc:
        raise GatewayError(f"http_{exc.code}") from None
    except TimeoutError:
        raise GatewayError("timeout") from None
    except (urllib.error.URLError, OSError) as exc:
        reason = getattr(exc, "reason", None)
        if isinstance(reason, TimeoutError):
            raise GatewayError("timeout") from None
        raise GatewayError("network_error") from None
    if len(body) > MAX_RESPONSE_BYTES:
        raise GatewayError("response_too_large")
    try:
        parsed = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise GatewayError("bad_response") from None
    if not isinstance(parsed, dict):
        raise GatewayError("bad_response")
    return parsed


def _md5(text: str) -> str:
    # SSLCommerz's signature scheme is defined with MD5; it is not our security boundary
    # (the Validation API is) — it only filters forged posts early.
    return hashlib.md5(text.encode("utf-8"), usedforsecurity=False).hexdigest()


def signature_is_valid(data: Mapping, store_password: str) -> bool:
    sign = str(data.get("verify_sign", ""))
    keys = [key for key in str(data.get("verify_key", "")).split(",") if key]
    if not sign or not keys or not store_password:
        return False
    fields = {key: str(data.get(key, "")) for key in keys}
    fields["store_passwd"] = _md5(store_password)
    message = "&".join(f"{key}={fields[key]}" for key in sorted(fields))
    return hmac.compare_digest(_md5(message), sign.lower())


def _clip(value: str, length: int) -> str:
    return " ".join(str(value or "").split())[:length]


class SslCommerzGateway(PaymentGateway):
    code = "sslcommerz"

    # ----------------------------------------------------------------------------------
    @property
    def host(self) -> str:
        return SANDBOX_HOST if settings.SSLCOMMERZ_SANDBOX else LIVE_HOST

    def _credentials(self) -> tuple[str, str]:
        store_id, password = settings.SSLCOMMERZ_STORE_ID, settings.SSLCOMMERZ_STORE_PASSWORD
        if not store_id or not password:
            raise GatewayError("not_configured")
        return store_id, password

    def _get(self, path: str, params: dict) -> dict:
        url = f"{self.host}{path}?{urllib.parse.urlencode(params)}"
        return http_request("GET", url, timeout=settings.SSLCOMMERZ_TIMEOUT_SECONDS)

    # ----------------------------------------------------------------------------------
    def initiate(self, payment, *, urls: CallbackUrls, customer: Customer) -> InitiateResult:
        store_id, password = self._credentials()
        package = payment.package
        form = {
            "store_id": store_id,
            "store_passwd": password,
            "total_amount": f"{payment.amount:.2f}",
            "currency": payment.currency,
            "tran_id": payment.merchant_reference,
            "success_url": urls.success,
            "fail_url": urls.fail,
            "cancel_url": urls.cancel,
            "ipn_url": urls.ipn,
            "cus_name": _clip(customer.name, 50) or "Student",
            "cus_email": _clip(customer.email, 50) or settings.SSLCOMMERZ_CUSTOMER_EMAIL,
            "cus_phone": _clip(customer.phone, 20),
            "cus_add1": settings.SSLCOMMERZ_CUSTOMER_ADDRESS,
            "cus_city": settings.SSLCOMMERZ_CUSTOMER_CITY,
            "cus_country": settings.SSLCOMMERZ_CUSTOMER_COUNTRY,
            "shipping_method": "NO",
            "num_of_item": "1",
            "product_name": _clip(package.name_en or package.name_bn or package.slug, 100),
            "product_category": "Subscription",
            "product_profile": "non-physical-goods",
        }
        body = http_request(
            "POST", self.host + SESSION_PATH, form=form, timeout=settings.SSLCOMMERZ_TIMEOUT_SECONDS
        )
        checkout_url = str(body.get("GatewayPageURL") or "")
        if str(body.get("status", "")).upper() != "SUCCESS" or not checkout_url:
            raise GatewayError("init_rejected")
        parsed = urllib.parse.urlparse(checkout_url)
        if parsed.scheme != "https" or not (parsed.hostname or "").endswith(".sslcommerz.com"):
            raise GatewayError("bad_checkout_url")
        return InitiateResult(
            checkout_url=checkout_url,
            provider_payment_id=_clip(body.get("sessionkey", ""), 100),
            raw=sanitize(body),
        )

    def handle_callback(self, data: Mapping) -> CallbackData:
        return CallbackData(
            merchant_reference=_clip(data.get("tran_id", ""), 64),
            verification_token=_clip(data.get("val_id", ""), 100),
            reported_status=_clip(data.get("status", ""), 32),
            signature_valid=signature_is_valid(data, settings.SSLCOMMERZ_STORE_PASSWORD),
            raw=sanitize(dict(data)),
        )

    # ----------------------------------------------------------------------------------
    def verify(self, payment, callback: CallbackData) -> VerificationResult:
        if not callback.verification_token:
            return self.query(payment)
        return self._validate(callback.verification_token)

    def _validate(self, val_id: str) -> VerificationResult:
        try:
            store_id, password = self._credentials()
            body = self._get(
                VALIDATION_PATH,
                {
                    "val_id": val_id,
                    "store_id": store_id,
                    "store_passwd": password,
                    "v": "1",
                    "format": "json",
                },
            )
        except GatewayError as exc:
            return VerificationResult(outcome=Outcome.ERROR, reason=exc.reason)
        return self._normalize(body)

    @staticmethod
    def _normalize(body: dict) -> VerificationResult:
        status = str(body.get("status", "")).upper()
        raw = sanitize(body)
        reference = _clip(body.get("tran_id", ""), 64)
        if status in PAID_STATUSES:
            if str(body.get("risk_level", "")).strip() == HIGH_RISK:
                # SSLCommerz advises holding high-risk transactions: no activation.
                return VerificationResult(
                    outcome=Outcome.PENDING,
                    merchant_reference=reference,
                    reason="provider_risk_review",
                    raw=raw,
                )
            amount_key = "currency_amount" if body.get("currency_amount") else "amount"
            currency_key = "currency_type" if body.get("currency_type") else "currency"
            return VerificationResult(
                outcome=Outcome.PAID,
                provider=SslCommerzGateway.code,
                merchant_reference=reference,
                amount=parse_amount(body.get(amount_key)),
                currency=_clip(body.get(currency_key, ""), 3).upper(),
                provider_transaction_id=_clip(body.get("bank_tran_id") or body.get("val_id"), 100),
                raw=raw,
            )
        outcome, reason = _STATUS_OUTCOMES.get(status, (Outcome.ERROR, "unknown_status"))
        return VerificationResult(
            outcome=outcome, merchant_reference=reference, reason=reason, raw=raw
        )

    def query(self, payment) -> VerificationResult:
        try:
            store_id, password = self._credentials()
            body = self._get(
                QUERY_PATH,
                {
                    "tran_id": payment.merchant_reference,
                    "store_id": store_id,
                    "store_passwd": password,
                    "format": "json",
                },
            )
        except GatewayError as exc:
            return VerificationResult(outcome=Outcome.ERROR, reason=exc.reason)
        if str(body.get("APIConnect", "")).upper() != "DONE":
            return VerificationResult(
                outcome=Outcome.ERROR, reason="api_not_done", raw=sanitize(body)
            )
        elements = [e for e in body.get("element") or [] if isinstance(e, dict)]
        if not elements:
            return VerificationResult(
                outcome=Outcome.NOT_FOUND,
                merchant_reference=payment.merchant_reference,
                reason="not_found",
                raw=sanitize(body),
            )
        for element in elements:
            if str(element.get("status", "")).upper() in PAID_STATUSES and element.get("val_id"):
                # The Validation API stays the single authority for a success.
                return self._validate(str(element["val_id"]))
        statuses = [str(e.get("status", "")).upper() for e in elements]
        if any(s in ("PENDING", "UNATTEMPTED") for s in statuses):
            chosen = next(
                e
                for e in elements
                if str(e.get("status", "")).upper()
                in (
                    "PENDING",
                    "UNATTEMPTED",
                )
            )
        else:
            chosen = elements[-1]
        return self._normalize(chosen)
