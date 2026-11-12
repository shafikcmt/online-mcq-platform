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
# Fernet key that encrypts secrets stored in the database (SMS gateway API keys).
SECRET_ENCRYPTION_KEY = env_str("SECRET_ENCRYPTION_KEY", "")
# Old keys, kept only while rotating (decrypt only); see `manage.py rotate_secrets`.
SECRET_ENCRYPTION_KEY_PREVIOUS = env_list("SECRET_ENCRYPTION_KEY_PREVIOUS", "")
DEBUG = env_bool("DJANGO_DEBUG", False)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
# Extra origins allowed to send CSRF-protected requests. Production (nginx serves the panel
# and routes /api/ to Django on the SAME host, forwarding Host) needs none. Only needed when
# the Host Django sees differs from the panel's origin — e.g. the local Next.js dev proxy
# (http://localhost:3001). See docs/DEPLOYMENT.md.
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", "")
# Admin Panel session lifetime (set per session at admin sign-in; other sessions keep
# Django's SESSION_COOKIE_AGE).
ADMIN_SESSION_AGE_SECONDS = env_int("ADMIN_SESSION_AGE_SECONDS", 12 * 60 * 60)

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
    "apps.audit",
    "apps.catalog",
    "apps.questions",
    "apps.exams",
    "apps.subscriptions",
    "apps.attempts",
    "apps.results",
    "apps.payments",
    "apps.cms",
    "apps.materials",
    "apps.simulation",
    "apps.notifications",
    "apps.dashboard",
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
    "bulksmsbd": "apps.verification.sms.bulksmsbd.BulkSmsBdProvider",
}
# BulkSMSBD gateway. The API key is a secret: keep it in the server's .env only.
SMS_API_URL = env_str("SMS_API_URL", "https://bulksmsbd.net/api/smsapi")
SMS_API_KEY = env_str("SMS_API_KEY", "")
SMS_SENDER_ID = env_str("SMS_SENDER_ID", "")
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
# Celery
# --------------------------------------------------------------------------------------
CELERY_BROKER_URL = env_str("CELERY_BROKER_URL", REDIS_URL)
CELERY_TASK_IGNORE_RESULT = True  # no result backend until a feature needs one
CELERY_TIMEZONE = "UTC"
CELERY_TASK_ACKS_LATE = True  # re-deliver if a worker dies mid-task (tasks must be idempotent)
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True
# Periodic jobs (run by the ``celery beat`` service).
CELERY_BEAT_SCHEDULE = {
    # docs/ARCHITECTURE.md §7: close abandoned attempts after deadline + grace.
    "finalize-overdue-attempts": {
        "task": "apps.attempts.tasks.finalize_overdue_attempts_task",
        "schedule": 60.0,
    },
    # docs/ARCHITECTURE.md §7: generate merit positions after the exam window closes.
    "generate-due-merit": {
        "task": "apps.results.tasks.generate_due_merit_task",
        "schedule": 300.0,
    },
    # docs/ARCHITECTURE.md §7: in-app "result published" notifications once results are
    # visible (admin publication triggers it at once; this catches after_exam_end).
    "notify-visible-results": {
        "task": "apps.results.tasks.notify_visible_results_task",
        "schedule": float(env_int("RESULT_NOTIFY_INTERVAL_SECONDS", 120)),
    },
    # Automatic exam reminders by push (a no-op while PUSH_ENABLED is off).
    "send-exam-reminders": {
        "task": "apps.notifications.tasks.send_exam_reminders_task",
        "schedule": float(env_int("EXAM_REMINDER_INTERVAL_SECONDS", 60)),
    },
    # docs/ARCHITECTURE.md §7: mark subscriptions past expires_at as expired (bookkeeping;
    # access is computed from server time and never waits for this job).
    "expire-subscriptions": {
        "task": "apps.subscriptions.tasks.expire_subscriptions_task",
        "schedule": 3600.0,
    },
    # docs/ARCHITECTURE.md §7: re-query the provider for payments stuck in pending.
    "reconcile-payments": {
        "task": "apps.payments.tasks.reconcile_payments_task",
        "schedule": float(env_int("PAYMENT_RECONCILE_INTERVAL_SECONDS", 600)),
    },
}

