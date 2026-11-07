"""Sanitizing provider data before it is stored (``raw_verification``, payment events).

Allow-list, not block-list: only the keys below survive, values must be scalars and are
cut to a safe length. Store passwords, signatures/hash keys, session keys, card numbers,
customer contact data, cookies and headers are never on the list — and a key that looks
sensitive is dropped even if someone adds it here by mistake.
"""

from typing import Any

from apps.audit.services import clean_text

MAX_VALUE_LENGTH = 200

# Provider facts that help troubleshooting (SSLCommerz names; mock uses a subset).
ALLOWED_KEYS = frozenset(
    {
        # identity of the transaction
        "tran_id",
        "val_id",
        "bank_tran_id",
        # status
        "status",
        "APIConnect",
        "no_of_trans_found",
        "risk_level",
        "risk_title",
        "failedreason",
        "error",
        # money
        "amount",
        "store_amount",
        "currency",
        "currency_type",
        "currency_amount",
        "currency_rate",
        # non-sensitive payment metadata
        "tran_date",
        "validated_on",
        "card_type",
        "card_brand",
        # bKash (Tokenized Checkout) facts
        "transactionStatus",
        "statusCode",
        "statusMessage",
        "merchantInvoiceNumber",
        "trxID",
        "intent",
        "paymentExecuteTime",
        # our own normalized fields
        "outcome",
        "reason",
        "kind",
        "provider",
        "from",
        "to",
        "previous_reason",
        "signature_valid",
        "merchant_reference",
        "amount_expected",
        "currency_expected",
        "source",
        "http_status",
    }
)
FORBIDDEN_FRAGMENTS = (
    "passw",
    "passwd",
    "secret",
    "token",
    "sign",
    "verify_key",
    "session",
    "card_no",
    "cardnumber",
    "cookie",
    "authorization",
    "cus_",
    "email",
    "phone",
    "mobile",
)
# Signature fields are checked (``signature_valid``) but never stored.
_ALWAYS_ALLOWED = frozenset({"signature_valid"})


def _safe_key(key: Any) -> bool:
    if not isinstance(key, str) or key not in ALLOWED_KEYS:
        return False
    if key in _ALWAYS_ALLOWED:
        return True
    lowered = key.lower()
    return not any(fragment in lowered for fragment in FORBIDDEN_FRAGMENTS)


def _scalar(value: Any) -> Any:
    if value is None or isinstance(value, bool | int):
        return value
    if isinstance(value, float):
        return clean_text(repr(value), MAX_VALUE_LENGTH)
    return clean_text(str(value), MAX_VALUE_LENGTH)


def sanitize(data: Any) -> dict:
    """Allow-listed scalar keys of a provider mapping (nested ``element`` lists of the
    SSLCommerz transaction query are sanitized item by item)."""
    if not isinstance(data, dict):
        return {}
    clean = {key: _scalar(value) for key, value in data.items() if _safe_key(key)}
    elements = data.get("element")
    if isinstance(elements, list):
        clean["element"] = [sanitize(item) for item in elements[:10]]
    return clean
