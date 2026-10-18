"""Notification serializers: rendered in the request language at read time. Read-only —
no field of a notification can be written through the API."""

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from ..models import NotificationType
from ..templates import render


class NotificationTargetSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=["payment", "result"])
    payment_id = serializers.UUIDField(required=False)
    attempt_id = serializers.UUIDField(required=False)


class NotificationSerializer(serializers.Serializer):
    id = serializers.UUIDField(source="public_id")
    type = serializers.ChoiceField(choices=NotificationType.choices)
    title = serializers.SerializerMethodField()
    message = serializers.SerializerMethodField()
    target = serializers.SerializerMethodField()
    is_read = serializers.BooleanField()
    created_at = serializers.DateTimeField()
    read_at = serializers.DateTimeField(allow_null=True)

    def _rendered(self, obj) -> dict:
        cache = self.context.setdefault("_rendered", {})
        if obj.pk not in cache:
            request = self.context.get("request")
            language = getattr(request, "LANGUAGE_CODE", "") or "bn"
            cache[obj.pk] = render(obj, language)
        return cache[obj.pk]

    def get_title(self, obj) -> str:
        return self._rendered(obj)["title"]

    def get_message(self, obj) -> str:
        return self._rendered(obj)["message"]

    @extend_schema_field(NotificationTargetSerializer(allow_null=True))
    def get_target(self, obj):
        return self._rendered(obj)["target"]


class ReadAllResultSerializer(serializers.Serializer):
    updated = serializers.IntegerField()
