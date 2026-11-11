"""Push notification API.

Student (JWT, own devices only):
- ``POST /me/push-devices/ {token}`` register this phone's Expo push token (idempotent)
- ``DELETE /me/push-devices/ {token}`` remove it (notifications turned off, or signed out)

Admin (``/api/v1/admin/push/…``; admin session + CSRF + admin role; writes audited):
- ``GET push/`` status: switched on?, devices, reminder offsets
- ``GET/POST push/messages/`` history / send a message to every phone (queued; recorded as
  ``disabled`` while push is switched off on the server)
"""

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import generics, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.services import AuditContext
from apps.core.admin_api import (
    AdminAPIMixin,
    query_choice,
    query_ordering,
    to_drf_validation_error,
)
from apps.core.throttling import PushDeviceThrottle, PushSendThrottle
from apps.exams.models import Exam

from .. import push_services
from ..models import (
    PUSH_BODY_MAX_LENGTH,
    PUSH_TITLE_MAX_LENGTH,
    PushKind,
    PushMessage,
    PushStatus,
)


class DeviceSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=200)


class DeviceAnswerSerializer(serializers.Serializer):
    registered = serializers.BooleanField()


class PushDeviceView(APIView):
    http_method_names = ["post", "delete", "options"]
    throttle_classes = [PushDeviceThrottle]

    @extend_schema(
        operation_id="me_push_device_register",
        request=DeviceSerializer,
        responses=DeviceAnswerSerializer,
        tags=["notifications"],
    )
    def post(self, request):
        data = DeviceSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            push_services.register_device(request.user, data.validated_data["token"])
        except DjangoValidationError as exc:
            raise to_drf_validation_error(exc) from exc
        return Response({"registered": True})

    @extend_schema(
        operation_id="me_push_device_remove",
        request=DeviceSerializer,
        responses=DeviceAnswerSerializer,
        tags=["notifications"],
    )
    def delete(self, request):
        data = DeviceSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        push_services.unregister_device(request.user, data.validated_data["token"])
        return Response({"registered": False})


# --------------------------------------------------------------------------------------
# Admin
# --------------------------------------------------------------------------------------
class PushStatusSerializer(serializers.Serializer):
    enabled = serializers.BooleanField(help_text="False: messages are recorded but not sent.")
    devices = serializers.IntegerField(help_text="Active phones that will receive a message.")
    reminder_offsets = serializers.ListField(child=serializers.IntegerField())


class PushStatusView(AdminAPIMixin, APIView):
    http_method_names = ["get", "options"]

    @extend_schema(operation_id="admin_push_status", responses=PushStatusSerializer)
    def get(self, request):
        return Response(
            {
                "enabled": settings.PUSH_ENABLED,
                "devices": push_services.active_devices().count(),
                "reminder_offsets": sorted(set(settings.EXAM_REMINDER_OFFSETS_MINUTES)),
            }
        )


class PushMessageSerializer(serializers.ModelSerializer):
    title_bn = serializers.CharField(
        max_length=PUSH_TITLE_MAX_LENGTH, required=False, allow_blank=True, trim_whitespace=False
    )
    title_en = serializers.CharField(
        max_length=PUSH_TITLE_MAX_LENGTH, required=False, allow_blank=True, trim_whitespace=False
    )
    body_bn = serializers.CharField(
        max_length=PUSH_BODY_MAX_LENGTH, required=False, allow_blank=True, trim_whitespace=False
    )
    body_en = serializers.CharField(
        max_length=PUSH_BODY_MAX_LENGTH, required=False, allow_blank=True, trim_whitespace=False
    )
    exam = serializers.PrimaryKeyRelatedField(
        queryset=Exam.objects.all(), required=False, allow_null=True
    )
    exam_label = serializers.SerializerMethodField()

    class Meta:
        model = PushMessage
        fields = (
            "id",
            "kind",
            "title_bn",
            "title_en",
            "body_bn",
            "body_en",
            "exam",
            "exam_label",
            "reminder_offset",
            "status",
            "device_count",
            "sent_count",
            "failed_count",
            "created_at",
            "sent_at",
        )
        read_only_fields = (
            "id",
            "kind",
            "reminder_offset",
            "status",
            "device_count",
            "sent_count",
            "failed_count",
            "created_at",
            "sent_at",
        )

    def get_exam_label(self, obj) -> str:
        return str(obj.exam) if obj.exam_id else ""


ORDERING = ("id", "created_at", "sent_at")


@extend_schema_view(
    get=extend_schema(
        operation_id="admin_push_messages_list",
        parameters=[
            OpenApiParameter("kind", OpenApiTypes.STR, enum=PushKind.values),
            OpenApiParameter("status", OpenApiTypes.STR, enum=PushStatus.values),
            OpenApiParameter(
                "ordering", OpenApiTypes.STR, description="Fields: " + ", ".join(ORDERING)
            ),
        ],
    ),
    post=extend_schema(operation_id="admin_push_messages_create"),
)
class PushMessageListCreateView(AdminAPIMixin, generics.ListCreateAPIView):
    serializer_class = PushMessageSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_throttles(self):
        return [PushSendThrottle()] if self.request.method == "POST" else super().get_throttles()

    def get_queryset(self):
        queryset = PushMessage.objects.select_related("exam")
        kind = query_choice(self.request, "kind", PushKind.values)
        if kind:
            queryset = queryset.filter(kind=kind)
        state = query_choice(self.request, "status", PushStatus.values)
        if state:
            queryset = queryset.filter(status=state)
        return queryset.order_by(*query_ordering(self.request, ORDERING, ("-created_at", "-id")))

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            message = push_services.create_manual_message(
                PushMessage(**serializer.validated_data), ctx=AuditContext.from_request(request)
            )
        except DjangoValidationError as exc:
            raise to_drf_validation_error(exc) from exc
        return Response(self.get_serializer(message).data, status=status.HTTP_201_CREATED)
