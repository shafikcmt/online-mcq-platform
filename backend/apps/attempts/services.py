"""Exam engine: start/resume, answer saves, submit and server finalization.

Every decision uses the server clock (``timezone.now()`` in UTC); device time is only
used to order retried answer saves (``client_saved_at``).

Locks (lock order: user row → exam row → attempt row; never the other way):
- start: the student's user row (``FOR NO KEY UPDATE``) serializes that student's
  starts across devices; the exam row is held ``FOR SHARE`` so an unpublish/edit
  waits, while thousands of students can start the same live exam in parallel. The
  partial unique index (one open attempt per student and exam) and
  ``UNIQUE(exam, user, attempt_no)`` are the database's last guard.
- save / submit / finalize: the attempt row (``FOR NO KEY UPDATE``); the finalize job
  skips rows another request holds and picks them up next run.

Re-checks on every save and submit (docs/SECURITY_PLAN.md §3.4): the attempt is still
open and inside its time, and the student still has access
(``subscriptions.user_can_access_exam``). Exam availability (published, active
category/subject) and the schedule gate only **new** attempts: an admin who unpublishes
or archives an exam (or deactivates its category) stops new starts but never strands a
student mid-exam — a running attempt works from its own snapshot and its own deadline,
which is never later than the exam's end. The server finalization of overdue attempts
does not depend on any of this: saved answers are always kept.

Timing rule (one cutoff for answers):
- answers change only while ``now < deadline_at``;
- the submit request is accepted until ``deadline_at + ATTEMPT_SUBMIT_GRACE_SECONDS``;
  answers sent with it count only if it arrived before ``deadline_at``;
- after that the server finalizes the attempt (``server_auto``);
- ``client_saved_at`` (device time) only orders retried saves.

No scoring here — results are calculated in the results milestone.
"""

import logging
import secrets
from datetime import datetime, timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import transaction
from django.http import Http404
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from apps.core.i18n import normalize_language
from apps.exams.models import ContentLanguage, Exam, ExamQuestion, ExamStatus, ExamType
from apps.questions.models import QuestionOption
from apps.subscriptions.selectors import user_can_access_exam

from .exceptions import (
    ATTEMPT_LIMIT_MESSAGE,
    DEADLINE_PASSED_MESSAGE,
    EXAM_ENDED_MESSAGE,
    EXAM_NOT_STARTED_MESSAGE,
    NEEDS_SUBSCRIPTION_MESSAGE,
    NOT_IN_PROGRESS_MESSAGE,
    RETAKE_NOT_ALLOWED_MESSAGE,
    AttemptError,
)
from .models import (
    AttemptAnswer,
    AttemptLanguage,
    AttemptStatus,
    ExamAttempt,
    SubmitSource,
)
from .selectors import can_edit, is_overdue

logger = logging.getLogger(__name__)

QUESTION_NOT_IN_ATTEMPT_MESSAGE = _("Question #%(id)s is not part of this attempt.")
OPTION_NOT_IN_QUESTION_MESSAGE = _("This option does not belong to question #%(id)s.")
DUPLICATE_ANSWER_MESSAGE = _("Question #%(id)s is listed more than once.")

# Answer item states reported back to the client.
SAVED, STALE, DEADLINE_PASSED = "saved", "stale", "deadline_passed"

_random = secrets.SystemRandom()


def _now() -> datetime:
    return timezone.now()


# --------------------------------------------------------------------------------------
# Availability checks
# --------------------------------------------------------------------------------------
def exam_is_available(exam: Exam) -> bool:
    """Published, in an active category (and subject, if any) — the same rule as the
    public exam listing."""
    if exam.status != ExamStatus.PUBLISHED or not exam.category.is_active:
        return False
    return exam.subject_id is None or exam.subject.is_active


def _ensure_access(attempt: ExamAttempt, user) -> None:
    """Paid access is re-checked on every save and submit (a cancelled or expired
    subscription stops further changes; saved answers stay)."""
    if not user_can_access_exam(user, attempt.exam):
        raise AttemptError("needs_subscription", NEEDS_SUBSCRIPTION_MESSAGE, status=403)


