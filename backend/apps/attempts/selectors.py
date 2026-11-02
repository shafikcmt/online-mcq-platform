"""Read side of the exam engine: lock checks other modules register, timing helpers,
and the student-safe exam-room payload.

The payload is built field by field from an explicit allow-list: it never touches
``QuestionOption.is_correct``, ``Question.explanation``, ``AttemptAnswer.is_correct`` or
``awarded_marks`` — correct answers cannot leak before submission by accident.
"""

from datetime import datetime, timedelta

from django.conf import settings
from django.db.models import Count, Max, Prefetch, Q

from apps.core.i18n import resolve_bilingual
from apps.exams.models import ContentLanguage, ExamType
from apps.questions.models import QuestionOption

from .models import FINISHED_STATUSES, AttemptAnswer, AttemptStatus, ExamAttempt


# --------------------------------------------------------------------------------------
# Locks (registered in AttemptsConfig.ready)
# --------------------------------------------------------------------------------------
def question_used_by_attempt(question) -> bool:
    return AttemptAnswer.objects.filter(question_id=question.pk).exists()


def exam_has_attempts(exam_id) -> bool:
    return ExamAttempt.objects.filter(exam_id=exam_id).exists()


# --------------------------------------------------------------------------------------
# Timing (server clock only)
# --------------------------------------------------------------------------------------
def grace() -> timedelta:
    return timedelta(seconds=settings.ATTEMPT_SUBMIT_GRACE_SECONDS)


def can_edit(attempt: ExamAttempt, now: datetime) -> bool:
    """Answers may change only before the deadline (grace never extends editing)."""
    return attempt.status == AttemptStatus.IN_PROGRESS and now < attempt.deadline_at


def can_submit(attempt: ExamAttempt, now: datetime) -> bool:
    """The final submit request may arrive up to ``grace`` after the deadline."""
    return attempt.status == AttemptStatus.IN_PROGRESS and now <= attempt.deadline_at + grace()


def past_grace(deadline_at: datetime, now: datetime) -> bool:
    return now > deadline_at + grace()


def is_overdue(attempt: ExamAttempt, now: datetime) -> bool:
    """Past deadline + grace and still open: the server finalizes it."""
    return attempt.status == AttemptStatus.IN_PROGRESS and past_grace(attempt.deadline_at, now)


def overdue_filter(now: datetime) -> Q:
    """``is_overdue`` as a query: still open and past deadline + grace."""
    return Q(status=AttemptStatus.IN_PROGRESS, deadline_at__lt=now - grace())


def remaining_seconds(attempt: ExamAttempt, now: datetime) -> int:
    """Seconds until the deadline while open (0 once finished or past it)."""
    if attempt.status != AttemptStatus.IN_PROGRESS:
        return 0
    return max(0, int((attempt.deadline_at - now).total_seconds()))


# --------------------------------------------------------------------------------------
# Start rules (the exam engine's own checks; also read by the student dashboard)
# --------------------------------------------------------------------------------------
NOT_STARTED, ENDED = "exam_not_started", "exam_ended"
RETAKE_NOT_ALLOWED, LIMIT_REACHED = "retake_not_allowed", "attempt_limit_reached"
NEEDS_SUBSCRIPTION = "needs_subscription"


def deadline_for(exam, started_at: datetime) -> datetime:
    """``min(started_at + duration, end_at)``: a late joiner only gets the time left."""
    deadline = started_at + timedelta(minutes=exam.duration_minutes)
    if exam.end_at and exam.end_at < deadline:
        deadline = exam.end_at
    return deadline


def schedule_blocker(exam, now: datetime) -> str | None:
    """Why a new attempt cannot start now because of the schedule (``None`` = open).
    The window includes ``start_at`` and excludes ``end_at``."""
    if exam.start_at and now < exam.start_at:
        return NOT_STARTED
    if exam.end_at and now >= exam.end_at:
        return ENDED
    return None


def attempts_allowed(exam) -> int | None:
    """How many attempts a student may make: one for live exams and exams without
    retake, else ``max_attempts`` (``None`` = unlimited)."""
    if exam.exam_type == ExamType.LIVE or not exam.allow_retake:
        return 1
    return exam.max_attempts


def retake_blocker(exam, previous_attempts: int) -> str | None:
    """Why another attempt is not allowed after ``previous_attempts`` finished ones:
    live exams and exams without retake allow exactly one; ``max_attempts`` caps the
    rest (``None`` = unlimited)."""
    if previous_attempts == 0:
        return None
    if exam.exam_type == ExamType.LIVE or not exam.allow_retake:
        return RETAKE_NOT_ALLOWED
    if exam.max_attempts is not None and previous_attempts >= exam.max_attempts:
        return LIMIT_REACHED
    return None


def start_blocker(exam, now: datetime, *, entitled: bool, attempts: int) -> str | None:
    """Why a **new** attempt cannot start now (``None`` = it can), checked in the order
    ``attempts.services.start_attempt`` checks: access, then schedule, then retakes. The
    codes are the error codes that start would return."""
    if not entitled:
        return NEEDS_SUBSCRIPTION
    return schedule_blocker(exam, now) or retake_blocker(exam, attempts)


def start_options(
    exam, now: datetime, *, entitled: bool, attempts: int, open_deadline: datetime | None
) -> tuple[bool, bool]:
    """``(can_start, can_resume)`` for a student and an available (published, listable)
    exam, in the order ``attempts.services.start_attempt`` decides:

    1. an open attempt not yet past deadline + grace is **resumed** (no new attempt, no
       access re-check at this step) → ``(False, True)``;
    2. an overdue open attempt is finalized first, so it counts as a finished attempt;
    3. a new attempt needs access, an open schedule and the retake rules.

    ``attempts`` = all of the student's attempts of this exam (including an open one);
    ``open_deadline`` = the open attempt's deadline, if there is one."""
    if open_deadline is not None and not past_grace(open_deadline, now):
        return False, True
    return start_blocker(exam, now, entitled=entitled, attempts=attempts) is None, False


