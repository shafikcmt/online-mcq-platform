"""Base settings shared by every environment (dev, test, prod).

Environment-specific files (dev.py, test.py, prod.py) import everything from here
and override only what differs. All secrets come from environment variables.
"""

from datetime import timedelta
from pathlib import Path

from django.utils.translation import gettext_lazy as _

from .env import env_bool, env_int, env_list, env_str

BASE_DIR = Path(__file__).resolve().parent.parent.parent  # .../backend

# --------------------------------------------------------------------------------------
# Core
# --------------------------------------------------------------------------------------
SECRET_KEY = env_str("DJANGO_SECRET_KEY", "")
DEBUG = env_bool("DJANGO_DEBUG", False)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")

INSTALLED_APPS = [
    # Django. The Django admin is for internal operations only — the product Admin
    # Panel is a separate Next.js app (Milestone 7).
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third party
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "drf_spectacular",
    # Project modules (see docs/MODULES.md for the planned list and order)
    "apps.core",
    "apps.verification",
    "apps.accounts",
]

# Custom user model: the mobile number is the login identity (docs/DATABASE_DESIGN.md §4.1).
# Set before the project's first migration — never change it afterwards.
AUTH_USER_MODEL = "accounts.User"

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "apps.core.middleware.LanguageMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        # Used only by the API docs page and the internal Django admin.
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# Internal Django admin URL (keep it non-obvious in production).
DJANGO_ADMIN_URL = env_str("DJANGO_ADMIN_URL", "django-admin/")

# --------------------------------------------------------------------------------------
# Passwords — hashed with Argon2 (PBKDF2 kept so older hashes still verify)
# --------------------------------------------------------------------------------------
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
    "django.contrib.auth.hashers.ScryptPasswordHasher",
]
AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
        "OPTIONS": {"user_attributes": ("mobile_number", "full_name", "email")},
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": env_int("PASSWORD_MIN_LENGTH", 8)},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# --------------------------------------------------------------------------------------
# OTP verification (docs/SECURITY_PLAN.md §3.2) — all values configurable
# --------------------------------------------------------------------------------------
OTP_LENGTH = env_int("OTP_LENGTH", 6)
OTP_TTL_SECONDS = env_int("OTP_TTL_SECONDS", 300)
OTP_RESEND_COOLDOWN_SECONDS = env_int("OTP_RESEND_COOLDOWN_SECONDS", 60)
OTP_MAX_ATTEMPTS = env_int("OTP_MAX_ATTEMPTS", 5)
# Codes per mobile number (all purposes) within the window.
OTP_REQUEST_LIMIT = env_int("OTP_REQUEST_LIMIT", 5)
OTP_REQUEST_WINDOW_SECONDS = env_int("OTP_REQUEST_WINDOW_SECONDS", 3600)
# Code requests per client IP within the window.
OTP_IP_REQUEST_LIMIT = env_int("OTP_IP_REQUEST_LIMIT", 20)
OTP_IP_REQUEST_WINDOW_SECONDS = env_int("OTP_IP_REQUEST_WINDOW_SECONDS", 3600)
VERIFICATION_TOKEN_TTL_SECONDS = env_int("VERIFICATION_TOKEN_TTL_SECONDS", 600)

# SMS delivery. Real Bangladesh gateways are added to SMS_PROVIDERS later.
SMS_PROVIDER = env_str("SMS_PROVIDER", "mock")
SMS_PROVIDERS = {
    "mock": "apps.verification.sms.mock.MockSmsProvider",
}
# Development only: print mock SMS text (incl. the code) to the console. Ignored unless DEBUG.
SMS_MOCK_LOG_CONTENT = env_bool("SMS_MOCK_LOG_CONTENT", False)

# --------------------------------------------------------------------------------------
# Database — PostgreSQL is the single source of truth
# --------------------------------------------------------------------------------------
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env_str("POSTGRES_DB", "online_mcq"),
        "USER": env_str("POSTGRES_USER", "online_mcq"),
        "PASSWORD": env_str("POSTGRES_PASSWORD", ""),
        "HOST": env_str("POSTGRES_HOST", "localhost"),
        "PORT": env_str("POSTGRES_PORT", "5432"),
        "CONN_MAX_AGE": env_int("POSTGRES_CONN_MAX_AGE", 60),
        "CONN_HEALTH_CHECKS": True,
    }
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --------------------------------------------------------------------------------------
# Redis — cache now; Celery broker; later throttling counters
# --------------------------------------------------------------------------------------
REDIS_URL = env_str("REDIS_URL", "redis://localhost:6379/0")
REDIS_CACHE_URL = env_str("REDIS_CACHE_URL", "redis://localhost:6379/1")

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_CACHE_URL,
        "KEY_PREFIX": "mcq",
    }
}

# --------------------------------------------------------------------------------------
# Celery — app is configured, no tasks yet
# --------------------------------------------------------------------------------------
CELERY_BROKER_URL = env_str("CELERY_BROKER_URL", REDIS_URL)
CELERY_TASK_IGNORE_RESULT = True  # no result backend until a feature needs one
CELERY_TIMEZONE = "UTC"
CELERY_TASK_ACKS_LATE = True  # re-deliver if a worker dies mid-task (tasks must be idempotent)
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True

