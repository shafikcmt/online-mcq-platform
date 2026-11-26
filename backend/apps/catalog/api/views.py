"""Admin API for categories and subjects (``/api/v1/admin/categories|subjects/``).

Views stay thin: parse/validate input, call ``catalog.services`` (which writes the
change and its audit entry in one transaction), serialize the result.
"""

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Count, Q
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import generics, status
from rest_framework.response import Response

from apps.audit.services import AuditContext
from apps.core.admin_api import (
    AdminAPIMixin,
    query_bool,
    query_int,
    query_ordering,
    query_search,
    to_drf_validation_error,
)
from apps.core.exceptions import ApiError

from .. import services
from ..exceptions import CatalogInUse
from ..models import Category, ExamGroup, Subject
from .serializers import CategoryAdminSerializer, GroupAdminSerializer, SubjectAdminSerializer

ORDERING_FIELDS = ("id", "sort_order", "name_bn", "name_en", "created_at", "updated_at")
DEFAULT_ORDERING = ("sort_order",)

COMMON_LIST_PARAMETERS = [
    OpenApiParameter("is_active", OpenApiTypes.BOOL, description="Filter by active flag."),
    OpenApiParameter("search", OpenApiTypes.STR, description="Bangla/English name or slug."),
    OpenApiParameter(
        "ordering",
        OpenApiTypes.STR,
        description="Comma-separated; prefix with '-' for descending. Fields: "
        + ", ".join(ORDERING_FIELDS),
    ),
]


def _in_use(exc: CatalogInUse) -> ApiError:
    return ApiError(
        status_code=status.HTTP_409_CONFLICT,
        code="in_use",
        message=str(exc.message),
        details=exc.details,
    )


def _filter_common(request, queryset):
    is_active = query_bool(request, "is_active")
    if is_active is not None:
        queryset = queryset.filter(is_active=is_active)
    search = query_search(request)
    if search:
        queryset = queryset.filter(
            Q(name_bn__icontains=search) | Q(name_en__icontains=search) | Q(slug__icontains=search)
        )
    return queryset.order_by(*query_ordering(request, ORDERING_FIELDS, DEFAULT_ORDERING))


class CatalogDetailMixin:
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def perform_write(self, func, *args, **kwargs):
        try:
            return func(*args, ctx=AuditContext.from_request(self.request), **kwargs)
        except DjangoValidationError as exc:
            raise to_drf_validation_error(exc) from exc
        except CatalogInUse as exc:
            raise _in_use(exc) from exc


# ---------------------------------------------------------------------- categories
@extend_schema_view(get=extend_schema(parameters=COMMON_LIST_PARAMETERS))
class CategoryListCreateView(AdminAPIMixin, CatalogDetailMixin, generics.ListCreateAPIView):
    serializer_class = CategoryAdminSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = Category.objects.annotate(subject_count=Count("subjects"))
        return _filter_common(self.request, queryset)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        category = self.perform_write(
            services.create_category, Category(**serializer.validated_data)
        )
        return Response(self.get_serializer(category).data, status=status.HTTP_201_CREATED)


class CategoryDetailView(AdminAPIMixin, CatalogDetailMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = CategoryAdminSerializer

    def get_queryset(self):
        return Category.objects.annotate(subject_count=Count("subjects"))

    def update(self, request, *args, **kwargs):
        category = self.get_object()
        serializer = self.get_serializer(category, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_write(services.update_category, category.pk, serializer.validated_data)
        return Response(self.get_serializer(self.get_object()).data)

    def destroy(self, request, *args, **kwargs):
        category = self.get_object()
        self.perform_write(services.delete_category, category.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------- subjects
@extend_schema_view(
    get=extend_schema(
        parameters=[
            OpenApiParameter("category", OpenApiTypes.INT, description="Category ID."),
            *COMMON_LIST_PARAMETERS,
        ]
    )
)
class SubjectListCreateView(AdminAPIMixin, CatalogDetailMixin, generics.ListCreateAPIView):
    serializer_class = SubjectAdminSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = Subject.objects.all()
        category = query_int(self.request, "category")
        if category is not None:
            queryset = queryset.filter(category_id=category)
        return _filter_common(self.request, queryset)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        subject = self.perform_write(services.create_subject, Subject(**serializer.validated_data))
        return Response(self.get_serializer(subject).data, status=status.HTTP_201_CREATED)


class SubjectDetailView(AdminAPIMixin, CatalogDetailMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = SubjectAdminSerializer
    queryset = Subject.objects.all()

    def update(self, request, *args, **kwargs):
        subject = self.get_object()
        serializer = self.get_serializer(subject, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        updated = self.perform_write(services.update_subject, subject.pk, serializer.validated_data)
        return Response(self.get_serializer(updated).data)

    def destroy(self, request, *args, **kwargs):
        subject = self.get_object()
        self.perform_write(services.delete_subject, subject.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------- exam groups
def _group_queryset():
    return ExamGroup.objects.annotate(
        exam_total=Count("exams", distinct=True), child_total=Count("children", distinct=True)
    )


@extend_schema_view(
    get=extend_schema(
        parameters=[
            OpenApiParameter("category", OpenApiTypes.INT, description="Category ID."),
            OpenApiParameter("parent", OpenApiTypes.INT, description="Parent group ID."),
            OpenApiParameter(
                "top_level", OpenApiTypes.BOOL, description="true = top-level groups only."
            ),
            *COMMON_LIST_PARAMETERS,
        ]
    )
)
class GroupListCreateView(AdminAPIMixin, CatalogDetailMixin, generics.ListCreateAPIView):
    serializer_class = GroupAdminSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = _group_queryset()
        category = query_int(self.request, "category")
        if category is not None:
            queryset = queryset.filter(category_id=category)
        parent = query_int(self.request, "parent")
        if parent is not None:
            queryset = queryset.filter(parent_id=parent)
        elif query_bool(self.request, "top_level"):
            queryset = queryset.filter(parent__isnull=True)
        return _filter_common(self.request, queryset)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        group = self.perform_write(services.create_group, ExamGroup(**serializer.validated_data))
        return Response(
            self.get_serializer(_group_queryset().get(pk=group.pk)).data,
            status=status.HTTP_201_CREATED,
        )


class GroupDetailView(AdminAPIMixin, CatalogDetailMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = GroupAdminSerializer

    def get_queryset(self):
        return _group_queryset()

    def update(self, request, *args, **kwargs):
        group = self.get_object()
        serializer = self.get_serializer(group, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_write(services.update_group, group.pk, serializer.validated_data)
        return Response(self.get_serializer(self.get_object()).data)

    def destroy(self, request, *args, **kwargs):
        group = self.get_object()
        self.perform_write(services.delete_group, group.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)
