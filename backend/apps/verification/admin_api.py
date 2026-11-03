"""Admin SMS gateway API (``/api/v1/admin/sms/…``): admin session + CSRF + admin role.

- ``GET  gateway/``  current settings (never the API key; only a 4-character hint)
- ``PATCH gateway/`` save settings; ``api_key`` writes a new key, ``clear_api_key`` removes it
- ``GET  presets/``  ready-made templates (e.g. BulkSMSBD) the page fills in
- ``POST test/``     send one test SMS to a Bangladeshi number (rate-limited)
"""

from django.core.exceptions import ValidationError as DjangoValidationError
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.services import AuditContext
from apps.core.admin_api import AdminAPIMixin, to_drf_validation_error
from apps.core.phone import normalize_bd_mobile

from . import sms_admin


class GatewayAdminView(AdminAPIMixin, APIView):
    http_method_names = ["get", "patch", "options"]

    @extend_schema(responses=dict)
    def get(self, request):
        return Response(sms_admin.gateway_view())

    @extend_schema(request=dict, responses=dict)
    def patch(self, request):
        body = dict(request.data)
        api_key = body.pop("api_key", None)
        clear = bool(body.pop("clear_api_key", False))
        if api_key is not None and not isinstance(api_key, str):
            raise serializers.ValidationError({"api_key": "Must be text."})
        if api_key == "":
            api_key = None  # empty = keep the stored key
        try:
            view = sms_admin.update_gateway(
                body,
                api_key=api_key,
                clear_api_key=clear,
                ctx=AuditContext.from_request(request),
            )
        except DjangoValidationError as exc:
            raise to_drf_validation_error(exc) from exc
        return Response(view)


class PresetsAdminView(AdminAPIMixin, APIView):
    http_method_names = ["get", "options"]

    @extend_schema(responses=dict)
    def get(self, request):
        return Response(sms_admin.PRESETS)


class TestSmsSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=32)


class TestSmsAdminView(AdminAPIMixin, APIView):
    http_method_names = ["post", "options"]

    @extend_schema(request=TestSmsSerializer, responses=dict)
    def post(self, request):
        serializer = TestSmsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            phone = normalize_bd_mobile(serializer.validated_data["phone"])
        except DjangoValidationError as exc:
            raise to_drf_validation_error(exc) from exc
        result = sms_admin.send_test(
            phone,
            admin_id=request.user.pk,
            ctx=AuditContext.from_request(request),
        )
        return Response(
            result,
            status=status.HTTP_200_OK if result["ok"] else status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
