"""Admin API for the question bank (``/api/v1/admin/questions/…``).

Views stay thin: parse/validate input, call ``questions.services`` (which writes the
question, its complete option set and the audit entry in one transaction), serialize.
"""

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Q
from django.utils.translation import gettext_lazy as _
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import generics, serializers, status
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.services import AuditContext
from apps.core.admin_api import (
    AdminAPIMixin,
    query_bool,
    query_choice,
    query_int,
    query_ordering,
    query_search,
    to_drf_validation_error,
)
from apps.core.exceptions import ApiError

from .. import services
from ..exceptions import QuestionInUse, QuestionLocked
from ..models import AvailableLanguages, Difficulty, Question
from .serializers import QuestionAdminSerializer

ORDERING_FIELDS = ("id", "created_at", "updated_at", "difficulty")
DEFAULT_ORDERING = ("-created_at",)
LANGUAGE_FILTER = {
    "bn": (AvailableLanguages.BANGLA, AvailableLanguages.BOTH),
    "en": (AvailableLanguages.ENGLISH, AvailableLanguages.BOTH),
    "both": (AvailableLanguages.BOTH,),
}
IMAGE_MISSING_MESSAGE = _("Choose an image file to upload.")
# Multipart framing overhead allowed on top of the image size limit.
UPLOAD_OVERHEAD_BYTES = 64 * 1024


def _write(request, func, *args, **kwargs):
    try:
        return func(*args, ctx=AuditContext.from_request(request), **kwargs)
    except DjangoValidationError as exc:
        raise to_drf_validation_error(exc) from exc
    except QuestionInUse as exc:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT, code="in_use", message=str(exc.message)
        ) from exc
    except QuestionLocked as exc:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="question_locked",
            message=str(exc.message),
        ) from exc


def _queryset():
    return Question.objects.select_related("subject").prefetch_related("options")


@extend_schema_view(
    get=extend_schema(
        parameters=[
            OpenApiParameter("subject", OpenApiTypes.INT),
            OpenApiParameter("category", OpenApiTypes.INT),
            OpenApiParameter("difficulty", OpenApiTypes.STR, enum=Difficulty.values),
            OpenApiParameter("is_active", OpenApiTypes.BOOL),
            OpenApiParameter(
                "language",
                OpenApiTypes.STR,
                enum=list(LANGUAGE_FILTER),
                description="Questions usable in this language (bn/en include 'both').",
            ),
            OpenApiParameter("search", OpenApiTypes.STR, description="Bangla/English text."),
            OpenApiParameter(
                "ordering",
                OpenApiTypes.STR,
                description="Comma-separated; '-' = descending. Fields: "
                + ", ".join(ORDERING_FIELDS),
            ),
        ]
    )
)
class QuestionListCreateView(AdminAPIMixin, generics.ListCreateAPIView):
    serializer_class = QuestionAdminSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        request = self.request
        queryset = _queryset()
        subject = query_int(request, "subject")
        if subject is not None:
            queryset = queryset.filter(subject_id=subject)
        category = query_int(request, "category")
        if category is not None:
            queryset = queryset.filter(subject__category_id=category)
        difficulty = query_choice(request, "difficulty", Difficulty.values)
        if difficulty is not None:
            queryset = queryset.filter(difficulty=difficulty)
        is_active = query_bool(request, "is_active")
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active)
        language = query_choice(request, "language", LANGUAGE_FILTER)
        if language is not None:
            queryset = queryset.filter(available_languages__in=LANGUAGE_FILTER[language])
        search = query_search(request)
        if search:
            queryset = queryset.filter(Q(text_bn__icontains=search) | Q(text_en__icontains=search))
        return queryset.order_by(*query_ordering(request, ORDERING_FIELDS, DEFAULT_ORDERING))

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        options = data.pop("options")
        question = _write(request, services.create_question, Question(**data), options)
        return Response(
            self.get_serializer(_queryset().get(pk=question.pk)).data,
            status=status.HTTP_201_CREATED,
        )


class QuestionDetailView(AdminAPIMixin, generics.RetrieveUpdateDestroyAPIView):
    """PATCH: question fields are optional; ``options``, when sent, is the COMPLETE new
    option set (it replaces the current options atomically)."""

    serializer_class = QuestionAdminSerializer
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return _queryset()

    def update(self, request, *args, **kwargs):
        question = self.get_object()
        serializer = self.get_serializer(question, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        options = data.pop("options", None)
        _write(request, services.update_question, question.pk, data, options)
        return Response(self.get_serializer(_queryset().get(pk=question.pk)).data)

    def destroy(self, request, *args, **kwargs):
        question = self.get_object()
        _write(request, services.delete_question, question.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ImageUploadSerializer(serializers.Serializer):
    image = serializers.FileField()  # content is validated by the service (Pillow)


class QuestionImageView(AdminAPIMixin, APIView):
    """``POST`` (multipart, field ``image``) replaces the image; ``DELETE`` removes it."""

    parser_classes = [MultiPartParser]
    http_method_names = ["post", "delete", "options"]

    def _question(self, pk):
        return generics.get_object_or_404(Question.objects.all(), pk=pk)

    @extend_schema(request=ImageUploadSerializer, responses=QuestionAdminSerializer)
    def post(self, request, pk):
        self._question(pk)
        # Refuse oversized bodies before Django parses (and spools) the upload.
        limit = settings.QUESTION_IMAGE_MAX_BYTES + UPLOAD_OVERHEAD_BYTES
        if int(request.META.get("CONTENT_LENGTH") or 0) > limit:
            raise to_drf_validation_error(
                DjangoValidationError(
                    {
                        "image": services.IMAGE_TOO_LARGE_MESSAGE
                        % {"max": round(settings.QUESTION_IMAGE_MAX_BYTES / (1024 * 1024), 1)}
                    }
                )
            )
        upload = request.FILES.get("image")
        if upload is None:
            raise serializers.ValidationError({"image": [IMAGE_MISSING_MESSAGE]})
        _write(request, services.set_question_image, pk, upload)
        question = _queryset().get(pk=pk)
        return Response(QuestionAdminSerializer(question, context={"request": request}).data)

    @extend_schema(responses=QuestionAdminSerializer)
    def delete(self, request, pk):
        self._question(pk)
        _write(request, services.remove_question_image, pk)
        question = _queryset().get(pk=pk)
        return Response(QuestionAdminSerializer(question, context={"request": request}).data)
