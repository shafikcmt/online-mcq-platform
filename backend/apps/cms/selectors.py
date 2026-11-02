"""Read side of the CMS: current site settings and what is publicly visible.

Other modules read site settings only through these functions (docs/MODULES.md rule 2):
- ``results`` — leaderboard name modes (ROADMAP decisions log #12);
- ``core.middleware`` — the platform default language (docs/LOCALIZATION.md §3.2 step 4).
"""

import logging

from django.core.cache import cache
from django.db.models import Q
from django.utils import timezone

from .models import Announcement, Audience, Faq, LanguageChoice, Page, SiteSettings

logger = logging.getLogger(__name__)

DEFAULT_LANGUAGE_CACHE_KEY = "cms:default_language"
DEFAULT_LANGUAGE_CACHE_SECONDS = 300


def current_settings() -> SiteSettings:
    """The saved settings row, or the environment defaults until an admin saves one."""
    return SiteSettings.objects.filter(pk=SiteSettings.SINGLETON_ID).first() or (
        SiteSettings.defaults()
    )


def leaderboard_name_mode(channel: str) -> str:
    """``public`` (website) or ``app``."""
    row = current_settings()
    if channel == "public":
        return row.public_leaderboard_name_mode
    return row.app_leaderboard_name_mode


def platform_default_language(fallback: str) -> str:
    """The admin-chosen default language, cached for ``DEFAULT_LANGUAGE_CACHE_SECONDS``.

    Saving the settings clears this cache entry (on commit). Where the cache is not
    shared — e.g. a per-process local-memory cache, or several deployments with separate
    caches — other application instances may keep the old default until their entry
    expires: the maximum propagation delay is the cache TTL (5 minutes). An accepted
    Milestone 6A limitation (no distributed invalidation). Any cache/database problem
    falls back to ``fallback`` (the environment default) — the request always gets a
    valid language."""
    try:
        value = cache.get(DEFAULT_LANGUAGE_CACHE_KEY)
        if value is None:
            row = SiteSettings.objects.filter(pk=SiteSettings.SINGLETON_ID).only("default_language")
            value = row.values_list("default_language", flat=True).first() or ""
            cache.set(DEFAULT_LANGUAGE_CACHE_KEY, value, DEFAULT_LANGUAGE_CACHE_SECONDS)
    except Exception:  # noqa: BLE001 — never fail a request over the default language
        return fallback
    return value if value in LanguageChoice.values else fallback


def forget_default_language() -> None:
    try:
        cache.delete(DEFAULT_LANGUAGE_CACHE_KEY)
    except Exception:  # noqa: BLE001 — the cached value expires on its own
        logger.warning("Could not clear the cached default language")


def visible_announcements(*audiences: str, now=None):
    """Published (``published_at <= now``), not expired, for one of ``audiences``."""
    now = now or timezone.now()
    return Announcement.objects.filter(
        Q(expires_at__isnull=True) | Q(expires_at__gt=now),
        published_at__isnull=False,
        published_at__lte=now,
        audience__in=audiences,
    ).order_by("-is_pinned", "-published_at", "-id")


def public_announcements(now=None):
    return visible_announcements(Audience.PUBLIC, Audience.ALL, now=now)


def student_announcements(now=None):
    return visible_announcements(Audience.STUDENTS, Audience.ALL, now=now)


def active_faqs():
    return Faq.objects.filter(is_active=True).order_by("sort_order", "id")


def active_pages():
    return Page.objects.filter(is_active=True)