def attempt_history(user, exam_ids) -> dict[int, tuple[int, int, datetime | None]]:
    """Per exam, the student's ``(attempts, finished, open attempt deadline)`` — one
    grouped query, at most one row per exam."""
    rows = (
        ExamAttempt.objects.filter(user_id=user.pk, exam_id__in=exam_ids)
        .order_by()
        .values("exam_id")
        .annotate(
            attempts=Count("id"),
            finished=Count("id", filter=Q(status__in=FINISHED_STATUSES)),
            open_deadline=Max("deadline_at", filter=Q(status=AttemptStatus.IN_PROGRESS)),
        )
    )
    return {r["exam_id"]: (r["attempts"], r["finished"], r["open_deadline"]) for r in rows}


def student_exam_status(exam, now: datetime, *, grants, history: dict) -> dict:
    """What this student can do with this exam right now — the exam engine's own start
    rules, for lists and details (no queries: ``grants`` from
    ``subscriptions.selectors.active_grants``, ``history`` from ``attempt_history``).

    ``locked_reason`` is set only when the student can neither start nor resume; an
    overdue open attempt counts as finished (the server finalizes it on the next start)."""
    attempts, finished, open_deadline = history.get(exam.pk, (0, 0, None))
    has_access = bool(grants and grants.covers(exam))
    can_start, can_resume = start_options(
        exam, now, entitled=has_access, attempts=attempts, open_deadline=open_deadline
    )
    if can_resume:
        state = "in_progress"
    elif finished or open_deadline is not None:
        state = "finished"
    else:
        state = None
    locked = None
    if not (can_start or can_resume):
        locked = start_blocker(exam, now, entitled=has_access, attempts=attempts)
    return {
        "has_access": has_access,
        "can_start": can_start,
        "can_resume": can_resume,
        "attempt_state": state,
        "locked_reason": locked,
        "attempts_used": attempts,
        "attempts_allowed": attempts_allowed(exam),
        # A live/scheduled exam joined late gets only the time left before end_at.
        "seconds_if_started_now": (
            int((deadline_for(exam, now) - now).total_seconds()) if can_start else None
        ),
    }


# --------------------------------------------------------------------------------------
# Student payload
# --------------------------------------------------------------------------------------
def attempt_with_content(public_id, user):
    """The user's own attempt (never another user's), with everything the exam room
    needs in a fixed number of queries."""
    options = QuestionOption.objects.only("id", "question_id", "text_bn", "text_en")
    return (
        ExamAttempt.objects.select_related("exam")
        .prefetch_related(
            Prefetch(
                "answers",
                queryset=AttemptAnswer.objects.select_related("question")
                .prefetch_related(Prefetch("question__options", queryset=options))
                .order_by("display_order"),
            )
        )
        .filter(public_id=public_id, user_id=user.pk)
        .first()
    )


def _text(obj, field: str, language: str) -> str:
    return resolve_bilingual(obj, field, language)[0]


def _image_url(question, request) -> str | None:
    if not question.image:
        return None
    url = question.image.url
    return request.build_absolute_uri(url) if request is not None else url


def attempt_summary(attempt: ExamAttempt, now: datetime) -> dict:
    """Status and timing only (submit responses, history)."""
    return {
        "attempt_id": str(attempt.public_id),
        "attempt_no": attempt.attempt_no,
        "status": attempt.status,
        "server_time": now,
        "started_at": attempt.started_at,
        "deadline_at": attempt.deadline_at,
        "remaining_seconds": remaining_seconds(attempt, now),
        "can_edit": can_edit(attempt, now),
        "can_submit": can_submit(attempt, now),
        "submitted_at": attempt.submitted_at,
        "submit_source": attempt.submit_source or None,
    }


def attempt_payload(attempt: ExamAttempt, now: datetime, request=None) -> dict:
    """The exam room: questions and options in this attempt's own order, the student's
    saved state, and server timing. Never correct answers or explanations."""
    exam = attempt.exam
    language = attempt.content_language
    bilingual = exam.content_language == ContentLanguage.BOTH
    questions = []
    for number, answer in enumerate(attempt.answers.all(), start=1):
        question = answer.question
        by_id = {option.pk: option for option in question.options.all()}
        options = []
        for option_id in answer.option_order:
            option = by_id[option_id]
            item = {"id": option.pk, "text": _text(option, "text", language)}
            if bilingual:
                item.update(text_bn=option.text_bn, text_en=option.text_en)
            options.append(item)
        entry = {
            "question_id": question.pk,
            "number": number,
            "text": _text(question, "text", language),
            "image": _image_url(question, request),
            "marks": answer.marks,
            "options": options,
            "selected_option_id": answer.selected_option_id,
            "is_marked_for_review": answer.is_marked_for_review,
        }
        if bilingual:
            entry.update(text_bn=question.text_bn, text_en=question.text_en)
        questions.append(entry)
    return {
        **attempt_summary(attempt, now),
        "content_language": language,
        "exam": {
            "slug": exam.slug,
            "title": _text(exam, "title", language),
            "instructions": _text(exam, "instructions", language),
            "exam_type": exam.exam_type,
            "content_language": exam.content_language,
            "duration_minutes": exam.duration_minutes,
            "total_questions": len(questions),
            "negative_marks": exam.negative_marks,
        },
        "questions": questions,
    }
