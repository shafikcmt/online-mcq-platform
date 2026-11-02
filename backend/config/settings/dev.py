"""Local development settings (used by Docker Compose and manage.py by default)."""

from .base import *  # noqa: F403
from .env import env_bool, env_str

DEBUG = env_bool("DJANGO_DEBUG", True)
# A throwaway key is acceptable ONLY for local development.
SECRET_KEY = env_str("DJANGO_SECRET_KEY", "") or "dev-only-insecure-key-do-not-use-in-production"  # noqa: S105
API_DOCS_ENABLED = env_bool("API_DOCS_ENABLED", True)

JWT_SIGNING_KEY = (
    env_str("JWT_SIGNING_KEY", "") or "dev-only-insecure-jwt-key-do-not-use-in-production"
)  # noqa: S105
SIMPLE_JWT = {**SIMPLE_JWT, "SIGNING_KEY": JWT_SIGNING_KEY}  # noqa: F405

# Readable error pages and the DRF browsable API are not enabled on purpose:
# clients consume JSON only, and dev should behave like production.
