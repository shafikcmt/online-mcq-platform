"""Fixed-window counters and cooldown claims in the cache (Redis in dev/production).

Redis gives fast, atomic, concurrency-safe guards; the OTP table in PostgreSQL stays
the authoritative record and is re-checked by the services.

Fail closed: if the cache backend is unreachable these helpers raise
``RateLimiterUnavailable`` — callers must refuse the request, never skip the limit.
"""

import logging
from dataclasses import dataclass

from django.core.cache import cache

logger = logging.getLogger(__name__)


class RateLimiterUnavailable(Exception):
    """The cache backend (Redis) could not be used."""


@dataclass(frozen=True)
class LimitResult:
    allowed: bool
    retry_after: int  # seconds until the current window ends


def hit(scope: str, identifier: str, *, limit: int, window: int, now: float) -> LimitResult:
    """Atomically count one request and report whether it is within ``limit`` per ``window``."""
    bucket = int(now // window)
    key = f"ratelimit:{scope}:{identifier}:{bucket}"
    retry_after = max(1, window - int(now % window))
    try:
        cache.add(key, 0, timeout=window + 1)
        try:
            count = cache.incr(key)
        except ValueError:  # key expired between add() and incr()
            cache.add(key, 1, timeout=window + 1)
            count = 1
    except Exception as exc:  # noqa: BLE001 — any backend failure must fail closed
        logger.error("Rate limiter unavailable scope=%s error=%s", scope, exc.__class__.__name__)
        raise RateLimiterUnavailable from exc
    return LimitResult(allowed=count <= limit, retry_after=retry_after)


def acquire_cooldown(scope: str, identifier: str, *, seconds: int) -> bool:
    """Atomically claim a cooldown slot; False if one is already active."""
    try:
        return cache.add(f"cooldown:{scope}:{identifier}", 1, timeout=seconds)
    except Exception as exc:  # noqa: BLE001 — any backend failure must fail closed
        logger.error("Rate limiter unavailable scope=%s error=%s", scope, exc.__class__.__name__)
        raise RateLimiterUnavailable from exc
