"""Student exam list and details (student JWT) — the public exam fields plus what this
student can do now, by the exam engine's own start rules.

- ``GET /exams/``          exams students may see; filters ``type``, ``access``,
                           ``category``, ``when`` (``open`` / ``upcoming`` / ``ended``),
                           ``search`` (title); paginated, with ``server_time``
- ``GET /exams/{slug}/``   one exam, with instructions and ``server_time``
- ``GET /exams/{slug}/questions/``  the paper of an exam that is over: its questions with the
                           correct answers and explanations (``results.selectors.paper_allowed``)

The list and the details never carry questions, options or answers. The status comes from
``attempts.selectors.student_exam_status`` (also used by the dashboard), so the list, the
details and the start endpoint can never disagree.
"""

from django.db.models import F, Q
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import generics, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.catalog.models import SLUG_MAX_LENGTH
from apps.core.admin_api import INVALID_CHOICE_MESSAGE, query_bool, query_choice, query_search
from apps.core.exceptions import ApiError
from apps.core.i18n import resolve_bilingual
from apps.exams.api.views import public_exams
from apps.exams.models import AccessType, ExamType
from apps.exams.selectors import filter_by_group, material_counts, open_window
from apps.results.api.serializers import PaperSerializer
from apps.results.selectors import paper_allowed, paper_payload
from apps.subscriptions.selectors import active_grants

from ..selectors import attempt_history, student_exam_status
from .serializers import StudentExamDetailSerializer, StudentExamListSerializer

WHEN = ("open", "upcoming", "ended")


def _attach_status(user, exams, now):
    """One query for the student's access and one for their attempts, whatever the
    number of exams."""
    grants = active_grants(user, at=now)
    history = attempt_history(user, [exam.pk for exam in exams]) if exams else {}
    for exam in exams:
        exam.student = student_exam_status(exam, now, grants=grants, history=history)
        exam.student["server_time"] = now
        exam.student["questions_available"] = paper_allowed(
            exam, now, entitled=exam.student["has_access"]
        )


@extend_schema_view(
    get=extend_schema(
        parameters=[
            OpenApiParameter("type", OpenApiTypes.STR, enum=ExamType.values),
            OpenApiParameter("access", OpenApiTypes.STR, enum=AccessType.values),
            OpenApiParameter("category", OpenApiTypes.STR, description="Category slug."),
            OpenApiParameter("group", OpenApiTypes.STR, description="Group slug (exams in it)."),
            OpenApiParameter(
                "ungrouped", OpenApiTypes.BOOL, description="true = exams with no active group."
            ),
            OpenApiParameter(
                "when",
                OpenApiTypes.STR,
                enum=list(WHEN),
                description="open = window open now (soonest end first); upcoming = starts "
                "later (soonest first); ended = window closed (latest first).",
            ),
            OpenApiParameter("search", OpenApiTypes.STR, description="Bangla/English title."),
        ],
        tags=["exams"],
    )
)
class StudentExamListView(generics.ListAPIView):
    serializer_class = StudentExamListSerializer

    def get_queryset(self):
        request = self.request
        self.now = timezone.now()
        queryset = public_exams().prefetch_related("syllabus_items")
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
        group = request.query_params.get("group", "").strip().lower()
        if len(group) > SLUG_MAX_LENGTH:
            raise serializers.ValidationError({"group": [INVALID_CHOICE_MESSAGE]})
        queryset = filter_by_group(
            queryset, group_slug=group, ungrouped=bool(query_bool(request, "ungrouped"))
        )
        search = query_search(request)
        if search:
            queryset = queryset.filter(
                Q(title_bn__icontains=search) | Q(title_en__icontains=search)
            )
        when = query_choice(request, "when", WHEN)
        if when == "open":
            return queryset.filter(open_window(self.now)).order_by(
                F("end_at").asc(nulls_last=True), F("start_at").asc(nulls_first=True), "id"
            )
        if when == "upcoming":
            return queryset.filter(start_at__gt=self.now).order_by("start_at", "id")
        if when == "ended":
            return queryset.filter(end_at__lte=self.now).order_by("-end_at", "-id")
        return queryset.order_by(F("start_at").asc(nulls_last=True), "id")

    def get_serializer_context(self):
        return {
            **super().get_serializer_context(),
            "material_counts": getattr(self, "material_counts", {}),
        }

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.filter_queryset(self.get_queryset()))
        _attach_status(request.user, page, self.now)
        self.material_counts = material_counts(page)
        response = self.get_paginated_response(self.get_serializer(page, many=True).data)
        response.data["server_time"] = serializers.DateTimeField().to_representation(self.now)
        return response


@extend_schema(responses=StudentExamDetailSerializer, tags=["exams"])
class StudentExamDetailView(generics.RetrieveAPIView):
    serializer_class = StudentExamDetailSerializer
    lookup_field = "slug"

    def get_queryset(self):
        return public_exams()

    def retrieve(self, request, *args, **kwargs):
        exam = self.get_object()
        _attach_status(request.user, [exam], timezone.now())
        return Response(self.get_serializer(exam).data)


PAPER_NOT_AVAILABLE_MESSAGE = _(
    "The questions of this exam cannot be viewed. They open after the exam is over."
)


class StudentExamPaperView(APIView):
    """The archive: the questions of an exam that is over, with the correct answers and the
    explanations, for a student who may see the exam (also one who never took it). Refused
    with ``questions_not_available`` while the exam can still be taken, when the admin has
    switched answer review off or hidden the results, or when a paid exam is not covered."""

    http_method_names = ["get", "options"]

    @extend_schema(operation_id="student_exam_questions", responses=PaperSerializer, tags=["exams"])
    def get(self, request, slug):
        exam = generics.get_object_or_404(public_exams(), slug=slug)
        now = timezone.now()
        _attach_status(request.user, [exam], now)
        if not exam.student["questions_available"]:
            raise ApiError(
                status_code=status.HTTP_403_FORBIDDEN,
                code="questions_not_available",
                message=str(PAPER_NOT_AVAILABLE_MESSAGE),
            )
        questions = paper_payload(exam, request.LANGUAGE_CODE, request)
        data = {
            "slug": exam.slug,
            "title": resolve_bilingual(exam, "title", request.LANGUAGE_CODE)[0],
            "total_questions": len(questions),
            "questions": questions,
        }
        return Response(PaperSerializer(data).data)
