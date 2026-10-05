"""System checks: `manage.py check` reports unsafe or impossible OTP/SMS settings."""

from django.conf import settings
from django.core.checks import Error, Warning, register

# (setting, minimum, maximum) — maximums keep codes short-lived and brute force impractical.
BOUNDS = (
    ("OTP_LENGTH", 6, 10),
    ("OTP_TTL_SECONDS", 60, 3600),
    ("OTP_MAX_ATTEMPTS", 1, 10),
    ("OTP_REQUEST_LIMIT", 1, 100),
    ("OTP_REQUEST_WINDOW_SECONDS", 60, 86400),
    ("OTP_IP_REQUEST_LIMIT", 1, 10000),
    ("OTP_IP_REQUEST_WINDOW_SECONDS", 60, 86400),
    ("VERIFICATION_TOKEN_TTL_SECONDS", 60, 3600),
    ("OTP_RESEND_COOLDOWN_SECONDS", 0, 3600),
)


@register()
def check_otp_settings(app_configs, **kwargs):
    messages = []
    for name, low, high in BOUNDS:
        value = getattr(settings, name)
        if not low <= value <= high:
            messages.append(
                Error(f"{name}={value} must be between {low} and {high}.", id="verification.E001")
            )
    if settings.OTP_RESEND_COOLDOWN_SECONDS >= settings.OTP_TTL_SECONDS:
        messages.append(
            Error(
                "OTP_RESEND_COOLDOWN_SECONDS must be shorter than OTP_TTL_SECONDS.",
                id="verification.E002",
            )
        )
    if settings.SMS_PROVIDER not in settings.SMS_PROVIDERS:
        messages.append(
            Error(
                f"SMS_PROVIDER={settings.SMS_PROVIDER!r} is not configured.",
                hint=f"Use one of: {', '.join(sorted(settings.SMS_PROVIDERS))}.",
                id="verification.E004",
            )
        )
    if settings.SMS_MOCK_LOG_CONTENT and not settings.DEBUG:
        messages.append(
            Warning(
                "SMS_MOCK_LOG_CONTENT has no effect when DEBUG is off (codes are never logged).",
                id="verification.W001",
            )
        )
    return messages
