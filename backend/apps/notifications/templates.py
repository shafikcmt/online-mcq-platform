"""Bilingual notification templates and the per-type ``params`` allow-list.

Rendering happens at read time in the active language (``translation.override``). Names
stored in ``params`` are bilingual snapshots (``*_bn`` / ``*_en``) chosen with the same
fallback rule as all other content (``core.i18n.resolve_bilingual``). Output is plain text —
clients render it escaped. ``target`` is navigation metadata (ids only, never a URL).
"""

from django.utils import translation
from django.utils.translation import gettext_lazy as _

from apps.core.i18n import resolve_bilingual

from .models import NotificationType

# Exactly these keys may be stored per type (anything else is a programming error).
PARAM_KEYS = {
    NotificationType.PAYMENT_SUCCESS: frozenset(
        {"payment_id", "package_slug", "package_name_bn", "package_name_en", "verified_at"}
    ),
    NotificationType.RESULT_PUBLISHED: frozenset(
        {"attempt_id", "exam_slug", "exam_title_bn", "exam_title_en"}
    ),
}

TEMPLATES = {
    NotificationType.PAYMENT_SUCCESS: (
        _("Payment successful"),
        _("Your payment for “%(name)s” was successful. Your subscription is now active."),
    ),
    NotificationType.RESULT_PUBLISHED: (
        _("Result published"),
        _("Your result for “%(name)s” is now available."),
    ),
}

# (bilingual name field in params, fallback key, navigation target builder)
_NAME = {
    NotificationType.PAYMENT_SUCCESS: ("package_name", "package_slug"),
    NotificationType.RESULT_PUBLISHED: ("exam_title", "exam_slug"),
}


def _target(notification_type: str, params: dict) -> dict | None:
    if notification_type == NotificationType.PAYMENT_SUCCESS and params.get("payment_id"):
        return {"type": "payment", "payment_id": params["payment_id"]}
    if notification_type == NotificationType.RESULT_PUBLISHED and params.get("attempt_id"):
        return {"type": "result", "attempt_id": params["attempt_id"]}
    return None


def render(notification, language: str) -> dict:
    """``{title, message, target}`` in ``language`` (fallback to the other language for
    names; gettext for the sentences)."""
    params = notification.params or {}
    name_field, fallback_key = _NAME[notification.type]
    name = resolve_bilingual(params, name_field, language)[0] or params.get(fallback_key, "")
    title, message = TEMPLATES[notification.type]
    with translation.override(language):
        return {
            "title": str(title),
            "message": str(message) % {"name": name},
            "target": _target(notification.type, params),
        }
