"""Settings for the automated test suite (pytest).

Tests must not need running PostgreSQL or Redis services in Milestone 1:
- cache uses local memory instead of Redis
- Celery runs tasks inline
- no test touches the database yet (no models / migrations exist)
"""

from .base import *  # noqa: F403

DEBUG = False
SECRET_KEY = "test-only-insecure-key"  # noqa: S105
API_DOCS_ENABLED = True

CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
CELERY_TASK_ALWAYS_EAGER = True
CELERY_BROKER_URL = "memory://"
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]  # fast, tests only
