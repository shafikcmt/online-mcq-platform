"""Admin API for exams (``/api/v1/admin/exams/…``) and the public exam/category
listing (``/api/v1/public/…``, no login).

Views stay thin: validate input, call ``exams.services`` (one transaction with the
audit entry), serialize. Status only changes through the action endpoints.
"""

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import F, Q
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import generics, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.services import AuditContext
from apps.catalog.models import SLUG_MAX_LENGTH
from apps.core.admin_api import (
    INVALID_CHOICE_MESSAGE,
    AdminAPIMixin,
    query_bool,
    query_choice,
    query_int,
    query_ordering,
    query_search,
    to_drf_validation_error,
)
from apps.core.exceptions import ApiError
from apps.core.public_api import PublicAPIMixin

from .. import services
from ..exceptions import ExamStateError
from ..models import AccessType, ContentLanguage, Exam, ExamQuestion, ExamStatus, ExamType
from ..selectors import with_question_totals
from .serializers import (
    ExamAdminSerializer,
    ExamQuestionAdminSerializer,
    ExamQuestionListSerializer,
    PublicExamSerializer,
)

ORDERING_FIELDS = ("id", "created_at", "updated_at", "start_at")
DEFAULT_ORDERING = ("-created_at",)


def _write(request, func, *args, **kwargs):
    try:
        return func(*args, ctx=AuditContext.from_request(request), **kwargs)
    except DjangoValidationError as exc:
        raise to_drf_validation_error(exc) from exc
    except ExamStateError as exc:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT, code=exc.code, message=str(exc.message)
        ) from exc


def _admin_queryset():
    return with_question_totals(Exam.objects.select_related("category", "subject"))


def _exam_response(request, exam_id, status_code=status.HTTP_200_OK):
    exam = _admin_queryset().get(pk=exam_id)
    return Response(
        ExamAdminSerializer(exam, context={"request": request}).data, status=status_code
    )


# --------------------------------------------------------------------------------------
# Admin
# --------------------------------------------------------------------------------------
@extend_schema_view(
    get=extend_schema(
        parameters=[
            OpenApiParameter("exam_type", OpenApiTypes.STR, enum=ExamType.values),
            OpenApiParameter("status", OpenApiTypes.STR, enum=ExamStatus.values),
            OpenApiParameter("content_language", OpenApiTypes.STR, enum=ContentLanguage.values),
            OpenApiParameter("access_type", OpenApiTypes.STR, enum=AccessType.values),
            OpenApiParameter("category", OpenApiTypes.INT),
            OpenApiParameter("subject", OpenApiTypes.INT),
            OpenApiParameter("is_featured", OpenApiTypes.BOOL),
            OpenApiParameter(
                "upcoming", OpenApiTypes.BOOL, description="true = starts in the future."
            ),
            OpenApiParameter("search", OpenApiTypes.STR, description="Bangla/English title."),
            OpenApiParameter(
                "ordering",
                OpenApiTypes.STR,
                description="Comma-separated; '-' = descending. Fields: "
                + ", ".join(ORDERING_FIELDS),
            ),
        ]
    )
)
class ExamListCreateView(AdminAPIMixin, generics.ListCreateAPIView):
    serializer_class = ExamAdminSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        request = self.request
        queryset = _admin_queryset()
        for name, choices in (
            ("exam_type", ExamType.values),
            ("status", ExamStatus.values),
            ("content_language", ContentLanguage.values),
            ("access_type", AccessType.values),
        ):
            value = query_choice(request, name, choices)
            if value is not None:
                queryset = queryset.filter(**{name: value})
        for name in ("category", "subject"):
            value = query_int(request, name)
            if value is not None:
                queryset = queryset.filter(**{f"{name}_id": value})
        featured = query_bool(request, "is_featured")
        if featured is not None:
            queryset = queryset.filter(is_featured=featured)
        upcoming = query_bool(request, "upcoming")
        if upcoming is not None:
            future = Q(start_at__gt=timezone.now())
            queryset = queryset.filter(future if upcoming else ~future | Q(start_at__isnull=True))
        search = query_search(request)
        if search:
            queryset = queryset.filter(
                Q(title_bn__icontains=search) | Q(title_en__icontains=search)
            )
        return queryset.order_by(*query_ordering(request, ORDERING_FIELDS, DEFAULT_ORDERING))

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        exam = _write(request, services.create_exam, Exam(**data), provided=set(data))
        return _exam_response(request, exam.pk, status.HTTP_201_CREATED)


