"""Study materials API.

Admin (``/api/v1/admin/materials/``; admin session + CSRF + admin role; every write audited):
- ``GET/POST materials/`` — list (filters) / create; ``materials/{id}/`` get, update, delete
- ``POST/DELETE materials/{id}/pdf/`` — attach, replace or remove the file of a PDF material

Public (``/api/v1/public/materials/``; no login; published only):
- ``GET materials/`` — filters ``category``, ``subject``, ``exam`` (slugs), ``kind``,
  ``teacher``, ``search``
- ``GET materials/{id}/pdf/`` — the file (served by the API, never from a media path)
"""

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Q
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import generics, serializers, status
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.services import AuditContext
from apps.core import documents
from apps.core.admin_api import (
    AdminAPIMixin,
    query_bool,
    query_choice,
    query_ordering,
    query_search,
    to_drf_validation_error,
)
from apps.core.exceptions import ApiError
from apps.core.public_api import PublicAPIMixin
from apps.core.throttling import DocumentUploadThrottle

from .. import selectors, services
from ..models import MaterialKind, StudyMaterial
from .serializers import MaterialAdminSerializer, PublicMaterialSerializer

ORDERING = ("id", "sort_order", "published_at", "created_at", "updated_at")


def _write(request, func, *args, **kwargs):
    try:
        return func(*args, ctx=AuditContext.from_request(request), **kwargs)
    except DjangoValidationError as exc:
        raise to_drf_validation_error(exc) from exc


def _param(request, name: str) -> str:
    return (request.query_params.get(name) or "").strip()[:100]


@extend_schema_view(
    get=extend_schema(
        parameters=[
            OpenApiParameter("kind", OpenApiTypes.STR, enum=MaterialKind.values),
            OpenApiParameter("category", OpenApiTypes.INT, description="Category id."),
            OpenApiParameter("subject", OpenApiTypes.INT, description="Subject id."),
            OpenApiParameter("exam", OpenApiTypes.INT, description="Exam id."),
            OpenApiParameter("published", OpenApiTypes.BOOL, description="false = drafts"),
            OpenApiParameter("search", OpenApiTypes.STR, description="Title or teacher."),
            OpenApiParameter(
                "ordering",
                OpenApiTypes.STR,
                description="Comma-separated; '-' = descending. Fields: " + ", ".join(ORDERING),
            ),
        ]
    )
)
class MaterialListCreateView(AdminAPIMixin, generics.ListCreateAPIView):
    serializer_class = MaterialAdminSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = StudyMaterial.objects.select_related("category", "subject", "exam")
        kind = query_choice(self.request, "kind", MaterialKind.values)
        if kind:
            queryset = queryset.filter(kind=kind)
        for name in ("category", "subject", "exam"):
            value = _param(self.request, name)
            if value.isdigit() and int(value) < 2_147_483_648:
                queryset = queryset.filter(**{f"{name}_id": int(value)})
        published = query_bool(self.request, "published")
        if published is not None:
            queryset = queryset.filter(published_at__isnull=not published)
        search = query_search(self.request)
        if search:
            queryset = queryset.filter(
                Q(title_bn__icontains=search)
                | Q(title_en__icontains=search)
                | Q(teacher__icontains=search)
            )
        return queryset.order_by(
            *query_ordering(self.request, ORDERING, ("sort_order", "-created_at"))
        )

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        item = _write(request, services.create_material, StudyMaterial(**serializer.validated_data))
        return Response(self.get_serializer(item).data, status=status.HTTP_201_CREATED)


class MaterialDetailView(AdminAPIMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = MaterialAdminSerializer
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return StudyMaterial.objects.select_related("category", "subject", "exam")

    def update(self, request, *args, **kwargs):
        item = self.get_object()
        serializer = self.get_serializer(item, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        updated = _write(request, services.update_material, item.pk, serializer.validated_data)
        return Response(self.get_serializer(updated).data)

    def destroy(self, request, *args, **kwargs):
        item = self.get_object()
        _write(request, services.delete_material, item.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MaterialPdfUploadSerializer(serializers.Serializer):
    file = serializers.FileField()


class MaterialPdfAdminView(AdminAPIMixin, APIView):
    """``POST`` (multipart ``file``) attaches or replaces the PDF; ``DELETE`` removes it."""

    parser_classes = [MultiPartParser]
    throttle_classes = [DocumentUploadThrottle]
    http_method_names = ["post", "delete", "options"]

    @extend_schema(
        operation_id="admin_materials_pdf_set",
        request=MaterialPdfUploadSerializer,
        responses=MaterialAdminSerializer,
    )
    def post(self, request, pk):
        if int(request.META.get("CONTENT_LENGTH") or 0) > settings.DOCUMENT_MAX_BYTES + 64 * 1024:
            raise ApiError(status_code=400, code="file_too_large", message="The file is too large.")
        data = MaterialPdfUploadSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            item = services.set_material_pdf(
                pk, data.validated_data["file"], ctx=AuditContext.from_request(request)
            )
        except documents.DocumentError as exc:
            raise ApiError(status_code=400, code=exc.code, message=exc.message) from exc
        return Response(MaterialAdminSerializer(item).data)

    @extend_schema(operation_id="admin_materials_pdf_remove", responses=MaterialAdminSerializer)
    def delete(self, request, pk):
        item = services.remove_material_pdf(pk, ctx=AuditContext.from_request(request))
        return Response(MaterialAdminSerializer(item).data)


# --------------------------------------------------------------------------------------
# Public
# --------------------------------------------------------------------------------------
@extend_schema_view(
    get=extend_schema(
        operation_id="public_materials_list",
        parameters=[
            OpenApiParameter("kind", OpenApiTypes.STR, enum=MaterialKind.values),
            OpenApiParameter("category", OpenApiTypes.STR, description="Category slug."),
            OpenApiParameter("subject", OpenApiTypes.STR, description="Subject slug."),
            OpenApiParameter("exam", OpenApiTypes.STR, description="Exam slug."),
            OpenApiParameter("teacher", OpenApiTypes.STR, description="Exact teacher name."),
            OpenApiParameter("search", OpenApiTypes.STR, description="Title or teacher."),
        ],
    )
)
class PublicMaterialListView(PublicAPIMixin, generics.ListAPIView):
    serializer_class = PublicMaterialSerializer

    def get_queryset(self):
        queryset = selectors.public_materials()
        kind = query_choice(self.request, "kind", MaterialKind.values)
        if kind:
            queryset = queryset.filter(kind=kind)
        for name in ("category", "subject", "exam"):
            value = _param(self.request, name)
            if value:
                queryset = queryset.filter(**{f"{name}__slug": value})
        teacher = _param(self.request, "teacher")
        if teacher:
            queryset = queryset.filter(teacher=teacher)
        search = query_search(self.request)
        if search:
            queryset = queryset.filter(
                Q(title_bn__icontains=search)
                | Q(title_en__icontains=search)
                | Q(teacher__icontains=search)
            )
        return queryset.order_by("sort_order", "-published_at", "-id")


class PublicMaterialPdfView(PublicAPIMixin, APIView):
    """The file of a published PDF material; anything else is a plain 404."""

    @extend_schema(
        operation_id="public_material_pdf",
        responses={(200, "application/pdf"): OpenApiTypes.BINARY},
    )
    def get(self, request, pk):
        item = selectors.public_materials().filter(pk=pk).first()
        if item is None or not item.pdf:
            raise ApiError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="not_found",
                message="No PDF is available.",
            )
        return documents.pdf_response(request, item.pdf, item.pdf_sha256, "material.pdf")