def _ensure_editable(attempt: ExamAttempt, user, now: datetime) -> None:
    if attempt.status != AttemptStatus.IN_PROGRESS:
        raise AttemptError("attempt_not_in_progress", NOT_IN_PROGRESS_MESSAGE, status=409)
    if not can_edit(attempt, now):
        raise AttemptError("attempt_deadline_passed", DEADLINE_PASSED_MESSAGE, status=410)
    _ensure_access(attempt, user)


# --------------------------------------------------------------------------------------
# Locks
# --------------------------------------------------------------------------------------
def _lock_user(user_id) -> None:
    get_user_model().objects.select_for_update(no_key=True).filter(pk=user_id).first()


def _share_lock_exam(exam_id) -> Exam | None:
    """``FOR SHARE``: blocks unpublish/edit (``FOR UPDATE``) until this start commits,
    but not other students' starts."""
    rows = list(Exam.objects.raw("SELECT * FROM exams_exam WHERE id = %s FOR SHARE", [exam_id]))
    if not rows:
        return None
    return Exam.objects.select_related("category", "subject").get(pk=rows[0].pk)


def _lock_attempt(user, public_id) -> ExamAttempt:
    """The caller's own attempt, locked. Another user's attempt is "not found"."""
    attempt = (
        ExamAttempt.objects.select_for_update(no_key=True, of=("self",))
        .select_related("exam")
        .filter(public_id=public_id, user_id=user.pk)
        .first()
    )
    if attempt is None:
        raise Http404
    return attempt


# --------------------------------------------------------------------------------------
# Finalize
# --------------------------------------------------------------------------------------
def _finalize(attempt: ExamAttempt, now: datetime, source: str, idempotency_key: str = ""):
    attempt.status = (
        AttemptStatus.AUTO_SUBMITTED
        if source == SubmitSource.SERVER_AUTO
        else AttemptStatus.SUBMITTED
    )
    attempt.submitted_at = now
    attempt.submit_source = source
    attempt.idempotency_key = idempotency_key
    attempt.save(
        update_fields=["status", "submitted_at", "submit_source", "idempotency_key", "updated_at"]
    )
    logger.info(
        "Attempt finalized attempt=%s user=%s exam=%s source=%s",
        attempt.public_id,
        attempt.user_id,
        attempt.exam_id,
        source,
    )


# --------------------------------------------------------------------------------------
# Start / resume
# --------------------------------------------------------------------------------------
def _attempt_language(exam: Exam, requested: str | None) -> str:
    if exam.content_language in (ContentLanguage.BANGLA, ContentLanguage.ENGLISH):
        return exam.content_language
    language = normalize_language(requested) or settings.LANGUAGE_CODE
    return language if language in AttemptLanguage.values else AttemptLanguage.BANGLA


def _ensure_schedule(exam: Exam, now: datetime) -> None:
    """The window includes ``start_at`` and excludes ``end_at``."""
    if exam.start_at and now < exam.start_at:
        raise AttemptError(
            "exam_not_started",
            EXAM_NOT_STARTED_MESSAGE,
            status=422,
            details={"start_at": exam.start_at.isoformat()},
        )
    if exam.end_at and now >= exam.end_at:
        raise AttemptError("exam_ended", EXAM_ENDED_MESSAGE, status=422)


def _ensure_retake_allowed(exam: Exam, finished: int) -> None:
    if finished == 0:
        return
    if exam.exam_type == ExamType.LIVE or not exam.allow_retake:
        raise AttemptError("retake_not_allowed", RETAKE_NOT_ALLOWED_MESSAGE, status=422)
    if exam.max_attempts is not None and finished >= exam.max_attempts:
        raise AttemptError(
            "attempt_limit_reached",
            ATTEMPT_LIMIT_MESSAGE,
            status=422,
            details={"max_attempts": exam.max_attempts},
        )


def deadline_for(exam: Exam, started_at: datetime) -> datetime:
    """``min(started_at + duration, end_at)``: a late joiner only gets the time left."""
    deadline = started_at + timedelta(minutes=exam.duration_minutes)
    if exam.end_at and exam.end_at < deadline:
        deadline = exam.end_at
    return deadline


