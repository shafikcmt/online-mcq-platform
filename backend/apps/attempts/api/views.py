"""Student exam-engine API (student JWT; every query is filtered by ``request.user``).

- ``POST /exams/{slug}/attempts/``                 start (201) or resume (200)
- ``GET  /attempts/``                              my attempt history
- ``GET  /attempts/{public_id}/``                  resume: questions, saved answers, timing
- ``PUT  /attempts/{public_id}/answers/{qid}/``    autosave one answer
- ``PUT  /attempts/{public_id}/answers/``          batch sync after a connection drop
- ``POST /attempts/{public_id}/submit/``           final submit (idempotent)

Attempts are addressed by their UUID; another student's attempt is "not found".
"""

import re

from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import Http404
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.admin_api import to_drf_validation_error
from apps.core.exceptions import ApiError
from apps.core.i18n import resolve_bilingual
from apps.exams.api.views import public_exams

from .. import services
from ..exceptions import AttemptError
from ..models import IDEMPOTENCY_KEY_MAX_LENGTH, ExamAttempt
from ..selectors import attempt_payload, attempt_summary, attempt_with_content
from .serializers import (
    AnswerBatchSerializer,
    AnswerSerializer,
    AttemptHistorySerializer,
    AttemptRoomSerializer,
    SaveResultSerializer,
    StartSerializer,
    SubmitResultSerializer,
    SubmitSerializer,
)

IDEMPOTENCY_KEY_PATTERN = re.compile(rf"^[A-Za-z0-9._:-]{{1,{IDEMPOTENCY_KEY_MAX_LENGTH}}}$")
IDEMPOTENCY_KEY_INVALID_MESSAGE = _(
    "Idempotency-Key must be 1–64 letters, digits or the characters . _ : -"
)

IDEMPOTENCY_HEADER = OpenApiParameter(
    "Idempotency-Key",
    OpenApiTypes.STR,
    location=OpenApiParameter.HEADER,
    required=False,
    description="Optional; the same key may be retried safely.",
)


def _call(func, *args, **kwargs):
    try:
        return func(*args, **kwargs)
    except DjangoValidationError as exc:
        raise to_drf_validation_error(exc) from exc
    except AttemptError as exc:
        raise ApiError(
            status_code=exc.status, code=exc.code, message=str(exc.message), details=exc.details
        ) from exc


def _room(request, public_id, status_code=status.HTTP_200_OK):
    attempt = attempt_with_content(public_id, request.user)
    if attempt is None:
        raise Http404
    data = attempt_payload(attempt, timezone.now(), request)
    return Response(AttemptRoomSerializer(data).data, status=status_code)


def _answer_states(attempt: ExamAttempt, results: list[dict]) -> list[dict]:
    if not results:
        return []
    current = {
        a.question_id: a
        for a in attempt.answers.filter(question_id__in=[r["question_id"] for r in results])
    }
    return [
        {
            **result,
            "selected_option_id": current[result["question_id"]].selected_option_id,
            "is_marked_for_review": current[result["question_id"]].is_marked_for_review,
        }
        for result in results
    ]


def _save_response(attempt: ExamAttempt, results: list[dict]):
    now = timezone.now()
    data = {
        "server_time": now,
        "deadline_at": attempt.deadline_at,
        "remaining_seconds": max(0, int((attempt.deadline_at - now).total_seconds())),
        "answers": _answer_states(attempt, results),
    }
    return Response(SaveResultSerializer(data).data)


class AttemptStartView(APIView):
    """Start a new attempt, or resume the open one (same deadline, order and answers)."""

    http_method_names = ["post", "options"]

    @extend_schema(
        request=StartSerializer,
        responses={201: AttemptRoomSerializer, 200: AttemptRoomSerializer},
        tags=["attempts"],
    )
    def post(self, request, slug):
        exam = generics.get_object_or_404(public_exams(), slug=slug)
        data = StartSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        attempt, created = _call(
            services.start_attempt,
            request.user,
            exam.pk,
            language=request.LANGUAGE_CODE,
            client_info=data.validated_data.get("client_info"),
        )
        code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return _room(request, attempt.public_id, code)


class AttemptListView(generics.ListAPIView):
    """My attempts (newest first) — status and timing only."""

    serializer_class = AttemptHistorySerializer

    def get_queryset(self):
        return ExamAttempt.objects.filter(user_id=self.request.user.pk).select_related("exam")

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        now = timezone.now()
        language = request.LANGUAGE_CODE
        rows = [
            {
                **attempt_summary(attempt, now),
                "exam": {
                    "slug": attempt.exam.slug,
                    "title": resolve_bilingual(attempt.exam, "title", language)[0],
                },
            }
            for attempt in page
        ]
        return self.get_paginated_response(AttemptHistorySerializer(rows, many=True).data)

    @extend_schema(tags=["attempts"])
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)


class AttemptDetailView(APIView):
    http_method_names = ["get", "options"]

    @extend_schema(responses=AttemptRoomSerializer, tags=["attempts"])
    def get(self, request, public_id):
        return _room(request, public_id)


class AnswerView(APIView):
    http_method_names = ["put", "options"]

    @extend_schema(
        operation_id="attempts_answer_save",
        request=AnswerSerializer,
        responses=SaveResultSerializer,
        tags=["attempts"],
    )
    def put(self, request, public_id, question_id):
        data = AnswerSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        item = {**data.validated_data, "question_id": question_id}
        attempt, results = _call(services.save_answers, request.user, public_id, [item])
        return _save_response(attempt, results)


class AnswerBatchView(APIView):
    """Batch sync: one transaction. An item older (device time) than the stored answer
    is reported as ``stale`` and does not overwrite it."""

    http_method_names = ["put", "options"]

    @extend_schema(
        operation_id="attempts_answers_sync",
        request=AnswerBatchSerializer,
        responses=SaveResultSerializer,
        tags=["attempts"],
    )
    def put(self, request, public_id):
        data = AnswerBatchSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        attempt, results = _call(
            services.save_answers, request.user, public_id, data.validated_data["answers"]
        )
        return _save_response(attempt, results)


class SubmitView(APIView):
    http_method_names = ["post", "options"]

    @extend_schema(
        request=SubmitSerializer,
        responses=SubmitResultSerializer,
        parameters=[IDEMPOTENCY_HEADER],
        tags=["attempts"],
    )
    def post(self, request, public_id):
        key = request.headers.get("Idempotency-Key", "").strip()
        if key and not IDEMPOTENCY_KEY_PATTERN.match(key):
            raise serializers.ValidationError(
                {"idempotency_key": [IDEMPOTENCY_KEY_INVALID_MESSAGE]}
            )
        data = SubmitSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        attempt, results = _call(
            services.submit_attempt,
            request.user,
            public_id,
            source=data.validated_data["source"],
            items=data.validated_data.get("answers"),
            idempotency_key=key,
        )
        payload = {
            **attempt_summary(attempt, timezone.now()),
            "answers": _answer_states(attempt, results),
            # Scoring arrives with the results milestone.
            "result_available": False,
            "result": None,
        }
        return Response(SubmitResultSerializer(payload).data)
