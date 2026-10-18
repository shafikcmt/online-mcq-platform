"""Read side of the exam engine: lock checks other modules register, timing helpers,
and the student-safe exam-room payload.

The payload is built field by field from an explicit allow-list: it never touches
``QuestionOption.is_correct``, ``Question.explanation``, ``AttemptAnswer.is_correct`` or
``awarded_marks`` — correct answers cannot leak before submission by accident.
"""

from datetime import datetime, timedelta

from django.conf import settings
from django.db.models import Prefetch

from apps.core.i18n import resolve_bilingual
from apps.exams.models import ContentLanguage, ExamType
from apps.questions.models import QuestionOption

from .models import AttemptAnswer, AttemptStatus, ExamAttempt


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


# --------------------------------------------------------------------------------------
# Start rules (the exam engine's own checks; also read by the student dashboard)
# --------------------------------------------------------------------------------------
NOT_STARTED, ENDED = "exam_not_started", "exam_ended"
RETAKE_NOT_ALLOWED, LIMIT_REACHED = "retake_not_allowed", "attempt_limit_reached"


def schedule_blocker(exam, now: datetime) -> str | None:
    """Why a new attempt cannot start now because of the schedule (``None`` = open).
    The window includes ``start_at`` and excludes ``end_at``."""
    if exam.start_at and now < exam.start_at:
        return NOT_STARTED
    if exam.end_at and now >= exam.end_at:
        return ENDED
    return None


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
    can_start = (
        entitled and schedule_blocker(exam, now) is None and retake_blocker(exam, attempts) is None
    )
    return can_start, False


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
    remaining = max(0, int((attempt.deadline_at - now).total_seconds()))
    return {
        "attempt_id": str(attempt.public_id),
        "attempt_no": attempt.attempt_no,
        "status": attempt.status,
        "server_time": now,
        "started_at": attempt.started_at,
        "deadline_at": attempt.deadline_at,
        "remaining_seconds": remaining if attempt.status == AttemptStatus.IN_PROGRESS else 0,
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