def _build_answers(attempt: ExamAttempt, exam: Exam) -> list[AttemptAnswer]:
    items = list(
        ExamQuestion.objects.filter(exam_id=exam.pk)
        .order_by("sort_order", "id")
        .values_list("question_id", "marks")
    )
    option_ids: dict[int, list[int]] = {}
    for question_id, option_id in (
        QuestionOption.objects.filter(question_id__in=[q for q, _m in items])
        .order_by("question_id", "sort_order", "id")
        .values_list("question_id", "id")
    ):
        option_ids.setdefault(question_id, []).append(option_id)
    if exam.shuffle_questions:
        _random.shuffle(items)
    answers = []
    for position, (question_id, marks) in enumerate(items):
        options = list(option_ids.get(question_id, []))
        if exam.shuffle_options:
            _random.shuffle(options)
        answers.append(
            AttemptAnswer(
                attempt=attempt,
                question_id=question_id,
                display_order=position,
                option_order=options,
                marks=marks if marks is not None else exam.default_marks,
                negative_marks=exam.negative_marks,
            )
        )
    return answers


@transaction.atomic
def start_attempt(
    user, exam_id: int, *, language: str | None = None, client_info: dict | None = None
) -> tuple[ExamAttempt, bool]:
    """Start a new attempt or resume the open one. Returns ``(attempt, created)``."""
    _lock_user(user.pk)
    exam = _share_lock_exam(exam_id)
    if exam is None or not exam_is_available(exam):
        raise Http404
    now = _now()  # after the locks: a start that waited must not use a stale clock

    open_attempt = (
        ExamAttempt.objects.select_for_update(no_key=True)
        .filter(exam_id=exam.pk, user_id=user.pk, status=AttemptStatus.IN_PROGRESS)
        .first()
    )
    if open_attempt is not None:
        if not is_overdue(open_attempt, now):
            return open_attempt, False  # resume: same deadline, order and snapshots
        _finalize(open_attempt, now, SubmitSource.SERVER_AUTO)

    if not user_can_access_exam(user, exam, at=now):
        raise AttemptError("needs_subscription", NEEDS_SUBSCRIPTION_MESSAGE, status=403)
    _ensure_schedule(exam, now)
    previous = ExamAttempt.objects.filter(exam_id=exam.pk, user_id=user.pk)
    _ensure_retake_allowed(exam, previous.count())  # all previous attempts are finished
    last_no = previous.order_by("-attempt_no").values_list("attempt_no", flat=True).first()

    attempt = ExamAttempt(
        exam=exam,
        user=user,
        attempt_no=(last_no or 0) + 1,
        started_at=now,
        deadline_at=deadline_for(exam, now),
        content_language=_attempt_language(exam, language),
        client_info=client_info or {},
    )
    # The user lock serializes this student's starts; the unique indexes are the
    # database's last guard (an IntegrityError then rolls the whole start back).
    attempt.save()
    AttemptAnswer.objects.bulk_create(_build_answers(attempt, exam))
    logger.info(
        "Attempt started attempt=%s user=%s exam=%s no=%s",
        attempt.public_id,
        user.pk,
        exam.pk,
        attempt.attempt_no,
    )
    return attempt, True


# --------------------------------------------------------------------------------------
# Answers
# --------------------------------------------------------------------------------------
_UNSET = object()


def _validate_items(attempt: ExamAttempt, items: list[dict]) -> dict[int, AttemptAnswer]:
    """All items must name questions of this attempt (once each) and options of that
    question; otherwise the whole request is rejected (a client bug, not a retry)."""
    answers = {answer.question_id: answer for answer in attempt.answers.all()}
    seen: set[int] = set()
    for item in items:
        question_id = item["question_id"]
        if question_id in seen:
            raise ValidationError(
                {"answers": ValidationError(DUPLICATE_ANSWER_MESSAGE, params={"id": question_id})}
            )
        seen.add(question_id)
        answer = answers.get(question_id)
        if answer is None:
            raise ValidationError(
                {
                    "question_id": ValidationError(
                        QUESTION_NOT_IN_ATTEMPT_MESSAGE,
                        code="question_not_in_attempt",
                        params={"id": question_id},
                    )
                }
            )
        option_id = item.get("selected_option_id", _UNSET)
        if option_id not in (_UNSET, None) and option_id not in answer.option_order:
            raise ValidationError(
                {
                    "selected_option_id": ValidationError(
                        OPTION_NOT_IN_QUESTION_MESSAGE,
                        code="option_not_in_question",
                        params={"id": question_id},
                    )
                }
            )
    return answers


