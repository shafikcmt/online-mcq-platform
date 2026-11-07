"""Production settings. Refuses to start with placeholder secrets or DEBUG on."""

from .base import *  # noqa: F403
from .base import (
    ALLOWED_HOSTS,
    BKASH_APP_KEY,
    BKASH_APP_SECRET,
    BKASH_PASSWORD,
    BKASH_SANDBOX,
    BKASH_USERNAME,
    DATABASES,
    DEBUG,
    JWT_SIGNING_KEY,
    PAYMENT_CALLBACK_BASE_URL,
    PAYMENT_ENABLED_PROVIDERS,
    PAYMENT_PROVIDER,
    PAYMENT_PROVIDERS,
    PAYMENT_RETURN_URL,
    SECRET_KEY,
    SMS_PROVIDER,
    SSLCOMMERZ_SANDBOX,
    SSLCOMMERZ_STORE_ID,
    SSLCOMMERZ_STORE_PASSWORD,
)
from .checks import validate_payment_settings, validate_production_settings
from .env import env_bool, env_int

validate_production_settings(
    secret_key=SECRET_KEY,
    debug=DEBUG,
    allowed_hosts=ALLOWED_HOSTS,
    db_password=DATABASES["default"]["PASSWORD"],
    sms_provider=SMS_PROVIDER,
    allow_mock_sms=env_bool("SMS_ALLOW_MOCK_IN_PRODUCTION", False),
    jwt_signing_key=JWT_SIGNING_KEY,
)

validate_payment_settings(
    provider=PAYMENT_PROVIDER,
    providers=PAYMENT_PROVIDERS,
    store_id=SSLCOMMERZ_STORE_ID,
    store_password=SSLCOMMERZ_STORE_PASSWORD,
    sandbox=SSLCOMMERZ_SANDBOX,
    allow_sandbox=env_bool("PAYMENT_ALLOW_SANDBOX_IN_PRODUCTION", False),
    callback_base_url=PAYMENT_CALLBACK_BASE_URL,
    return_url=PAYMENT_RETURN_URL,
    enabled=PAYMENT_ENABLED_PROVIDERS,
    bkash_credentials=(BKASH_APP_KEY, BKASH_APP_SECRET, BKASH_USERNAME, BKASH_PASSWORD),
    bkash_sandbox=BKASH_SANDBOX,
)
# The mock payment provider can never run in production — not even for old payments.
PAYMENT_MOCK_ALLOWED = False

# OTP/SMS text is never written to logs in production.
SMS_MOCK_LOG_CONTENT = False

API_DOCS_ENABLED = env_bool("API_DOCS_ENABLED", False)

# HTTPS (TLS terminates at the reverse proxy in front of Django).
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", True)
SECURE_HSTS_SECONDS = env_int("DJANGO_SECURE_HSTS_SECONDS", 31536000)
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = False  # enable only after the domain is confirmed
# Preload submission is a deliberate later decision (it is hard to undo), so its check is silenced.
SILENCED_SYSTEM_CHECKS = ["security.W021"]
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_REFERRER_POLICY = "same-origin"