# --------------------------------------------------------------------------------------
# Internationalization — Bangla + English (see docs/LOCALIZATION.md)
# --------------------------------------------------------------------------------------
LANGUAGES = [
    ("bn", _("Bangla")),
    ("en", _("English")),
]
# Platform default (Mobile App + Public Website default to Bangla).
LANGUAGE_CODE = env_str("DEFAULT_LANGUAGE", "bn")
# Default for Admin Panel API requests (/api/v1/admin/...) when the client sends no language.
ADMIN_DEFAULT_LANGUAGE = env_str("ADMIN_DEFAULT_LANGUAGE", "en")
ADMIN_API_PATH_PREFIX = "/api/v1/admin/"
USE_I18N = True
LOCALE_PATHS = [BASE_DIR / "locale"]

# Store and return UTC; clients display Asia/Dhaka.
TIME_ZONE = "UTC"
USE_TZ = True

# --------------------------------------------------------------------------------------
# Static files (only used by the API docs page for now)
# --------------------------------------------------------------------------------------
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# --------------------------------------------------------------------------------------
# Django REST Framework
# --------------------------------------------------------------------------------------
REST_FRAMEWORK = {
    # Student JWT authentication; every view is closed unless it explicitly allows access.
    "DEFAULT_AUTHENTICATION_CLASSES": ["apps.accounts.authentication.StudentJWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.StandardPagination",
    "PAGE_SIZE": 20,
    "EXCEPTION_HANDLER": "apps.core.exceptions.api_exception_handler",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    # DRF would otherwise trust X-Forwarded-For blindly; see apps/core/net.py.
    "NUM_PROXIES": env_int("TRUSTED_PROXY_COUNT", 0),
}

# --------------------------------------------------------------------------------------
# Client IP / reverse proxies (apps/core/net.py)
# --------------------------------------------------------------------------------------
# Number of reverse proxies YOU run in front of Django (Nginx = 1, Cloudflare + Nginx = 2).
# 0 = ignore X-Forwarded-For entirely and use the connection address.
TRUSTED_PROXY_COUNT = env_int("TRUSTED_PROXY_COUNT", 0)

# --------------------------------------------------------------------------------------
# JWT (djangorestframework-simplejwt) — student API authentication
# --------------------------------------------------------------------------------------
# Separate from SECRET_KEY so either can be rotated independently. dev.py/test.py
# provide throw-away keys; production refuses to start without a strong one.
JWT_SIGNING_KEY = env_str("JWT_SIGNING_KEY", "")
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(seconds=env_int("JWT_ACCESS_TOKEN_LIFETIME_SECONDS", 900)),
    "REFRESH_TOKEN_LIFETIME": timedelta(
        seconds=env_int("JWT_REFRESH_TOKEN_LIFETIME_SECONDS", 30 * 24 * 3600)
    ),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": False,  # the login view updates it explicitly
    "ALGORITHM": "HS256",
    "SIGNING_KEY": JWT_SIGNING_KEY,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
    "CHECK_USER_IS_ACTIVE": True,
    "CHECK_REVOKE_TOKEN": False,  # replaced by our auth_version claim
    "LEEWAY": 0,
}

# --------------------------------------------------------------------------------------
# HTTP security throttles (Redis; fail closed) — format: "<count>/<second|minute|hour|day>"
# --------------------------------------------------------------------------------------
AUTH_THROTTLE_RATES = {
    "login": env_str("THROTTLE_LOGIN", "10/hour"),  # per client IP + mobile number
    "login_ip": env_str("THROTTLE_LOGIN_IP", "60/hour"),
    "otp_verify": env_str("THROTTLE_OTP_VERIFY", "30/hour"),
    "register": env_str("THROTTLE_REGISTER", "10/hour"),
    "password_reset": env_str("THROTTLE_PASSWORD_RESET", "10/hour"),
    "password_change": env_str("THROTTLE_PASSWORD_CHANGE", "10/hour"),  # per user
    "token_refresh": env_str("THROTTLE_TOKEN_REFRESH", "120/hour"),
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Online MCQ Platform API",
    "DESCRIPTION": "Central API for the Mobile App, Public Website and Admin Panel.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "SCHEMA_PATH_PREFIX": r"/api/v1",
    "ENUM_NAME_OVERRIDES": {"LanguageEnum": "apps.accounts.api.serializers.LANGUAGE_CHOICES"},
}
# API docs (/api/schema/, /api/docs/) are exposed only when enabled (on in dev, off in prod).
API_DOCS_ENABLED = env_bool("API_DOCS_ENABLED", False)

# --------------------------------------------------------------------------------------
# Security defaults (prod.py tightens further)
# --------------------------------------------------------------------------------------
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
DATA_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024  # 2 MB request body limit

# --------------------------------------------------------------------------------------
# Logging — console output; never log secrets, passwords, OTPs or tokens
# --------------------------------------------------------------------------------------
LOG_LEVEL = env_str("DJANGO_LOG_LEVEL", "INFO")
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "simple": {"format": "{asctime} {levelname} {name} {message}", "style": "{"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "simple"},
    },
    "root": {"handlers": ["console"], "level": LOG_LEVEL},
}
