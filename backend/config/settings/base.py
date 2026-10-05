"""Base settings shared by every environment (dev, test, prod).

Environment-specific files (dev.py, test.py, prod.py) import everything from here
and override only what differs. All secrets come from environment variables.
"""

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
    # Django. `auth` + `contenttypes` are required by DRF. `admin`/`sessions` are not
    # installed: the Admin Panel is a separate Next.js app.
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    # Third party
    "rest_framework",
    "drf_spectacular",
    # Project modules (see docs/MODULES.md for the planned list and order)
    "apps.core",
]

# IMPORTANT: AUTH_USER_MODEL is intentionally NOT set yet.
# The custom User model (mobile number as login) is created in Milestone 2 *before*
# the first migration. Until then `migrate` is blocked by apps/core/management/commands/migrate.py.

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "apps.core.middleware.LanguageMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        # Needed only for the API docs page (Swagger UI) — no server-rendered UI here.
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
            ],
        },
    },
]

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
    # Authentication (JWT) arrives in Milestone 2. Until then nothing can authenticate,
    # and the default permission denies everything except views that explicitly allow it.
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.StandardPagination",
    "PAGE_SIZE": 20,
    "EXCEPTION_HANDLER": "apps.core.exceptions.api_exception_handler",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "UNAUTHENTICATED_USER": None,
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Online MCQ Platform API",
    "DESCRIPTION": "Central API for the Mobile App, Public Website and Admin Panel.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "SCHEMA_PATH_PREFIX": r"/api/v1",
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
