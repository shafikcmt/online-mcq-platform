"""Small helpers for reading configuration from environment variables.

Secrets and environment-specific values always come from the environment
(`.env` locally, real environment variables in production) — never from code.
"""

import os

from django.core.exceptions import ImproperlyConfigured

_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"0", "false", "no", "off", ""}


def env_str(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None:
        raise ImproperlyConfigured(f"Environment variable {name} is required.")
    return value


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    value = raw.strip().lower()
    if value in _TRUE:
        return True
    if value in _FALSE:
        return False
    raise ImproperlyConfigured(f"Environment variable {name} must be true/false, got {raw!r}.")


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ImproperlyConfigured(f"Environment variable {name} must be an integer.") from exc


def env_list(name: str, default: str = "") -> list[str]:
    """Comma-separated list, e.g. ``localhost,127.0.0.1``."""
    raw = os.environ.get(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]
