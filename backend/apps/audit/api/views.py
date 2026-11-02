"""Read-only admin API for the audit log (``GET /api/v1/admin/audit-logs/``).

There is deliberately no create/update/delete endpoint: entries are only written by
services, in the same transaction as the change they describe.
"""

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, serializers

from apps.core.admin_api import AdminAPIMixin, query_int

from ..models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    # The actor's name for the Admin Panel (null for system jobs). ``actor`` stays the id.
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = (
            "id",
            "created_at",
            "actor",
            "actor_name",
            "action",
            "entity_type",
            "entity_id",
            "summary",
            "metadata",
            "ip_address",
        )
        read_only_fields = fields

    def get_actor_name(self, obj) -> str | None:
        return obj.actor.full_name if obj.actor_id else None


@extend_schema(
    parameters=[
        OpenApiParameter("action", OpenApiTypes.STR),
        OpenApiParameter("entity_type", OpenApiTypes.STR),
        OpenApiParameter("entity_id", OpenApiTypes.STR),
        OpenApiParameter("actor", OpenApiTypes.INT),
    ]
)
class AuditLogListView(AdminAPIMixin, generics.ListAPIView):
    serializer_class = AuditLogSerializer
    http_method_names = ["get", "head", "options"]

    def get_queryset(self):
        queryset = AuditLog.objects.select_related("actor")  # actor_name without N+1
        params = self.request.query_params
        for name in ("action", "entity_type", "entity_id"):
            value = params.get(name, "").strip()
            if value:
                queryset = queryset.filter(**{name: value})
        actor = query_int(self.request, "actor")
        if actor is not None:
            queryset = queryset.filter(actor_id=actor)
        return queryset.order_by("-created_at", "-id")
