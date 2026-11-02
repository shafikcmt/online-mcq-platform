"""Admin Attempts API (Milestone 7F) — read-only operational monitoring.

- ``GET /admin/attempts/``              paginated list; filters ``exam``, ``user``,
  ``status``, ``overdue``, ``has_result``; ``ordering`` (``started_at``, ``deadline_at``,
  ``submitted_at``; ``-`` = descending; ``submitted_at`` keeps open attempts last).
- ``GET /admin/attempts/{public_id}/``  the same fields plus server timing (server time,
  remaining seconds, submit cutoff) and the result's time and merit summary.

Timing comes from the exam engine's own rules (``attempts.selectors``: ``is_overdue``,
``overdue_filter``, ``grace``, ``remaining_seconds``); scores come from the stored
``Result`` (never recalculated here). No answers, options, question content,
``client_info``, ``idempotency_key`` or internal ids — and nothing here changes an attempt.
"""

from django.db.models import F
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import generics, serializers
from rest_framework.response import Response

from apps.core.admin_api import AdminAPIMixin, query_bool, query_choice, query_int, query_ordering

from ..models import AttemptLanguage, AttemptStatus, ExamAttempt, SubmitSource
from ..selectors import grace, is_overdue, overdue_filter, remaining_seconds

ATTEMPT_ORDERING = ("started_at", "deadline_at", "submitted_at")
ATTEMPT_DEFAULT_ORDERING = ("-started_at", "-id")
M = {"max_digits": 12, "decimal_places": 2, "allow_null": True}  # results TOTAL_DIGITS


class AdminAttemptSerializer(serializers.Serializer):
    """Explicit, read-only fields. Result fields are null while there is no result."""

    attempt_id = serializers.UUIDField()
    exam_id = serializers.IntegerField()
    exam_title_bn = serializers.CharField()
    exam_title_en = serializers.CharField()
    user_id = serializers.IntegerField()
    user_full_name = serializers.CharField()
    attempt_no = serializers.IntegerField()
    status = serializers.ChoiceField(choices=AttemptStatus.choices)
    started_at = serializers.DateTimeField()
    deadline_at = serializers.DateTimeField()
    submitted_at = serializers.DateTimeField(allow_null=True)
    submit_source = serializers.ChoiceField(choices=SubmitSource.choices, allow_null=True)
    content_language = serializers.ChoiceField(choices=AttemptLanguage.choices)
    is_overdue = serializers.BooleanField(
        help_text="Still open past deadline + grace: server finalization is pending."
    )
    has_result = serializers.BooleanField()
    obtained_marks = serializers.DecimalField(**M)
    total_marks = serializers.DecimalField(**M)
    percentage = serializers.DecimalField(**M)
    is_passed = serializers.BooleanField(allow_null=True)


class AdminAttemptDetailSerializer(AdminAttemptSerializer):
    created_at = serializers.DateTimeField()
    server_time = serializers.DateTimeField()
    remaining_seconds = serializers.IntegerField(
        help_text="Seconds until the deadline while open; 0 once finished or past it."
    )
    can_submit_until = serializers.DateTimeField(
        help_text="Deadline + submit grace: the last moment a submit is accepted."
    )
    time_used_seconds = serializers.IntegerField(allow_null=True)
    merit_position = serializers.IntegerField(allow_null=True)
    is_merit_counted = serializers.BooleanField(allow_null=True)


def _admin_attempts():
    # Exam, student and (reverse one-to-one) result in the same query — no per-row reads.
    return ExamAttempt.objects.select_related("exam", "user", "result")


def _scored(attempt: ExamAttempt, field: str):
    """A stored result value (never recalculated); ``None`` while there is no result."""
    result = getattr(attempt, "result", None)
    return None if result is None else getattr(result, field)


