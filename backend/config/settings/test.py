"""Settings for the automated test suite (pytest).

- PostgreSQL is required (pytest-django creates and migrates a throw-away test database)
- cache uses local memory instead of Redis
- Celery runs tasks inline
"""

from .base import *  # noqa: F403

DEBUG = False
SECRET_KEY = "test-only-insecure-key"  # noqa: S105
API_DOCS_ENABLED = True

CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
JWT_SIGNING_KEY = "test-only-insecure-jwt-signing-key"  # noqa: S105
SIMPLE_JWT = {**SIMPLE_JWT, "SIGNING_KEY": JWT_SIGNING_KEY}  # noqa: F405
CELERY_TASK_ALWAYS_EAGER = True
CELERY_BROKER_URL = "memory://"
# Fast hasher for most tests; tests that check real hashing override this explicitly.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
# Many payment tests re-verify the same payment twice in a row; the cooldown tests set it.
PAYMENT_REVERIFY_COOLDOWN_SECONDS = 0