class ExamDetailView(AdminAPIMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = ExamAdminSerializer
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return _admin_queryset()

    def update(self, request, *args, **kwargs):
        exam = self.get_object()
        serializer = self.get_serializer(exam, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        _write(request, services.update_exam, exam.pk, dict(serializer.validated_data))
        return _exam_response(request, exam.pk)

    def destroy(self, request, *args, **kwargs):
        exam = self.get_object()
        _write(request, services.delete_exam, exam.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ExamQuestionsView(AdminAPIMixin, APIView):
    """``GET`` the exam's question list; ``PATCH`` replaces it with the COMPLETE list
    sent (order and marks overrides), atomically."""

    http_method_names = ["get", "patch", "options"]

    def _items(self, exam_id):
        items = (
            ExamQuestion.objects.filter(exam_id=exam_id)
            .select_related("exam", "question")
            .order_by("sort_order", "id")
        )
        return {"questions": ExamQuestionAdminSerializer(items, many=True).data}

    @extend_schema(responses=ExamQuestionListSerializer)
    def get(self, request, pk):
        generics.get_object_or_404(Exam.objects.all(), pk=pk)
        return Response(self._items(pk))

    @extend_schema(request=ExamQuestionListSerializer, responses=ExamQuestionListSerializer)
    def patch(self, request, pk):
        generics.get_object_or_404(Exam.objects.all(), pk=pk)
        serializer = ExamQuestionListSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _write(request, services.set_exam_questions, pk, serializer.validated_data["questions"])
        return Response(self._items(pk))


class _ExamActionView(AdminAPIMixin, APIView):
    http_method_names = ["post", "options"]
    service = None  # (not ``action``: DRF/drf-spectacular use that name)
    success_status = status.HTTP_200_OK

    @extend_schema(request=None, responses=ExamAdminSerializer)
    def post(self, request, pk):
        generics.get_object_or_404(Exam.objects.all(), pk=pk)
        exam = _write(request, type(self).service, pk)
        return _exam_response(request, exam.pk, self.success_status)


class ExamPublishView(_ExamActionView):
    service = staticmethod(services.publish_exam)


class ExamUnpublishView(_ExamActionView):
    service = staticmethod(services.unpublish_exam)


class ExamArchiveView(_ExamActionView):
    service = staticmethod(services.archive_exam)


class ExamDuplicateView(_ExamActionView):
    service = staticmethod(services.duplicate_exam)
    success_status = status.HTTP_201_CREATED


# --------------------------------------------------------------------------------------
# Public (website & app, no login)
# --------------------------------------------------------------------------------------
def public_exams():
    """Only published exams whose category (and subject, if any) are active."""
    return with_question_totals(
        Exam.objects.filter(status=ExamStatus.PUBLISHED, category__is_active=True)
        .filter(Q(subject__isnull=True) | Q(subject__is_active=True))
        .select_related("category", "subject")
    )


@extend_schema_view(
    get=extend_schema(
        parameters=[
            OpenApiParameter("type", OpenApiTypes.STR, enum=ExamType.values),
            OpenApiParameter("access", OpenApiTypes.STR, enum=AccessType.values),
            OpenApiParameter("category", OpenApiTypes.STR, description="Category slug."),
            OpenApiParameter(
                "upcoming", OpenApiTypes.BOOL, description="true = starts in the future."
            ),
        ]
    )
)
class PublicExamListView(PublicAPIMixin, generics.ListAPIView):
    serializer_class = PublicExamSerializer

    def get_queryset(self):
        request = self.request
        queryset = public_exams()
        exam_type = query_choice(request, "type", ExamType.values)
        if exam_type:
            queryset = queryset.filter(exam_type=exam_type)
        access = query_choice(request, "access", AccessType.values)
        if access:
            queryset = queryset.filter(access_type=access)
        category = request.query_params.get("category", "").strip().lower()
        if len(category) > SLUG_MAX_LENGTH:
            raise serializers.ValidationError({"category": [INVALID_CHOICE_MESSAGE]})
        if category:
            queryset = queryset.filter(category__slug=category)
        if query_bool(request, "upcoming"):
            queryset = queryset.filter(start_at__gt=timezone.now())
        return queryset.order_by(F("start_at").asc(nulls_last=True), "id")


class PublicExamDetailView(PublicAPIMixin, generics.RetrieveAPIView):
    serializer_class = PublicExamSerializer
    lookup_field = "slug"

    def get_queryset(self):
        return public_exams()
