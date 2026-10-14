"""The one payment gateway interface (docs/API_PLAN.md §3.7).

Payment business logic (``payments.services``) only talks to ``PaymentGateway``. A new
provider (bKash, Nagad) is a new subclass + an entry in ``settings.PAYMENT_PROVIDERS`` —
no change to the services, API, database or clients.

Every gateway must implement a **server-to-server** ``verify``/``query``; callback data
is only ever used to find the payment and to know what to ask the provider.

Results are normalized:

- ``Outcome.PAID``      — the provider confirms the money was taken (still checked
  against our record by the service: reference, amount, currency, transaction ID);
- ``Outcome.FAILED`` / ``Outcome.CANCELLED`` — the provider confirms it did not happen;
- ``Outcome.PENDING``   — not finished yet (or held for review) — nothing changes;
- ``Outcome.NOT_FOUND`` — the provider has no record of the reference;
- ``Outcome.ERROR``     — we could not get an answer (network, timeout, bad response) —
  nothing changes; reconciliation asks again later.
"""

from abc import ABC, abstractmethod
from collections.abc import Mapping
from dataclasses import dataclass, field
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.utils.module_loading import import_string


class Outcome:
    PAID = "paid"
    FAILED = "failed"
    CANCELLED = "cancelled"
    PENDING = "pending"
    NOT_FOUND = "not_found"
    ERROR = "error"


class CallbackKind:
    SUCCESS = "success"
    FAIL = "fail"
    CANCEL = "cancel"
    IPN = "ipn"

    browser = (SUCCESS, FAIL, CANCEL)


class GatewayError(Exception):
    """The provider could not be reached or answered something unusable. Carries a
    short, safe reason code (never provider secrets or full payloads)."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class CallbackUrls:
    success: str
    fail: str
    cancel: str
    ipn: str


@dataclass(frozen=True)
class Customer:
    """What a provider needs to open a checkout (never stored, never logged)."""

    name: str
    phone: str
    email: str


@dataclass(frozen=True)
class InitiateResult:
    checkout_url: str
    provider_payment_id: str = ""
    raw: dict = field(default_factory=dict)  # sanitized


@dataclass(frozen=True)
class CallbackData:
    """Parsed callback/IPN. Untrusted: only used to look up the payment and to decide
    what to ask the provider."""

    merchant_reference: str
    verification_token: str = ""  # e.g. SSLCommerz val_id
    reported_status: str = ""
    signature_valid: bool = True
    raw: dict = field(default_factory=dict)  # sanitized


@dataclass(frozen=True)
class VerificationResult:
    outcome: str
    provider: str = ""  # the gateway that produced the answer
    merchant_reference: str = ""
    amount: Decimal | None = None
    currency: str = ""
    provider_transaction_id: str = ""
    provider_payment_id: str = ""
    reason: str = ""
    raw: dict = field(default_factory=dict)  # sanitized


class PaymentGateway(ABC):
    code: str = "base"

    @abstractmethod
    def initiate(self, payment, *, urls: CallbackUrls, customer: Customer) -> InitiateResult:
        """Open a checkout session. Raise ``GatewayError`` on failure."""

    @abstractmethod
    def handle_callback(self, data: Mapping) -> CallbackData:
        """Parse a browser callback or IPN (and check its signature where supported)."""

    @abstractmethod
    def verify(self, payment, callback: CallbackData) -> VerificationResult:
        """Server-to-server check of the transaction a callback points to. Never raises
        for provider trouble: returns ``Outcome.ERROR`` instead."""

    @abstractmethod
    def query(self, payment) -> VerificationResult:
        """Server-to-server status of our merchant reference (reconciliation and admin
        re-verify). Never raises for provider trouble: returns ``Outcome.ERROR``."""


def parse_amount(value) -> Decimal | None:
    """Provider amount string → Decimal (exact), or None if it is not a number."""
    if value is None or isinstance(value, bool | float):
        return None
    try:
        amount = Decimal(str(value).strip())
    except ArithmeticError:
        return None
    return amount if amount.is_finite() else None


def get_gateway(code: str) -> PaymentGateway:
    """The gateway for ``code``; refuses providers that are not configured or not allowed
    here (the mock gateway never runs in production)."""
    path = settings.PAYMENT_PROVIDERS.get(code)
    if path is None:
        raise ImproperlyConfigured(f"Payment provider {code!r} is not configured.")
    gateway = import_string(path)()
    if code == "mock" and not settings.PAYMENT_MOCK_ALLOWED:
        raise ImproperlyConfigured("The mock payment provider is disabled here.")
    return gateway


def is_enabled(code: str) -> bool:
    if code not in settings.PAYMENT_PROVIDERS:
        return False
    return code != "mock" or settings.PAYMENT_MOCK_ALLOWED
