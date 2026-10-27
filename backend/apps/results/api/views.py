"""Results API.

Student (student JWT; every query filtered by ``request.user``; results addressed by
the attempt's UUID):
- ``GET /results/``                              my visible results
- ``GET /results/{attempt_public_id}/``          result summary
- ``GET /results/{attempt_public_id}/review/``   answer review (visible + allowed)
- ``GET /exams/{slug}/leaderboard/``             merit list + my position

Public (no login): ``GET /public/exams/{slug}/leaderboard/`` — top N, masked names;
``GET /public/leaderboards/`` — the exams that have such a public merit list.

Admin (session + CSRF + admin role): ``GET /admin/results/`` (filters ``exam``, ``user``,
``merit_counted``, ``attempt``, ``is_passed``; ``search`` = student name; ``ordering``),
``POST /admin/exams/{id}/merit/generate/``.
"""

import uuid

from django.conf import settings
from django.db.models import F, Q
from django.http import Http404
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import (
    OpenApiParameter,
    extend_schema,
    extend_schema_view,
    inline_serializer,
)
from rest_framework import generics, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.services import AuditContext
from apps.core.admin_api import (
    INVALID_ID_MESSAGE,
    AdminAPIMixin,
    query_bool,
    query_int,
    query_ordering,
    query_search,
)
from apps.core.exceptions import ApiError
from apps.core.i18n import resolve_bilingual
from apps.core.public_api import PublicAPIMixin
from apps.exams.api.serializers import PublicExamSerializer
from apps.exams.api.views import public_exams
from apps.exams.models import Exam, ExamStatus

from .. import services
from ..exceptions import (
    MERIT_DISABLED_MESSAGE,
    RESULT_NOT_VISIBLE_MESSAGE,
    REVIEW_NOT_ALLOWED_MESSAGE,
    ResultError,
)
from ..models import Result
from ..selectors import (
    display_name_for,
    leaderboard_name_mode,
    own_results,
    public_leaderboard_exams,
    ranked_results,
    results_visible,
    review_allowed,
    review_payload,
    visible_results_filter,
)
from .serializers import (
    AdminResultSerializer,
    AppLeaderboardRowSerializer,
    LeaderboardRowSerializer,
    ResultSummarySerializer,
    ReviewSerializer,
)


def _not_visible():
    return ApiError(
        status_code=status.HTTP_403_FORBIDDEN,
        code="result_not_visible",
        message=str(RESULT_NOT_VISIBLE_MESSAGE),
    )


def _merit_disabled():
    return ApiError(
        status_code=status.HTTP_404_NOT_FOUND,
        code="merit_disabled",
        message=str(MERIT_DISABLED_MESSAGE),
    )


def result_summary(result: Result, user, now, language: str) -> dict:
    """Summary dict for one result (the caller has checked visibility)."""
    exam = result.exam
    attempt = result.attempt
    return {
        "attempt_id": attempt.public_id,
        "attempt_no": attempt.attempt_no,
        "status": attempt.status,
        "exam": {
            "slug": exam.slug,
            "title": resolve_bilingual(exam, "title", language)[0],
            "exam_type": exam.exam_type,
        },
        "submitted_at": result.submitted_at,
        "total_questions": result.total_questions,
        "correct_count": result.correct_count,
        "wrong_count": result.wrong_count,
        "unanswered_count": result.unanswered_count,
        "positive_marks": result.positive_marks,
        "negative_marks_total": result.negative_marks_total,
        "obtained_marks": result.obtained_marks,
        "total_marks": result.total_marks,
        "percentage": result.percentage,
        "pass_marks": exam.pass_marks,
        "is_passed": result.is_passed,
        "time_used_seconds": result.time_used_seconds,
        "is_merit_counted": result.is_merit_counted,
        "merit_position": result.merit_position,
        "review_available": review_allowed(result, user, now),
    }


def _own_result(request, attempt_public_id) -> Result:
    result = own_results(request.user).filter(attempt__public_id=attempt_public_id).first()
    if result is None:
        raise Http404
    if not results_visible(result.exam, timezone.now()):
        raise _not_visible()
    return result


# --------------------------------------------------------------------------------------
# Student
# --------------------------------------------------------------------------------------
class MyResultListView(generics.ListAPIView):
    """My results whose exam's results are visible now (newest first)."""

    serializer_class = ResultSummarySerializer

    def get_queryset(self):
        return own_results(self.request.user).filter(visible_results_filter(timezone.now()))

    def list(self, request, *args, **kwargs):
        now = timezone.now()
        page = self.paginate_queryset(self.get_queryset().order_by("-submitted_at", "-id"))
        rows = [result_summary(r, request.user, now, request.LANGUAGE_CODE) for r in page]
        return self.get_paginated_response(ResultSummarySerializer(rows, many=True).data)

    @extend_schema(tags=["results"])
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)


