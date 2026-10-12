"""Scoring and merit (docs/DATABASE_DESIGN.md §4.7 and §6). All writes to results.

Scoring (``record_result``) is called by ``attempts.services`` inside the transaction
that finalizes an attempt, with the attempt row locked — for every way an attempt can
end (manual submit, device-timeout submit, server auto-finalize). There is exactly one
scoring implementation; calling it again for the same attempt returns the existing
result (``OneToOne`` on ``attempt`` is the database's last guard).

Per answer, from the attempt's snapshot and the server-side answer key:
- unanswered → 0
- selected option correct → ``+marks``
- selected option wrong → ``−negative_marks``

``obtained = Σ awarded`` (may be negative, no floor), ``total = Σ marks``,
``percentage = obtained / total × 100`` (half-up, 2 places), ``is_passed = obtained ≥
pass_marks`` (null without a pass mark), ``time_used = min(submitted_at, deadline_at) −
started_at`` in whole seconds. Decimal only.
"""

import logging
from decimal import ROUND_HALF_UP, Decimal, localcontext

from django.db import connection, transaction
from django.db.models import F, Window
from django.db.models.functions import RowNumber
from django.http import Http404
from django.utils import timezone

from apps.attempts.models import AttemptAnswer, ExamAttempt
from apps.audit import services as audit
from apps.audit.services import AuditContext
from apps.exams.models import Exam, ExamType, MeritStrategy

from .exceptions import MERIT_DISABLED_MESSAGE, RESULT_OUT_OF_RANGE_MESSAGE, ResultError
from .models import COLUMN_LIMIT, Result

logger = logging.getLogger(__name__)

CENT = Decimal("0.01")
HUNDRED = Decimal(100)

# The basic merit order (DATABASE_DESIGN §4.7), with a final deterministic key.
MERIT_ORDER = (F("obtained_marks").desc(), "time_used_seconds", "submitted_at", "attempt_id")


def percentage_of(obtained: Decimal, total: Decimal) -> Decimal:
    """Raw percentage (never clamped), half-up to 2 places, Decimal only."""
    with localcontext() as context:
        context.prec = 40  # far beyond any valid value: no silent rounding
        return (obtained * HUNDRED / total).quantize(CENT, rounding=ROUND_HALF_UP)


def ensure_storable(values: dict[str, Decimal]) -> None:
    """Defence in depth: valid exams cannot exceed ``RESULT_VALUE_BOUND``, but a value
    beyond the column limit must become a controlled domain error (attempt stays open,
    nothing saved), never a database overflow."""
    for field, value in values.items():
        if abs(value) > COLUMN_LIMIT:
            logger.error("Result value out of range field=%s", field)
            raise ResultError("result_out_of_range", RESULT_OUT_OF_RANGE_MESSAGE, status=500)


def time_used_seconds(attempt: ExamAttempt) -> int:
    end = min(attempt.submitted_at, attempt.deadline_at)
    return max(0, int((end - attempt.started_at).total_seconds()))


# --------------------------------------------------------------------------------------
# Scoring
# --------------------------------------------------------------------------------------
def record_result(attempt: ExamAttempt) -> Result:
    """Score a finished attempt once. The caller holds the attempt row lock (and is in a
    transaction); an existing result is returned unchanged."""
    existing = Result.objects.filter(attempt_id=attempt.pk).first()
    if existing is not None:
        return existing
    exam = Exam.objects.get(pk=attempt.exam_id)
    answers = list(
        AttemptAnswer.objects.filter(attempt_id=attempt.pk)
        .select_related("selected_option")
        .order_by("display_order")
    )
    correct = wrong = unanswered = 0
    positive = negative = total = Decimal(0)
    for answer in answers:
        total += answer.marks
        option = answer.selected_option
        if option is not None and (
            option.question_id != answer.question_id or option.pk not in answer.option_order
        ):
            # Impossible through the API (saves validate this); never score it.
            logger.error("Answer with a foreign option ignored attempt=%s", attempt.public_id)
            option = None
        if option is None:
            answer.is_correct, answer.awarded_marks = None, Decimal(0)
            unanswered += 1
        elif option.is_correct:
            answer.is_correct, answer.awarded_marks = True, answer.marks
            positive += answer.marks
            correct += 1
        else:
            answer.is_correct, answer.awarded_marks = False, -answer.negative_marks
            negative += answer.negative_marks
            wrong += 1
    obtained = positive - negative
    percentage = percentage_of(obtained, total)
    ensure_storable(
        {
            "positive_marks": positive,
            "negative_marks_total": negative,
            "obtained_marks": obtained,
            "total_marks": total,
            "percentage": percentage,
        }
    )
    AttemptAnswer.objects.bulk_update(answers, ["is_correct", "awarded_marks"])
    result = Result.objects.create(
        attempt=attempt,
        exam_id=attempt.exam_id,
        user_id=attempt.user_id,
        submitted_at=attempt.submitted_at,
        total_questions=len(answers),
        correct_count=correct,
        wrong_count=wrong,
        unanswered_count=unanswered,
        positive_marks=positive,
        negative_marks_total=negative,
        obtained_marks=obtained,
        total_marks=total,
        percentage=percentage,
        is_passed=None if exam.pass_marks is None else obtained >= exam.pass_marks,
        time_used_seconds=time_used_seconds(attempt),
        calculated_at=timezone.now(),
    )
    update_merit_selection(exam, attempt.user_id)
    logger.info(
        "Result recorded attempt=%s user=%s exam=%s correct=%s wrong=%s unanswered=%s",
        attempt.public_id,
        attempt.user_id,
        attempt.exam_id,
        correct,
        wrong,
        unanswered,
    )
    return result


