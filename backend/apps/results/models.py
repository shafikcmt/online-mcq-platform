"""Results: one row per finished attempt (docs/DATABASE_DESIGN.md §4.7, §6).

A result is calculated once, by the server, when its attempt is finalized (manual or
device-timeout submit, or server auto-finalize) — from the attempt's own snapshot
(marks, negative marks) and the server-side answer key. It never changes afterwards;
only the merit fields move:

- ``is_merit_counted`` marks the **one** result per (exam, student) that the exam's
  ``merit_strategy`` selects (live: the single attempt);
- ``merit_position`` is filled by merit generation (after the exam ends / on admin
  request), in the basic merit order: marks ↓, time used ↑, submit time ↑.

Visibility is not stored here: it is derived from the exam (``result_visibility``,
``end_at``, ``result_published_at``) in ``results.selectors``.

Column sizes are derived from the bounds of every valid exam (``RESULT_VALUE_BOUND``):
a question's marks are 0.01 … 99 999.99 and its negative marks 0 … 99 999.99
(NUMERIC(7,2) with ``> 0`` / ``≥ 0`` checks), an exam has at most 10 000 questions.

- |aggregate marks| ≤ 10 000 × 99 999.99 = 999 999 900.00
- percentage ≥ −99 999.99 / 0.01 × 100 = −999 999 900.00 (wrong answers with a tiny
  mark and a huge penalty), ≤ 100.00

Both fit NUMERIC(11,2); the columns are NUMERIC(12,2) for headroom, and the scoring
service checks every value against the column limit before saving.
"""

from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.attempts.models import ExamAttempt
from apps.core.models import TimeStampedModel
from apps.exams.models import Exam

TOTAL_DIGITS, DECIMALS = 12, 2
PERCENT_DIGITS = 12
# Largest value any valid exam can produce (see the module docstring).
RESULT_VALUE_BOUND = Decimal("999999900.00")
# Largest value the columns can store.
COLUMN_LIMIT = Decimal(10) ** (TOTAL_DIGITS - DECIMALS) - Decimal("0.01")


def _total(verbose_name, **kwargs):
    return models.DecimalField(
        verbose_name, max_digits=TOTAL_DIGITS, decimal_places=DECIMALS, **kwargs
    )


class Result(TimeStampedModel):
    attempt = models.OneToOneField(
        ExamAttempt, verbose_name=_("attempt"), on_delete=models.PROTECT, related_name="result"
    )
    # Denormalized from the attempt for fast merit queries.
    exam = models.ForeignKey(
        Exam, verbose_name=_("exam"), on_delete=models.PROTECT, related_name="results"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name=_("user"),
        on_delete=models.PROTECT,
        related_name="results",
    )
    submitted_at = models.DateTimeField(_("submitted at"))  # merit tie-break
    total_questions = models.PositiveIntegerField(_("total questions"))
    correct_count = models.PositiveIntegerField(_("correct answers"))
    wrong_count = models.PositiveIntegerField(_("wrong answers"))
    unanswered_count = models.PositiveIntegerField(_("unanswered questions"))
    positive_marks = _total(_("marks for correct answers"))
    negative_marks_total = _total(_("negative marks"))
    obtained_marks = _total(_("obtained marks"))  # may be negative
    total_marks = _total(_("total marks"))
    # obtained / total × 100, rounded half-up to 2 places; raw (may be far below 0).
    percentage = models.DecimalField(
        _("percentage"), max_digits=PERCENT_DIGITS, decimal_places=DECIMALS
    )
    is_passed = models.BooleanField(_("passed"), null=True, blank=True)  # null: no pass mark
    time_used_seconds = models.PositiveIntegerField(_("time used (seconds)"))
    is_merit_counted = models.BooleanField(_("counts for merit"), default=False)
    merit_position = models.PositiveIntegerField(_("merit position"), null=True, blank=True)
    calculated_at = models.DateTimeField(_("calculated at"))

    class Meta:
        verbose_name = _("result")
        verbose_name_plural = _("results")
        ordering = ("-submitted_at", "-id")
        constraints = [
            models.CheckConstraint(
                condition=models.Q(
                    total_questions=models.F("correct_count")
                    + models.F("wrong_count")
                    + models.F("unanswered_count")
                ),
                name="results_counts_add_up",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    obtained_marks=models.F("positive_marks") - models.F("negative_marks_total")
                ),
                name="results_obtained_consistent",
            ),
            models.CheckConstraint(
                condition=models.Q(positive_marks__gte=0)
                & models.Q(negative_marks_total__gte=0)
                & models.Q(total_marks__gt=0)
                & models.Q(positive_marks__lte=models.F("total_marks")),
                name="results_marks_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(merit_position__isnull=True)
                | models.Q(merit_position__gte=1, is_merit_counted=True),
                name="results_position_needs_merit",
            ),
            # The one result per student and exam that counts for merit.
            models.UniqueConstraint(
                fields=["exam", "user"],
                condition=models.Q(is_merit_counted=True),
                name="results_one_merit_result",
            ),
            models.UniqueConstraint(
                fields=["exam", "merit_position"],
                condition=models.Q(merit_position__isnull=False),
                name="results_unique_position",
            ),
        ]
        indexes = [
            # Basic merit ordering: marks ↓, time ↑, submit ↑.
            models.Index(
                "exam",
                "is_merit_counted",
                models.F("obtained_marks").desc(),
                "time_used_seconds",
                "submitted_at",
                name="results_merit_order_idx",
            ),
            models.Index(fields=["exam", "merit_position"], name="results_exam_position_idx"),
            models.Index(fields=["user", "submitted_at"], name="results_user_idx"),
        ]

    def __str__(self) -> str:
        return f"result · attempt #{self.attempt_id}"