class ResultDetailView(APIView):
    http_method_names = ["get", "options"]

    @extend_schema(responses=ResultSummarySerializer, tags=["results"])
    def get(self, request, attempt_id):
        result = _own_result(request, attempt_id)
        data = result_summary(result, request.user, timezone.now(), request.LANGUAGE_CODE)
        return Response(ResultSummarySerializer(data).data)


class ResultReviewView(APIView):
    """Correct answers and explanations — only when the result is visible AND the exam
    allows answer review."""

    http_method_names = ["get", "options"]

    @extend_schema(responses=ReviewSerializer, tags=["results"])
    def get(self, request, attempt_id):
        result = _own_result(request, attempt_id)
        now = timezone.now()
        if not review_allowed(result, request.user, now):
            raise ApiError(
                status_code=status.HTTP_403_FORBIDDEN,
                code="review_not_allowed",
                message=str(REVIEW_NOT_ALLOWED_MESSAGE),
            )
        data = {
            "result": result_summary(result, request.user, now, request.LANGUAGE_CODE),
            "questions": review_payload(result, request),
        }
        return Response(ReviewSerializer(data).data)


def _leaderboard_rows(results, mode: str, me=None) -> list[dict]:
    rows = []
    for result in results:
        is_me = me is not None and result.user_id == me.pk
        row = {
            "position": result.merit_position,
            # A student always sees their own full name.
            "name": result.user.full_name if is_me else display_name_for(result.user, mode),
            "obtained_marks": result.obtained_marks,
            "total_marks": result.total_marks,
            "percentage": result.percentage,
            "time_used_seconds": result.time_used_seconds,
        }
        if me is not None:
            row["is_me"] = is_me
        rows.append(row)
    return rows


class ExamLeaderboardView(generics.ListAPIView):
    """The exam's generated merit list (paginated) and the caller's own position."""

    serializer_class = AppLeaderboardRowSerializer

    def _exam(self) -> Exam:
        user = self.request.user
        exam = (
            Exam.objects.filter(slug=self.kwargs["slug"])
            .filter(Q(status=ExamStatus.PUBLISHED) | Q(attempts__user_id=user.pk))
            .distinct()
            .first()
        )
        if exam is None:
            raise Http404
        if not exam.merit_enabled:
            raise _merit_disabled()
        if not results_visible(exam, timezone.now()):
            raise _not_visible()
        return exam

    @extend_schema(
        tags=["results"],
        responses=inline_serializer(
            "AppLeaderboardPage",
            fields={
                "count": serializers.IntegerField(),
                "next": serializers.URLField(allow_null=True),
                "previous": serializers.URLField(allow_null=True),
                "my_position": serializers.IntegerField(allow_null=True),
                "results": AppLeaderboardRowSerializer(many=True),
            },
        ),
    )
    def get(self, request, slug):
        exam = self._exam()
        page = self.paginate_queryset(ranked_results(exam))
        rows = _leaderboard_rows(page, leaderboard_name_mode("app"), me=request.user)
        response = self.get_paginated_response(AppLeaderboardRowSerializer(rows, many=True).data)
        response.data["my_position"] = (
            Result.objects.filter(exam_id=exam.pk, user_id=request.user.pk, is_merit_counted=True)
            .values_list("merit_position", flat=True)
            .first()
        )
        return response


class PublicLeaderboardExamSerializer(PublicExamSerializer):
    ranked_count = serializers.IntegerField(help_text="Students on the merit list.")


class PublicLeaderboardExamListView(PublicAPIMixin, generics.ListAPIView):
    """Exams whose merit list the public leaderboard shows (merit enabled, results
    visible, merit generated), most recently ended first, unscheduled last."""

    serializer_class = PublicLeaderboardExamSerializer

    def get_queryset(self):
        return public_leaderboard_exams(public_exams(), timezone.now()).order_by(
            F("end_at").desc(nulls_last=True), "-id"
        )


class PublicLeaderboardView(PublicAPIMixin, APIView):
    """Top N of a published exam's merit list (only while its results are visible)."""

    http_method_names = ["get", "options"]

    @extend_schema(responses=LeaderboardRowSerializer(many=True), tags=["public"])
    def get(self, request, slug):
        exam = generics.get_object_or_404(public_exams(), slug=slug)
        if not exam.merit_enabled or not results_visible(exam, timezone.now()):
            raise Http404
        top = ranked_results(exam)[: settings.LEADERBOARD_PUBLIC_SIZE]
        rows = _leaderboard_rows(top, leaderboard_name_mode("public"))
        return Response(LeaderboardRowSerializer(rows, many=True).data)


