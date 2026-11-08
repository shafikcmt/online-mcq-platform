"""Which payment methods a student can use, and the configuration each one runs with.

Two sources, database first:

1. **Database gateways** (``PaymentGateway``, managed by admins). Offered only while the
   gateway is enabled, its adapter exists, its credentials for the current mode are
   complete and readable, it is switched on for the caller's channel (website / app) and
   the package amount and currency fit its limits.
2. **Environment fallback** (``PAYMENT_PROVIDER`` / ``PAYMENT_ENABLED_PROVIDERS`` and the
   ``BKASH_*`` / ``SSLCOMMERZ_*`` variables): used for an adapter only while the database
   has NO gateway row for it at all, so existing deployments keep working untouched and the
   moment an admin configures an adapter in the panel, the panel wins.

``PAYMENT_PROVIDER=unavailable`` still switches every payment off, whatever else is set.
``PAYMENT_PROVIDER=database`` offers only the database gateways (no environment fallback).

**Sandbox rule.** A sandbox-mode database gateway is offered only to designated testers
(``PaymentTester``); everyone else never sees it. What a tester buys through it is a *test*
subscription (``services``), kept apart from real ones.

A payment always runs with the configuration it was created under: the gateway row and the
MODE frozen on the payment, so a later sandbox → live switch can never send a sandbox
payment to live credentials (or the reverse).
"""

import logging
from dataclasses import dataclass
from decimal import Decimal

from django.conf import settings
from django.utils.translation import get_language

from apps.core.secret_box import SecretBoxError

from . import gateway_store
from .gateways import PAYMENTS_UNAVAILABLE, GatewayError, offered_providers
from .gateways.base import PaymentGateway, get_gateway
from .gateways.config import GatewayConfig
from .gateways.registry import is_implemented, required_credentials, validate_options
from .models import GatewayMode, Payment, PaymentProvider, PaymentTester
from .models import PaymentGateway as GatewayRow

logger = logging.getLogger(__name__)

CHANNELS = ("web", "app")


@dataclass(frozen=True)
class Offer:
    """One method a student can pick. ``gateway`` is None for the environment fallback."""

    adapter: str
    slug: str
    name_en: str
    name_bn: str
    description_en: str = ""
    description_bn: str = ""
    logo_url: str = ""
    gateway: GatewayRow | None = None
    mode: str = ""
    min_amount: Decimal | None = None
    max_amount: Decimal | None = None
    source: str = "env"

    def name(self, lang: str | None = None) -> str:
        lang = lang or get_language() or "en"
        return self.name_bn if lang.startswith("bn") and self.name_bn else self.name_en

    def description(self, lang: str | None = None) -> str:
        lang = lang or get_language() or "en"
        return (
            self.description_bn
            if lang.startswith("bn") and self.description_bn
            else self.description_en
        )


def is_tester(user) -> bool:
    return bool(user) and PaymentTester.objects.filter(user_id=user.pk).exists()


# --------------------------------------------------------------------------------------
# Readiness
# --------------------------------------------------------------------------------------
def gateway_issues(gateway: GatewayRow, mode: str | None = None) -> list[str]:
    """Why this gateway cannot take a payment in ``mode`` (default: its current mode).
    Empty = ready. Stable codes; the admin panel translates them."""
    mode = mode or gateway.mode
    if not is_implemented(gateway.adapter):
        return ["adapter_not_implemented"]
    issues = [
        f"missing_credential:{name}"
        for name in gateway_store.missing_credentials(
            gateway, mode, required_credentials(gateway.adapter)
        )
    ]
    if not issues:
        try:
            gateway_store.read_credentials(gateway, mode)
        except SecretBoxError:
            issues.append("credentials_unreadable")
        except Exception:  # noqa: BLE001 — e.g. no encryption key: not ready, never a crash
            issues.append("encryption_unavailable")
    return issues


