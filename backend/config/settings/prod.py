"""Production settings. Refuses to start with placeholder secrets or DEBUG on."""

from .base import *  # noqa: F403
from .base import (
    ALLOWED_HOSTS,
    DATABASES,
    DEBUG,
    JWT_SIGNING_KEY,
    SECRET_KEY,
    SMS_PROVIDER,
)
from .checks import validate_production_settings
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