def _apply(attempt: ExamAttempt, items: list[dict], now: datetime) -> list[dict]:
    """Apply validated items. An item older (by device time) than what is stored is a
    late retry and is skipped as ``stale`` — it never overwrites a newer answer."""
    answers = _validate_items(attempt, items)
    results = []
    for item in items:
        answer = answers[item["question_id"]]
        saved_at = item["client_saved_at"]
        if answer.client_saved_at is not None and saved_at < answer.client_saved_at:
            results.append({"question_id": answer.question_id, "status": STALE})
            continue
        fields = ["client_saved_at", "updated_at"]
        answer.client_saved_at = saved_at
        option_id = item.get("selected_option_id", _UNSET)
        if option_id is not _UNSET:
            answer.selected_option_id = option_id
            answer.answered_at = now
            fields += ["selected_option", "answered_at"]
        if "is_marked_for_review" in item:
            answer.is_marked_for_review = item["is_marked_for_review"]
            fields.append("is_marked_for_review")
        answer.save(update_fields=fields)
        results.append({"question_id": answer.question_id, "status": SAVED})
    return results


@transaction.atomic
def save_answers(user, public_id, items: list[dict]) -> tuple[ExamAttempt, list[dict]]:
    """Autosave one answer or a batch (after a connection drop) in one transaction.

    Item: ``{question_id, selected_option_id?, is_marked_for_review?, client_saved_at}``;
    a missing key keeps the stored value, ``selected_option_id: null`` clears it.
    """
    attempt = _lock_attempt(user, public_id)
    now = _now()
    _ensure_editable(attempt, user, now)
    return attempt, _apply(attempt, items, now)


@transaction.atomic
def submit_attempt(
    user,
    public_id,
    *,
    source: str = SubmitSource.MANUAL,
    items: list[dict] | None = None,
    idempotency_key: str = "",
) -> tuple[ExamAttempt, list[dict]]:
    """Final submit, idempotent: a finished attempt is returned as it is.

    - after ``deadline_at + grace`` the student's submit is not accepted: the server
      finalizes the attempt (``server_auto``) with the answers saved so far;
    - answers sent with the submit are applied only before ``deadline_at`` (grace
      covers the submit request, never answer changes).
    """
    attempt = _lock_attempt(user, public_id)
    now = _now()
    if attempt.is_finished:
        return attempt, []
    if is_overdue(attempt, now):
        _finalize(attempt, now, SubmitSource.SERVER_AUTO)
        return attempt, []
    _ensure_access(attempt, user)
    results: list[dict] = []
    if items:
        if can_edit(attempt, now):
            results = _apply(attempt, items, now)
        else:
            results = [{"question_id": i["question_id"], "status": DEADLINE_PASSED} for i in items]
    _finalize(attempt, now, source, idempotency_key)
    return attempt, results


# --------------------------------------------------------------------------------------
# Server finalization (Celery beat)
# --------------------------------------------------------------------------------------
def finalize_overdue_attempts(*, batch_size: int | None = None, max_batches: int | None = None):
    """Finalize open attempts whose deadline + grace has passed, in bounded batches.

    Each batch is one short transaction; rows locked by a request (e.g. a submit in
    flight) are skipped and handled by that request or the next run. Re-running is
    harmless: a finished attempt is never selected again.
    """
    batch_size = batch_size or settings.ATTEMPT_FINALIZE_BATCH_SIZE
    max_batches = max_batches or settings.ATTEMPT_FINALIZE_MAX_BATCHES
    total = 0
    for _batch in range(max_batches):
        with transaction.atomic():
            now = _now()
            cutoff = now - timedelta(seconds=settings.ATTEMPT_SUBMIT_GRACE_SECONDS)
            rows = list(
                ExamAttempt.objects.select_for_update(no_key=True, skip_locked=True)
                .filter(status=AttemptStatus.IN_PROGRESS, deadline_at__lt=cutoff)
                .order_by("deadline_at", "id")[:batch_size]
            )
            for attempt in rows:
                _finalize(attempt, now, SubmitSource.SERVER_AUTO)
        total += len(rows)
        if len(rows) < batch_size:
            break
    return total