# --------------------------------------------------------------------------------------
# Internationalization — Bangla + English (see docs/LOCALIZATION.md)
# --------------------------------------------------------------------------------------
LANGUAGES = [
    ("bn", _("Bangla")),
    ("en", _("English")),
]
# Platform default (Mobile App + Public Website default to Bangla). Admin-editable in the
# site settings (Milestone 6A); this value applies until they are first saved.
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
    # Admin Panel sign-in: own buckets, never shared with the student login scopes.
    "admin_login": env_str("THROTTLE_ADMIN_LOGIN", "10/hour"),  # per client IP + mobile
    "admin_login_ip": env_str("THROTTLE_ADMIN_LOGIN_IP", "60/hour"),  # per client IP
    "otp_verify": env_str("THROTTLE_OTP_VERIFY", "30/hour"),
    "register": env_str("THROTTLE_REGISTER", "10/hour"),
    "password_reset": env_str("THROTTLE_PASSWORD_RESET", "10/hour"),
    "password_change": env_str("THROTTLE_PASSWORD_CHANGE", "10/hour"),  # per user
    "token_refresh": env_str("THROTTLE_TOKEN_REFRESH", "120/hour"),
    "payment_init": env_str("THROTTLE_PAYMENT_INIT", "10/hour"),  # per student
    "payment_callback": env_str("THROTTLE_PAYMENT_CALLBACK", "120/minute"),  # per client IP
    # The list of payment methods reads the gateways and checks their credentials: bounded per
    # student (a real student opens the buy screen a few times a minute at most).
    "payment_methods": env_str("THROTTLE_PAYMENT_METHODS", "60/minute"),
    "question_import": env_str("THROTTLE_QUESTION_IMPORT", "30/hour"),  # per admin
    "document_upload": env_str("THROTTLE_DOCUMENT_UPLOAD", "30/hour"),  # per admin (PDF uploads)
    "contact_form": env_str("THROTTLE_CONTACT_FORM", "5/hour"),  # per client IP
    "push_send": env_str("THROTTLE_PUSH_SEND", "20/hour"),  # per admin (push messages)
    "push_device": env_str("THROTTLE_PUSH_DEVICE", "30/hour"),  # per student (token registration)
}

# --------------------------------------------------------------------------------------
# Push notifications (Expo). Off by default: nothing is sent until the owner has an Expo project
# with push credentials and sets PUSH_ENABLED=1. The access token (only needed if "enhanced push
# security" is on in Expo) is a secret: environment only, never in the database, git or logs.
# docs/PUSH_NOTIFICATIONS.md.
# --------------------------------------------------------------------------------------
PUSH_ENABLED = env_bool("PUSH_ENABLED", False)
EXPO_PUSH_URL = env_str("EXPO_PUSH_URL", "https://exp.host/--/api/v2/push/send")
EXPO_ACCESS_TOKEN = env_str("EXPO_ACCESS_TOKEN", "")
PUSH_BATCH_SIZE = 100  # Expo accepts at most 100 messages per request
PUSH_TIMEOUT_SECONDS = env_int("PUSH_TIMEOUT_SECONDS", 15)
# Automatic exam reminders: minutes before an exam's start (comma separated; empty = none).
EXAM_REMINDER_OFFSETS_MINUTES = [
    int(value)
    for value in env_list("EXAM_REMINDER_OFFSETS_MINUTES", "1440,60")
    if value.strip().isdigit()
]
EXAM_REMINDER_INTERVAL_SECONDS = env_int("EXAM_REMINDER_INTERVAL_SECONDS", 60)

