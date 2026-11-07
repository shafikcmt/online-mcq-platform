"""What each adapter is and what its admin form looks like.

A new provider = an adapter class (``PaymentGateway`` subclass) + an entry in
``settings.PAYMENT_PROVIDERS`` + one ``AdapterSpec`` here. The admin panel renders its
configuration form from the spec, so no UI change is needed. Specs are plain data: nothing
the admin types is ever executed.

Field kinds: ``text``, ``url`` (https only), ``integer``, ``boolean``, ``select``, and for
credentials ``secret`` (write-only, shown as a 4-character hint).
"""

import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

from django.conf import settings


@dataclass(frozen=True)
class FieldSpec:
    name: str
    kind: str  # text | url | integer | boolean | select | secret
    label_en: str
    label_bn: str
    required: bool = False
    default: Any = None
    choices: tuple[str, ...] = ()
    minimum: int | None = None
    maximum: int | None = None
    max_length: int = 200


@dataclass(frozen=True)
class AdapterSpec:
    code: str
    label_en: str
    label_bn: str
    credentials: tuple[FieldSpec, ...] = ()  # required in each mode that is used
    options: tuple[FieldSpec, ...] = ()
    # What the adapter really supports. Anything not listed is "unsupported", explicitly.
    capabilities: tuple[str, ...] = ()
    note_en: str = ""


def _secret(name: str, en: str, bn: str) -> FieldSpec:
    return FieldSpec(name, "secret", en, bn, required=True, max_length=500)


REGISTRY: dict[str, AdapterSpec] = {
    "bkash": AdapterSpec(
        "bkash",
        "bKash (Tokenized Checkout)",
        "বিকাশ (টোকেনাইজড চেকআউট)",
        credentials=(
            _secret("app_key", "App key", "অ্যাপ কী"),
            _secret("app_secret", "App secret", "অ্যাপ সিক্রেট"),
            _secret("username", "Username", "ইউজারনেম"),
            _secret("password", "Password", "পাসওয়ার্ড"),
        ),
        options=(
            FieldSpec(
                "api_version",
                "text",
                "API version",
                "এপিআই ভার্সন",
                default="v1.2.0-beta",
                max_length=30,
            ),
            FieldSpec(
                "timeout_seconds",
                "integer",
                "Request timeout (seconds)",
                "রিকুয়েস্ট টাইমআউট (সেকেন্ড)",
                default=15,
                minimum=3,
                maximum=60,
            ),
        ),
        capabilities=("initiate", "callback", "verify", "query", "test_connection"),
        note_en="Written from the public flow description; not yet run against bKash's sandbox.",
    ),
    "sslcommerz": AdapterSpec(
        "sslcommerz",
        "SSLCommerz",
        "এসএসএলকমার্জ",
        credentials=(
            _secret("store_id", "Store ID", "স্টোর আইডি"),
            _secret("store_password", "Store password", "স্টোর পাসওয়ার্ড"),
        ),
        options=(
            FieldSpec(
                "timeout_seconds",
                "integer",
                "Request timeout (seconds)",
                "রিকুয়েস্ট টাইমআউট (সেকেন্ড)",
                default=15,
                minimum=3,
                maximum=60,
            ),
            FieldSpec(
                "customer_email",
                "text",
                "Fallback customer email",
                "ডিফল্ট ক্রেতার ইমেইল",
                default="customer@example.com",
            ),
            FieldSpec(
                "customer_address", "text", "Customer address", "ক্রেতার ঠিকানা", default="Dhaka"
            ),
            FieldSpec("customer_city", "text", "Customer city", "ক্রেতার শহর", default="Dhaka"),
            FieldSpec(
                "customer_country", "text", "Customer country", "ক্রেতার দেশ", default="Bangladesh"
            ),
        ),
        capabilities=("initiate", "callback", "verify", "query"),
        note_en="Carries bKash, Nagad, Rocket, cards and banks if the merchant account allows.",
    ),
    "mock": AdapterSpec(
        "mock",
        "Mock (development only)",
        "মক (শুধু ডেভেলপমেন্ট)",
        capabilities=("initiate", "callback", "verify", "query"),
        note_en="Grants access without payment. Never available in production.",
    ),
    # Listed so the admin can see them, but they have no adapter: they cannot be enabled
    # until the provider's official API document and credentials exist and the adapter is
    # verified against the provider's sandbox.
    "nagad": AdapterSpec("nagad", "Nagad", "নগদ", note_en="Not implemented."),
    "rocket": AdapterSpec(
        "rocket",
        "Rocket (direct)",
        "রকেট (সরাসরি)",
        note_en="Not implemented. Use it through SSLCommerz if the merchant account allows.",
    ),
}

_SLUG = re.compile(r"^[a-z][a-z0-9_]{0,19}$")


def get_spec(code: str) -> AdapterSpec | None:
    return REGISTRY.get(code)


def is_implemented(code: str) -> bool:
    """An adapter class exists and may run here (the mock adapter never runs in production)."""
    if code not in settings.PAYMENT_PROVIDERS:
        return False
    return code != "mock" or settings.PAYMENT_MOCK_ALLOWED


def required_credentials(code: str) -> tuple[str, ...]:
    spec = get_spec(code)
    return tuple(f.name for f in spec.credentials if f.required) if spec else ()


def _clean_value(field: FieldSpec, value: Any) -> Any:
    if field.kind == "boolean":
        if not isinstance(value, bool):
            raise ValueError("invalid_boolean")
        return value
    if field.kind == "integer":
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError("invalid_integer")
        if (field.minimum is not None and value < field.minimum) or (
            field.maximum is not None and value > field.maximum
        ):
            raise ValueError("out_of_range")
        return value
    if not isinstance(value, str):
        raise ValueError("invalid_text")
    text = " ".join(value.split())
    if len(text) > field.max_length:
        raise ValueError("too_long")
    if field.kind == "select" and text not in field.choices:
        raise ValueError("invalid_choice")
    if field.kind == "url" and text:
        parts = urlsplit(text)
        if parts.scheme != "https" or not parts.netloc:
            raise ValueError("https_required")
    return text


def validate_options(code: str, options: Any) -> dict[str, Any]:
    """The adapter's non-secret options, checked against its schema. Unknown keys are
    refused (nothing arbitrary is stored). Missing keys take the schema default.
    Raises ``ValueError`` with ``{field: reason}`` in ``args[0]``."""
    spec = get_spec(code)
    if spec is None:
        raise ValueError({"adapter": "unknown_adapter"})
    if options is None:
        options = {}
    if not isinstance(options, dict):
        raise ValueError({"options": "invalid_object"})
    known = {f.name: f for f in spec.options}
    errors: dict[str, str] = {name: "unknown_option" for name in options if name not in known}
    clean: dict[str, Any] = {}
    for name, fld in known.items():
        value = options.get(name, fld.default)
        if value is None or value == "":
            if fld.required:
                errors[name] = "required"
            elif fld.default is not None:
                clean[name] = fld.default
            continue
        try:
            clean[name] = _clean_value(fld, value)
        except ValueError as exc:
            errors[name] = str(exc)
    if errors:
        raise ValueError(errors)
    return clean


def valid_code(code: str) -> bool:
    return bool(_SLUG.match(code or ""))