def attempt_row(attempt: ExamAttempt, now) -> dict:
    return {
        "attempt_id": attempt.public_id,
        "exam_id": attempt.exam_id,
        "exam_title_bn": attempt.exam.title_bn,
        "exam_title_en": attempt.exam.title_en,
        "user_id": attempt.user_id,
        "user_full_name": attempt.user.full_name,
        "attempt_no": attempt.attempt_no,
        "status": attempt.status,
        "started_at": attempt.started_at,
        "deadline_at": attempt.deadline_at,
        "submitted_at": attempt.submitted_at,
        "submit_source": attempt.submit_source or None,
        "content_language": attempt.content_language,
        "is_overdue": is_overdue(attempt, now),
        "has_result": getattr(attempt, "result", None) is not None,
        "obtained_marks": _scored(attempt, "obtained_marks"),
        "total_marks": _scored(attempt, "total_marks"),
        "percentage": _scored(attempt, "percentage"),
        "is_passed": _scored(attempt, "is_passed"),
    }


def attempt_detail(attempt: ExamAttempt, now) -> dict:
    return {
        **attempt_row(attempt, now),
        "created_at": attempt.created_at,
        "server_time": now,
        "remaining_seconds": remaining_seconds(attempt, now),
        "can_submit_until": attempt.deadline_at + grace(),
        "time_used_seconds": _scored(attempt, "time_used_seconds"),
        "merit_position": _scored(attempt, "merit_position"),
        "is_merit_counted": _scored(attempt, "is_merit_counted"),
    }


def _ordering(request) -> list:
    """Allowed fields only; ``submitted_at`` sorts open attempts (no submit time) last in
    both directions; ``id`` keeps the order stable."""
    if not request.query_params.get("ordering", ""):
        return list(ATTEMPT_DEFAULT_ORDERING)
    ordering = []
    for field in query_ordering(request, ATTEMPT_ORDERING, ()):
        if field.lstrip("-") == "submitted_at":
            expression = F("submitted_at")
            field = (
                expression.desc(nulls_last=True)
                if field.startswith("-")
                else expression.asc(nulls_last=True)
            )
        ordering.append(field)
    return ordering


@extend_schema_view(
    get=extend_schema(
        parameters=[
            OpenApiParameter("exam", OpenApiTypes.INT),
            OpenApiParameter("user", OpenApiTypes.INT),
            OpenApiParameter("status", OpenApiTypes.STR, enum=AttemptStatus.values),
            OpenApiParameter(
                "overdue",
                OpenApiTypes.BOOL,
                description="Still open past deadline + grace (server finalization pending).",
            ),
            OpenApiParameter("has_result", OpenApiTypes.BOOL),
            OpenApiParameter(
                "ordering",
                OpenApiTypes.STR,
                description="Comma-separated; '-' = descending. Fields: "
                + ", ".join(ATTEMPT_ORDERING)
                + ". Open attempts sort last by submitted_at. Default: newest start first.",
            ),
        ]
    )
)
class AdminAttemptListView(AdminAPIMixin, generics.ListAPIView):
    serializer_class = AdminAttemptSerializer
    http_method_names = ["get", "head", "options"]

    def now(self):
        # One server instant per request: the overdue filter and each row's flag agree.
        if not hasattr(self, "_now"):
            self._now = timezone.now()
        return self._now

    def get_queryset(self):
        request = self.request
        queryset = _admin_attempts()
        for name in ("exam", "user"):
            value = query_int(request, name)
            if value is not None:
                queryset = queryset.filter(**{f"{name}_id": value})
        status = query_choice(request, "status", AttemptStatus.values)
        if status is not None:
            queryset = queryset.filter(status=status)
        overdue = query_bool(request, "overdue")
        if overdue is not None:
            condition = overdue_filter(self.now())
            queryset = queryset.filter(condition) if overdue else queryset.exclude(condition)
        has_result = query_bool(request, "has_result")
        if has_result is not None:
            queryset = queryset.filter(result__isnull=not has_result)
        return queryset.order_by(*_ordering(request))

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        rows = [attempt_row(attempt, self.now()) for attempt in page]
        return self.get_paginated_response(AdminAttemptSerializer(rows, many=True).data)


class AdminAttemptDetailView(AdminAPIMixin, generics.RetrieveAPIView):
    """One attempt by its public id: status, server timing and the result summary."""

    serializer_class = AdminAttemptDetailSerializer
    http_method_names = ["get", "head", "options"]
    queryset = _admin_attempts()
    lookup_field = "public_id"

    def retrieve(self, request, *args, **kwargs):
        attempt = self.get_object()
        return Response(AdminAttemptDetailSerializer(attempt_detail(attempt, timezone.now())).data)