# --------------------------------------------------------------------------------------
# Admin
# --------------------------------------------------------------------------------------
# Default: grouped by exam, ranked first (unranked last), newest first.
ADMIN_RESULT_DEFAULT_ORDERING = ("exam_id", "merit_position", "-submitted_at", "-id")
ADMIN_RESULT_ORDERING_FIELDS = ("submitted_at", "percentage", "merit_position")


def _query_uuid(request, name: str) -> uuid.UUID | None:
    raw = request.query_params.get(name)
    if raw is None or raw == "":
        return None
    try:
        return uuid.UUID(raw.strip())
    except ValueError:
        raise serializers.ValidationError({name: [INVALID_ID_MESSAGE]}) from None


@extend_schema_view(
    get=extend_schema(
        parameters=[
            OpenApiParameter("exam", OpenApiTypes.INT),
            OpenApiParameter("user", OpenApiTypes.INT),
            OpenApiParameter("merit_counted", OpenApiTypes.BOOL),
            OpenApiParameter(
                "attempt", OpenApiTypes.UUID, description="The attempt's public id (0 or 1 row)."
            ),
            OpenApiParameter("is_passed", OpenApiTypes.BOOL),
            OpenApiParameter("search", OpenApiTypes.STR, description="Student name."),
            OpenApiParameter(
                "ordering",
                OpenApiTypes.STR,
                description="Comma-separated; '-' = descending. Fields: "
                + ", ".join(ADMIN_RESULT_ORDERING_FIELDS)
                + ". Default: exam, merit position, newest.",
            ),
        ]
    )
)
class AdminResultListView(AdminAPIMixin, generics.ListAPIView):
    """Results for admins: scores, merit and the exam's bilingual title per row (joined,
    no per-row queries). Never answers, options or explanations."""

    serializer_class = AdminResultSerializer

    def get_queryset(self):
        request = self.request
        queryset = Result.objects.select_related("attempt", "user", "exam")
        for name in ("exam", "user"):
            value = query_int(request, name)
            if value is not None:
                queryset = queryset.filter(**{f"{name}_id": value})
        attempt = _query_uuid(request, "attempt")
        if attempt is not None:
            queryset = queryset.filter(attempt__public_id=attempt)
        for name, field in (("merit_counted", "is_merit_counted"), ("is_passed", "is_passed")):
            value = query_bool(request, name)
            if value is not None:
                queryset = queryset.filter(**{field: value})
        search = query_search(request)
        if search:
            queryset = queryset.filter(user__full_name__icontains=search)
        if request.query_params.get("ordering", ""):
            ordering = query_ordering(request, ADMIN_RESULT_ORDERING_FIELDS, ())
        else:
            ordering = list(ADMIN_RESULT_DEFAULT_ORDERING)
        return queryset.order_by(*ordering)

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        rows = [
            {
                "attempt_id": r.attempt.public_id,
                "attempt_no": r.attempt.attempt_no,
                "exam_id": r.exam_id,
                "exam_title_bn": r.exam.title_bn,
                "exam_title_en": r.exam.title_en,
                "user_id": r.user_id,
                "user_full_name": r.user.full_name,
                "status": r.attempt.status,
                "submit_source": r.attempt.submit_source,
                "submitted_at": r.submitted_at,
                "correct_count": r.correct_count,
                "wrong_count": r.wrong_count,
                "unanswered_count": r.unanswered_count,
                "obtained_marks": r.obtained_marks,
                "total_marks": r.total_marks,
                "percentage": r.percentage,
                "is_passed": r.is_passed,
                "time_used_seconds": r.time_used_seconds,
                "is_merit_counted": r.is_merit_counted,
                "merit_position": r.merit_position,
            }
            for r in page
        ]
        return self.get_paginated_response(AdminResultSerializer(rows, many=True).data)


class MeritGenerateView(AdminAPIMixin, APIView):
    http_method_names = ["post", "options"]

    @extend_schema(
        request=None,
        responses=inline_serializer(
            "MeritGenerated", fields={"ranked_count": serializers.IntegerField()}
        ),
    )
    def post(self, request, pk):
        generics.get_object_or_404(Exam.objects.all(), pk=pk)
        try:
            count = services.generate_merit(pk, ctx=AuditContext.from_request(request))
        except ResultError as exc:
            raise ApiError(status_code=exc.status, code=exc.code, message=str(exc.message)) from exc
        return Response({"ranked_count": count})