SPECTACULAR_SETTINGS = {
    "TITLE": "Live Model Test API",
    "DESCRIPTION": "Central API for the Mobile App, Public Website and Admin Panel.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "SCHEMA_PATH_PREFIX": r"/api/v1",
    "ENUM_NAME_OVERRIDES": {
        "LanguageEnum": "apps.accounts.api.serializers.LANGUAGE_CHOICES",
        # bn / en / both — questions.available_languages and exams.content_language
        "LanguageCoverageEnum": "apps.questions.models.AvailableLanguages",
        "PackageStatusEnum": "apps.subscriptions.models.PackageStatus",
        "SubscriptionStatusEnum": "apps.subscriptions.models.SubscriptionStatus",
        # bn / en with labels — users.preferred_language and attempts.content_language
        "AppLanguageEnum": "apps.attempts.models.AttemptLanguage",
        "AttemptStatusEnum": "apps.attempts.models.AttemptStatus",
        "PaymentStatusEnum": "apps.payments.models.PaymentStatus",
        "PaymentProviderEnum": "apps.payments.models.PaymentProvider",
        "PaymentEventTypeEnum": "apps.payments.models.PaymentEventType",
        "NotificationTypeEnum": "apps.notifications.models.NotificationType",
        "ContactStatusEnum": "apps.cms.models.ContactStatus",
        "LeaderboardNameModeEnum": "apps.cms.models.LeaderboardNameMode",
        "AnnouncementAudienceEnum": "apps.cms.models.Audience",
    },
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
# Uploaded media (question images). Phase-1: local disk via Django's storage API
# (swappable to S3-compatible storage later). Production serving (Nginx, no script
# execution, separate volume) is configured with the deployment — docs/ROADMAP.md M10.
# --------------------------------------------------------------------------------------
MEDIA_ROOT = env_str("MEDIA_ROOT", str(BASE_DIR / "media"))
MEDIA_URL = "/media/"

# --------------------------------------------------------------------------------------
# Question bank (Milestone 3B) — configurable business rules
# --------------------------------------------------------------------------------------
QUESTION_MIN_OPTIONS = env_int("QUESTION_MIN_OPTIONS", 2)  # docs/DATABASE_DESIGN.md §4.4
QUESTION_MAX_OPTIONS = env_int("QUESTION_MAX_OPTIONS", 10)
QUESTION_IMAGE_MAX_BYTES = env_int("QUESTION_IMAGE_MAX_BYTES", 2 * 1024 * 1024)  # 2 MB
# Bulk import (CSV / Excel): the upload and the number of question rows it may carry.
QUESTION_IMPORT_MAX_BYTES = env_int("QUESTION_IMPORT_MAX_BYTES", 5 * 1024 * 1024)  # 5 MB
QUESTION_IMPORT_MAX_ROWS = env_int("QUESTION_IMPORT_MAX_ROWS", 2000)
# PDF documents (exam routine, notice PDFs): the largest accepted upload.
DOCUMENT_MAX_BYTES = env_int("DOCUMENT_MAX_BYTES", 10 * 1024 * 1024)  # 10 MB
QUESTION_IMAGE_MAX_PIXELS = env_int("QUESTION_IMAGE_MAX_PIXELS", 16_000_000)  # e.g. 4000×4000

# Exam builder (Milestone 3C): upper bound for one exam's question list.
EXAM_MAX_QUESTIONS = env_int("EXAM_MAX_QUESTIONS", 500)

# Packages (Milestone 4A): upper bound for one package's access-rule list.
PACKAGE_MAX_ACCESS_RULES = env_int("PACKAGE_MAX_ACCESS_RULES", 500)

# Exam engine (Milestone 4B). Grace absorbs network latency of the final submit only;
# answers can change only before the deadline (docs/SECURITY_PLAN.md §3.4).
ATTEMPT_SUBMIT_GRACE_SECONDS = env_int("ATTEMPT_SUBMIT_GRACE_SECONDS", 30)
# Auto-finalize job: rows per transaction, and transactions per run (bounded work).
ATTEMPT_FINALIZE_BATCH_SIZE = env_int("ATTEMPT_FINALIZE_BATCH_SIZE", 200)
ATTEMPT_FINALIZE_MAX_BATCHES = env_int("ATTEMPT_FINALIZE_MAX_BATCHES", 50)

# Results & merit (Milestone 4C). Leaderboard name modes: masked (default) | initials |
# display_name | full_name — never phone/email. Admin-editable in the site settings
# (Milestone 6A, ``cms``); these are the defaults until the settings are first saved.
LEADERBOARD_PUBLIC_NAME_MODE = env_str("LEADERBOARD_PUBLIC_NAME_MODE", "masked")
LEADERBOARD_APP_NAME_MODE = env_str("LEADERBOARD_APP_NAME_MODE", "masked")
# Rows on the public (website) leaderboard ("top N").
LEADERBOARD_PUBLIC_SIZE = env_int("LEADERBOARD_PUBLIC_SIZE", 100)

# In-app "result published" notifications (Milestone 6B): only results that became
# visible after the rollout boundary (``notifications.NotificationRollout``, recorded by
# migration) are announced; rows per batch and batches per run keep each job bounded.
RESULT_NOTIFY_BATCH_SIZE = env_int("RESULT_NOTIFY_BATCH_SIZE", 500)
RESULT_NOTIFY_MAX_BATCHES = env_int("RESULT_NOTIFY_MAX_BATCHES", 20)

# Dashboards (Milestone 6C): "today" / "this month" are calendar periods in this time zone
# (the platform's display time zone); rows per short list on the student dashboard.
DASHBOARD_TIME_ZONE = env_str("DASHBOARD_TIME_ZONE", "Asia/Dhaka")
DASHBOARD_LIST_SIZE = env_int("DASHBOARD_LIST_SIZE", 5)

# The app's own URL scheme for the website's "Open App" link (e.g. "mcqapp" →
# mcqapp://open). Site settings accept only https:// or this exact scheme for
# app_open_url; empty = https:// only (no app scheme configured yet).
APP_DEEP_LINK_SCHEME = env_str("APP_DEEP_LINK_SCHEME", "")

# Subscription expiry job (Milestone 5): rows per transaction, transactions per run.
SUBSCRIPTION_EXPIRY_BATCH_SIZE = env_int("SUBSCRIPTION_EXPIRY_BATCH_SIZE", 500)
SUBSCRIPTION_EXPIRY_MAX_BATCHES = env_int("SUBSCRIPTION_EXPIRY_MAX_BATCHES", 20)

# --------------------------------------------------------------------------------------
# Payments (Milestone 5) — docs/SECURITY_PLAN.md §3.5. Credentials only from the
# environment; never committed, logged or returned by the API.
# --------------------------------------------------------------------------------------
# Provider used for new payments. Gateways are registered here (bKash/Nagad later).
# "unavailable" = this server takes no payments at all (every purchase is refused).
PAYMENT_PROVIDER = env_str("PAYMENT_PROVIDER", "mock")
PAYMENT_PROVIDERS = {
    "mock": "apps.payments.gateways.mock.MockGateway",
    "sslcommerz": "apps.payments.gateways.sslcommerz.SslCommerzGateway",
    "bkash": "apps.payments.gateways.bkash.BkashGateway",
}
# Methods a student may choose from for NEW payments (comma-separated provider codes, in the
# order they are shown; the first is the default). Empty = just PAYMENT_PROVIDER. Every code
# must be registered above. PAYMENT_PROVIDER=unavailable still switches ALL payments off.
PAYMENT_ENABLED_PROVIDERS = env_list("PAYMENT_ENABLED_PROVIDERS", "")
# The mock provider grants access without real money: development/tests only.
# prod.py forces this off (no override).
PAYMENT_MOCK_ALLOWED = env_bool("PAYMENT_MOCK_ALLOWED", True)
# Public base URL of this API, used to build the provider callback/IPN URLs
# (e.g. https://api.example.com). Never taken from the request.
PAYMENT_CALLBACK_BASE_URL = env_str("PAYMENT_CALLBACK_BASE_URL", "http://localhost:8000")
# Where the browser is sent after a callback (app return page or app scheme), with
# ?payment=<id>&status=<status>. Empty = a small JSON answer (development).
PAYMENT_RETURN_URL = env_str("PAYMENT_RETURN_URL", "")
# The same for payments started on the WEBSITE (the app keeps PAYMENT_RETURN_URL). Empty =
# fall back to PAYMENT_RETURN_URL. A gateway's own return URLs (admin panel) win over both.
PAYMENT_WEB_RETURN_URL = env_str("PAYMENT_WEB_RETURN_URL", "")
# Reconciliation: only payments older than this are re-queried; one the provider has
# never heard of is closed as "abandoned" after PAYMENT_ABANDON_AFTER_SECONDS.
PAYMENT_RECONCILE_MIN_AGE_SECONDS = env_int("PAYMENT_RECONCILE_MIN_AGE_SECONDS", 900)
PAYMENT_ABANDON_AFTER_SECONDS = env_int("PAYMENT_ABANDON_AFTER_SECONDS", 24 * 3600)
PAYMENT_RECONCILE_BATCH_SIZE = env_int("PAYMENT_RECONCILE_BATCH_SIZE", 50)
PAYMENT_RECONCILE_MAX_BATCHES = env_int("PAYMENT_RECONCILE_MAX_BATCHES", 10)
# Admin re-verify: at most one provider query per payment in this many seconds (a double
# click, two admins, or right after a callback/reconciliation check) → 429 + Retry-After.
PAYMENT_REVERIFY_COOLDOWN_SECONDS = env_int("PAYMENT_REVERIFY_COOLDOWN_SECONDS", 60)

# bKash Tokenized Checkout (sandbox by default; live needs BKASH_SANDBOX=false). The four
# credentials come from the merchant's bKash onboarding; they exist only in the server
# environment — never in git, logs, API answers or the database.
BKASH_APP_KEY = env_str("BKASH_APP_KEY", "")
BKASH_APP_SECRET = env_str("BKASH_APP_SECRET", "")
BKASH_USERNAME = env_str("BKASH_USERNAME", "")
BKASH_PASSWORD = env_str("BKASH_PASSWORD", "")
BKASH_SANDBOX = env_bool("BKASH_SANDBOX", True)
# The API version in the URL path; changing it needs no code change (see bKash's reference).
BKASH_API_VERSION = env_str("BKASH_API_VERSION", "v1.2.0-beta")
BKASH_TIMEOUT_SECONDS = env_int("BKASH_TIMEOUT_SECONDS", 15)

# SSLCommerz (sandbox by default; live needs SSLCOMMERZ_SANDBOX=false).
SSLCOMMERZ_STORE_ID = env_str("SSLCOMMERZ_STORE_ID", "")
SSLCOMMERZ_STORE_PASSWORD = env_str("SSLCOMMERZ_STORE_PASSWORD", "")
SSLCOMMERZ_SANDBOX = env_bool("SSLCOMMERZ_SANDBOX", True)
SSLCOMMERZ_TIMEOUT_SECONDS = env_int("SSLCOMMERZ_TIMEOUT_SECONDS", 15)
# SSLCommerz requires customer e-mail and address fields; we send the student's name,
# mobile and e-mail (if any) and these neutral defaults for the rest.
SSLCOMMERZ_CUSTOMER_EMAIL = env_str("SSLCOMMERZ_CUSTOMER_EMAIL", "customer@example.com")
SSLCOMMERZ_CUSTOMER_ADDRESS = env_str("SSLCOMMERZ_CUSTOMER_ADDRESS", "Dhaka")
SSLCOMMERZ_CUSTOMER_CITY = env_str("SSLCOMMERZ_CUSTOMER_CITY", "Dhaka")
SSLCOMMERZ_CUSTOMER_COUNTRY = env_str("SSLCOMMERZ_CUSTOMER_COUNTRY", "Bangladesh")

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
