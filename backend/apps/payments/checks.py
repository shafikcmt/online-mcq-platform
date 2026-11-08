"""System checks: `manage.py check` reports impossible payment settings."""

from django.conf import settings
from django.core.checks import Error, register

from .gateways import PAYMENTS_DATABASE, PAYMENTS_UNAVAILABLE

# (setting, minimum, maximum)
BOUNDS = (
    ("PAYMENT_RECONCILE_MIN_AGE_SECONDS", 60, 86400),
    ("PAYMENT_ABANDON_AFTER_SECONDS", 3600, 30 * 86400),
    ("PAYMENT_RECONCILE_BATCH_SIZE", 1, 1000),
    ("PAYMENT_RECONCILE_MAX_BATCHES", 1, 100),
    ("SSLCOMMERZ_TIMEOUT_SECONDS", 1, 60),
    ("BKASH_TIMEOUT_SECONDS", 1, 60),
    ("SUBSCRIPTION_EXPIRY_BATCH_SIZE", 1, 10000),
    ("SUBSCRIPTION_EXPIRY_MAX_BATCHES", 1, 1000),
)


@register()
def check_payment_settings(app_configs, **kwargs):
    messages = []
    for name, low, high in BOUNDS:
        value = getattr(settings, name)
        if not low <= value <= high:
            messages.append(
                Error(f"{name}={value} must be between {low} and {high}.", id="payments.E001")
            )
    if (
        settings.PAYMENT_PROVIDER not in settings.PAYMENT_PROVIDERS
        and settings.PAYMENT_PROVIDER not in (PAYMENTS_UNAVAILABLE, PAYMENTS_DATABASE)
    ):
        messages.append(
            Error(
                f"PAYMENT_PROVIDER={settings.PAYMENT_PROVIDER!r} is not configured.",
                hint=(
                    f"Use one of: {', '.join(sorted(settings.PAYMENT_PROVIDERS))}, "
                    f"{PAYMENTS_DATABASE!r} for the Admin Panel's gateways only, "
                    f"or {PAYMENTS_UNAVAILABLE!r} to take no payments."
                ),
                id="payments.E002",
            )
        )
    for code in settings.PAYMENT_ENABLED_PROVIDERS:
        if code not in settings.PAYMENT_PROVIDERS:
            messages.append(
                Error(
                    f"PAYMENT_ENABLED_PROVIDERS contains {code!r}, which is not configured.",
                    hint=f"Use any of: {', '.join(sorted(settings.PAYMENT_PROVIDERS))}.",
                    id="payments.E005",
                )
            )
        elif code == "mock" and not settings.PAYMENT_MOCK_ALLOWED:
            messages.append(
                Error(
                    "PAYMENT_ENABLED_PROVIDERS contains mock while PAYMENT_MOCK_ALLOWED is off.",
                    id="payments.E003",
                )
            )
    if settings.PAYMENT_PROVIDER == "mock" and not settings.PAYMENT_MOCK_ALLOWED:
        messages.append(
            Error("PAYMENT_PROVIDER=mock while PAYMENT_MOCK_ALLOWED is off.", id="payments.E003")
        )
    if settings.PAYMENT_ABANDON_AFTER_SECONDS <= settings.PAYMENT_RECONCILE_MIN_AGE_SECONDS:
        messages.append(
            Error(
                "PAYMENT_ABANDON_AFTER_SECONDS must be longer than "
                "PAYMENT_RECONCILE_MIN_AGE_SECONDS.",
                id="payments.E004",
            )
        )
    return messages
