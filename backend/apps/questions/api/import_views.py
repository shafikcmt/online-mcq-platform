"""Admin API for the bulk question import (``/api/v1/admin/questions/import/…``).

``POST`` (multipart: ``file``, optional ``subject``, ``mode`` = ``preview`` | ``import``,
``on_error`` = ``skip`` | ``abort``) checks the file and, in ``import`` mode, creates the valid
rows. ``GET template/?file_format=csv|xlsx`` returns a sample file to fill in.
"""

from django.conf import settings
from django.http import HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, status
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.services import AuditContext
from apps.core.admin_api import AdminAPIMixin
from apps.core.exceptions import ApiError
from apps.core.throttling import SecurityThrottle

from .. import importer

# Multipart framing overhead allowed on top of the file size limit.
UPLOAD_OVERHEAD_BYTES = 64 * 1024


class QuestionImportThrottle(SecurityThrottle):
    """``question_import``: per admin; a check or an import reads a whole file."""

    scope = "question_import"

    def identity(self, request, view) -> str:
        return f"user:{request.user.pk}"


class ImportRequestSerializer(serializers.Serializer):
    file = serializers.FileField()
    subject = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    mode = serializers.ChoiceField(choices=["preview", "import"], default="preview")
    on_error = serializers.ChoiceField(choices=["skip", "abort"], default="skip")


def _file_error(exc: importer.ImportFileError) -> ApiError:
    return ApiError(status_code=status.HTTP_400_BAD_REQUEST, code=exc.code, message=exc.message)


class QuestionImportView(AdminAPIMixin, APIView):
    parser_classes = [MultiPartParser]
    throttle_classes = [QuestionImportThrottle]
    http_method_names = ["post", "options"]

    @extend_schema(
        operation_id="admin_questions_import",
        tags=["questions"],
        request=ImportRequestSerializer,
        responses=dict,
    )
    def post(self, request):
        limit = settings.QUESTION_IMPORT_MAX_BYTES + UPLOAD_OVERHEAD_BYTES
        if int(request.META.get("CONTENT_LENGTH") or 0) > limit:
            raise _file_error(
                importer.ImportFileError(
                    "file_too_large",
                    "The file is too large "
                    f"(maximum {settings.QUESTION_IMPORT_MAX_BYTES // (1024 * 1024)} MB).",
                )
            )
        data = ImportRequestSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        upload = data.validated_data["file"]
        subject = data.validated_data.get("subject")
        try:
            if data.validated_data["mode"] == "preview":
                return Response(importer.preview(upload, subject))
            result = importer.commit(
                upload,
                subject,
                ctx=AuditContext.from_request(request),
                on_error=data.validated_data["on_error"],
            )
        except importer.ImportFileError as exc:
            raise _file_error(exc) from exc
        return Response(result)


class QuestionImportTemplateView(AdminAPIMixin, APIView):
    http_method_names = ["get", "options"]

    @extend_schema(
        operation_id="admin_questions_import_template",
        tags=["questions"],
        parameters=[OpenApiParameter("file_format", OpenApiTypes.STR, enum=["csv", "xlsx"])],
        responses={(200, "application/octet-stream"): OpenApiTypes.BINARY},
    )
    def get(self, request):
        # Not "format": DRF reserves ?format= for choosing a response renderer.
        kind = request.query_params.get("file_format", "csv")
        if kind == "xlsx":
            body, content_type = (
                importer.template_xlsx(),
                ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            )
        elif kind == "csv":
            body, content_type = importer.template_csv(), "text/csv; charset=utf-8"
        else:
            raise serializers.ValidationError({"format": ["Use csv or xlsx."]})
        response = HttpResponse(body, content_type=content_type)
        response["Content-Disposition"] = f'attachment; filename="question-template.{kind}"'
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "no-store"
        return response