def resolve_config(gateway: GatewayRow, mode: str | None = None) -> GatewayConfig:
    """The adapter configuration of a database gateway in ``mode`` (decrypts credentials
    into memory). Raises ``GatewayError`` with a safe reason if it cannot be built."""
    mode = mode or gateway.mode
    try:
        credentials = gateway_store.read_credentials(gateway, mode)
        options = validate_options(gateway.adapter, gateway.options)
    except SecretBoxError:
        raise GatewayError("credentials_unreadable") from None
    except ValueError:
        raise GatewayError("invalid_options") from None
    except Exception:  # noqa: BLE001
        raise GatewayError("encryption_unavailable") from None
    return GatewayConfig(
        adapter=gateway.adapter,
        mode=mode,
        credentials=credentials,
        options=options,
        scope=f"gw{gateway.pk}",
        gateway_id=gateway.pk,
    )


def adapter_for_offer(offer: Offer) -> PaymentGateway:
    if offer.gateway is None:
        return get_gateway(offer.adapter)
    return get_gateway(offer.adapter, resolve_config(offer.gateway, offer.mode))


def adapter_for_payment(payment: Payment) -> PaymentGateway:
    """The adapter configured exactly as the payment was created (gateway row + frozen
    mode), or the environment configuration for payments that predate gateways."""
    if payment.gateway_id and payment.mode:
        return get_gateway(payment.provider, resolve_config(payment.gateway, payment.mode))
    return get_gateway(payment.provider)


# --------------------------------------------------------------------------------------
# Offers
# --------------------------------------------------------------------------------------
def _env_offer(code: str) -> Offer:
    # The translated label of the current request language (the known providers carry one).
    label = str(PaymentProvider(code).label) if code in PaymentProvider.values else code
    return Offer(adapter=code, slug=code, name_en=label, name_bn=label, source="env")


def _db_offer(gateway: GatewayRow) -> Offer:
    return Offer(
        adapter=gateway.adapter,
        slug=gateway.slug,
        name_en=gateway.name_en,
        name_bn=gateway.name_bn,
        description_en=gateway.description_en,
        description_bn=gateway.description_bn,
        logo_url=gateway.logo_url,
        gateway=gateway,
        mode=gateway.mode,
        min_amount=gateway.min_amount,
        max_amount=gateway.max_amount,
        source="db",
    )


def available_offers(
    user, channel: str = "", *, amount: Decimal | None = None, currency: str = ""
) -> list[Offer]:
    """The methods ``user`` may choose now, best first. ``channel`` is ``web``, ``app`` or
    empty (no channel filter). ``amount``/``currency`` apply the gateways' limits."""
    if settings.PAYMENT_PROVIDER == PAYMENTS_UNAVAILABLE:
        return []
    tester = is_tester(user)
    rows = list(GatewayRow.objects.all())
    offers: list[Offer] = []
    for gateway in rows:  # ordered by priority
        if not gateway.enabled:
            continue
        if gateway.mode == GatewayMode.SANDBOX and not tester:
            continue
        if channel == "web" and not gateway.web_enabled:
            continue
        if channel == "app" and not gateway.app_enabled:
            continue
        if currency and gateway.currencies and currency not in gateway.currencies:
            continue
        if amount is not None:
            if gateway.min_amount is not None and amount < gateway.min_amount:
                continue
            if gateway.max_amount is not None and amount > gateway.max_amount:
                continue
        if gateway_issues(gateway):
            continue
        offers.append(_db_offer(gateway))
    configured = {gateway.adapter for gateway in rows}
    offers.extend(_env_offer(code) for code in offered_providers() if code not in configured)
    return offers


def pick_offer(offers: list[Offer], requested: str) -> Offer | None:
    """The offer a student asked for (a gateway slug, or an adapter code = the first
    offer of that adapter); no request = the first offer."""
    if not requested:
        return offers[0] if offers else None
    for offer in offers:
        if offer.slug == requested:
            return offer
    for offer in offers:
        if offer.adapter == requested:
            return offer
    return None


# --------------------------------------------------------------------------------------
# Return URLs (website and app are separate)
# --------------------------------------------------------------------------------------
def return_url_for(payment: Payment) -> str:
    """Where the browser goes after the provider: the gateway's own URL for the payment's
    channel, else the server-wide one. Always server configuration, never the request."""
    gateway = payment.gateway
    if payment.channel == "web":
        own = gateway.web_return_url if gateway else ""
        return own or settings.PAYMENT_WEB_RETURN_URL or settings.PAYMENT_RETURN_URL
    own = gateway.app_return_url if gateway else ""
    return own or settings.PAYMENT_RETURN_URL