# --------------------------------------------------------------------------------------
# Merit
# --------------------------------------------------------------------------------------
def strategy_of(exam: Exam) -> str:
    return MeritStrategy.FIRST_ATTEMPT if exam.exam_type == ExamType.LIVE else exam.merit_strategy


def _strategy_order(strategy: str) -> tuple:
    if strategy == MeritStrategy.BEST_ATTEMPT:
        return MERIT_ORDER  # highest marks, then less time, then earlier submit
    if strategy == MeritStrategy.LATEST_ATTEMPT:
        return ("-submitted_at", "-attempt_id")
    return ("submitted_at", "attempt_id")  # first_attempt


def update_merit_selection(exam: Exam, user_id) -> None:
    """Move ``is_merit_counted`` to the result the exam's strategy selects for this
    student (none when merit is off). A moved flag clears that student's position, so
    the next merit generation re-ranks the exam.

    Serialized per (exam, student) with a transaction-scoped advisory lock: two scorings
    for the same student (e.g. on different workers) can never both set a flag or both
    clear it. The partial unique index stays the database's last guard."""
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
            [f"results.merit:{exam.pk}:{user_id}"],
        )
    results = Result.objects.filter(exam_id=exam.pk, user_id=user_id)
    chosen = None
    if exam.merit_enabled:
        chosen = (
            results.order_by(*_strategy_order(strategy_of(exam)))
            .values_list("pk", flat=True)
            .first()
        )
    current = results.filter(is_merit_counted=True).values_list("pk", flat=True).first()
    if current == chosen:
        return
    # Clear first: the partial unique index allows one counted result per student.
    results.filter(is_merit_counted=True).update(is_merit_counted=False, merit_position=None)
    if chosen is not None:
        Result.objects.filter(pk=chosen).update(is_merit_counted=True, merit_position=None)


@transaction.atomic
def generate_merit(exam_id: int, *, ctx: AuditContext | None = None) -> int:
    """(Re)number the exam's merit list: positions 1..n over the counted results in the
    basic merit order (exact ties are broken by the earlier attempt, so positions are
    sequential and deterministic). Returns the number of ranked results."""
    exam = Exam.objects.select_for_update(no_key=True).filter(pk=exam_id).first()
    if exam is None:
        raise Http404
    if not exam.merit_enabled:
        raise ResultError("merit_disabled", MERIT_DISABLED_MESSAGE, status=409)
    # Lock the counted rows (id order) so a concurrent scoring cannot move a flag
    # between reading the list and writing the positions.
    list(
        Result.objects.select_for_update()
        .filter(exam_id=exam.pk, is_merit_counted=True)
        .order_by("pk")
        .values_list("pk", flat=True)
    )
    ranked = list(
        Result.objects.filter(exam_id=exam.pk, is_merit_counted=True)
        .annotate(rank=Window(expression=RowNumber(), order_by=list(MERIT_ORDER)))
        .values_list("pk", "rank")
    )
    # Two steps keep UNIQUE(exam, merit_position) valid while positions move.
    Result.objects.filter(exam_id=exam.pk, merit_position__isnull=False).update(merit_position=None)
    rows = [Result(pk=pk, merit_position=rank) for pk, rank in ranked]
    Result.objects.bulk_update(rows, ["merit_position"], batch_size=1000)
    if ctx is not None:
        audit.record(
            ctx,
            action="exam.merit_generate",
            entity_type="exams.exam",
            entity_id=exam.pk,
            summary=f"exam #{exam.pk}",
            metadata={"values": {"ranked_count": len(rows)}},
            allowed_fields=("ranked_count",),
        )
    logger.info("Merit generated exam=%s ranked=%s", exam.pk, len(rows))
    return len(rows)


def generate_due_merit(*, limit: int = 50) -> int:
    """Celery beat: re-rank exams that have counted results without a position and
    whose window has closed (or that have no end). Bounded per run; idempotent."""
    now = timezone.now()
    exam_ids = list(
        Result.objects.filter(
            is_merit_counted=True,
            merit_position__isnull=True,
            exam__merit_enabled=True,
        )
        .exclude(exam__end_at__gt=now)
        .values_list("exam_id", flat=True)
        .distinct()
        .order_by("exam_id")[:limit]
    )
    for exam_id in exam_ids:
        generate_merit(exam_id)
    return len(exam_ids)
