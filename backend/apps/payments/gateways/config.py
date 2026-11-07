"""What an adapter needs to talk to one merchant account: ``GatewayConfig``.

Adapters never read ``django.conf.settings`` for credentials. They get a ``GatewayConfig``,
built either from the admin-managed database row (``gateway_manager.resolve_config``) or,
as the backward-compatible fallback, from the environment (``env_config``). The credentials
are held in memory only and are left out of ``repr``.
"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from django.conf import settings

SANDBOX = "sandbox"
LIVE = "live"


@dataclass(frozen=True)
class GatewayConfig:
    adapter: str
    mode: str = SANDBOX
    credentials: Mapping[str, str] = field(default_factory=dict, repr=False)
    options: Mapping[str, Any] = field(default_factory=dict)
    # Namespaces caches (e.g. bKash tokens) so two merchants or two modes never share one.
    scope: str = "env"
    gateway_id: int | None = None

    @property
    def sandbox(self) -> bool:
        return self.mode != LIVE

    def credential(self, name: str) -> str:
        return str(self.credentials.get(name, "") or "")

    def option(self, name: str, default: Any = None) -> Any:
        value = self.options.get(name)
        return default if value in (None, "") else value


def env_config(adapter: str) -> GatewayConfig:
    """The environment-variable configuration of ``adapter`` (the pre-database behaviour)."""
    if adapter == "bkash":
        sandbox = settings.BKASH_SANDBOX
        return GatewayConfig(
            adapter,
            SANDBOX if sandbox else LIVE,
            credentials={
                "app_key": settings.BKASH_APP_KEY,
                "app_secret": settings.BKASH_APP_SECRET,
                "username": settings.BKASH_USERNAME,
                "password": settings.BKASH_PASSWORD,
            },
            options={
                "api_version": settings.BKASH_API_VERSION,
                "timeout_seconds": settings.BKASH_TIMEOUT_SECONDS,
            },
            scope=f"env-{SANDBOX if sandbox else LIVE}",
        )
    if adapter == "sslcommerz":
        sandbox = settings.SSLCOMMERZ_SANDBOX
        return GatewayConfig(
            adapter,
            SANDBOX if sandbox else LIVE,
            credentials={
                "store_id": settings.SSLCOMMERZ_STORE_ID,
                "store_password": settings.SSLCOMMERZ_STORE_PASSWORD,
            },
            options={
                "timeout_seconds": settings.SSLCOMMERZ_TIMEOUT_SECONDS,
                "customer_email": settings.SSLCOMMERZ_CUSTOMER_EMAIL,
                "customer_address": settings.SSLCOMMERZ_CUSTOMER_ADDRESS,
                "customer_city": settings.SSLCOMMERZ_CUSTOMER_CITY,
                "customer_country": settings.SSLCOMMERZ_CUSTOMER_COUNTRY,
            },
            scope=f"env-{SANDBOX if sandbox else LIVE}",
        )
    return GatewayConfig(adapter, SANDBOX, scope="env")


def lookup_config(adapter: str) -> GatewayConfig:
    """A credential-less config: enough to PARSE a callback and find the payment it is
    about (before we know which merchant account to check the signature with)."""
    return GatewayConfig(adapter, SANDBOX, scope="lookup")
