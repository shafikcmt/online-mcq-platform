"""Building blocks for public API views (``/api/v1/public/…``): no login, explicit
field lists, text resolved to the request language (docs/LOCALIZATION.md §3.3)."""

from rest_framework import serializers
from rest_framework.permissions import AllowAny

from .i18n import resolve_bilingual


class PublicAPIMixin:
    """No authentication at all: public views never see a user or a token."""

    authentication_classes: list = []
    permission_classes = [AllowAny]


class LocalizedSerializer(serializers.Serializer):
    """Read-only serializer whose ``text(obj, field)`` returns ``<field>_<lang>`` for the
    request language, falling back to the other language when empty."""

    def text(self, obj, field: str) -> str:
        request = self.context.get("request")
        language = getattr(request, "LANGUAGE_CODE", "") if request is not None else ""
        return resolve_bilingual(obj, field, language)[0]
