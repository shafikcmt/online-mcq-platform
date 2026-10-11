"""Exam attempts and their answers (docs/DATABASE_DESIGN.md §4.6).

An attempt is one sitting of one student in one exam. Everything that decides how the
attempt is taken and scored is fixed when it starts and stored here:

- ``deadline_at`` — computed by the server (``min(started_at + duration, end_at)``);
- one ``AttemptAnswer`` per question with the order shown to this student, the option
  order, and a snapshot of the marks and negative marks.

Question/option text is not copied: questions used by an attempt are content-locked
(``questions.locks``), so the referenced rows never change.

Lifecycle: ``in_progress`` → ``submitted`` (student submitted, manually or when the
device timer ran out) or ``auto_submitted`` (finalized by the server after the deadline).
Finished attempts never change status again.
"""

import uuid

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.core.models import TimeStampedModel
from apps.exams.models import MARKS_DECIMALS, MARKS_DIGITS, Exam
from apps.questions.models import Question, QuestionOption

IDEMPOTENCY_KEY_MAX_LENGTH = 64


class AttemptStatus(models.TextChoices):
    IN_PROGRESS = "in_progress", _("In progress")
    SUBMITTED = "submitted", _("Submitted")
    AUTO_SUBMITTED = "auto_submitted", _("Submitted automatically")


FINISHED_STATUSES = (AttemptStatus.SUBMITTED, AttemptStatus.AUTO_SUBMITTED)


class SubmitSource(models.TextChoices):
    MANUAL = "manual", _("Submitted by the student")
    CLIENT_TIMEOUT = "client_timeout", _("Device timer ran out")
    SERVER_AUTO = "server_auto", _("Finalized by the server")


class AttemptLanguage(models.TextChoices):
    BANGLA = "bn", _("Bangla")
    ENGLISH = "en", _("English")


def _marks_field(verbose_name, **kwargs):
    return models.DecimalField(
        verbose_name, max_digits=MARKS_DIGITS, decimal_places=MARKS_DECIMALS, **kwargs
    )


class ExamAttempt(TimeStampedModel):
    public_id = models.UUIDField(_("public ID"), default=uuid.uuid4, unique=True, editable=False)
    exam = models.ForeignKey(
        Exam, verbose_name=_("exam"), on_delete=models.PROTECT, related_name="attempts"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name=_("user"),
        on_delete=models.PROTECT,
        related_name="exam_attempts",
    )
    attempt_no = models.PositiveIntegerField(_("attempt number"), validators=[MinValueValidator(1)])
    status = models.CharField(
        _("status"),
        max_length=20,
        choices=AttemptStatus.choices,
        default=AttemptStatus.IN_PROGRESS,
        editable=False,
    )
    started_at = models.DateTimeField(_("started at"))
    deadline_at = models.DateTimeField(_("deadline"))
    submitted_at = models.DateTimeField(_("submitted at"), null=True, blank=True)
    submit_source = models.CharField(
        _("submitted by"), max_length=20, choices=SubmitSource.choices, blank=True
    )
    # App version / platform for support; small, validated in the serializer.
    client_info = models.JSONField(_("client info"), default=dict, blank=True)
    # Language shown in the exam room (display only; scoring is language-independent).
    content_language = models.CharField(
        _("content language"), max_length=5, choices=AttemptLanguage.choices
    )
    # Last accepted submit Idempotency-Key (traceability; submit is idempotent anyway).
    idempotency_key = models.CharField(
        _("idempotency key"), max_length=IDEMPOTENCY_KEY_MAX_LENGTH, blank=True
    )

    class Meta:
        verbose_name = _("exam attempt")
        verbose_name_plural = _("exam attempts")
        ordering = ("-started_at", "-id")
        constraints = [
            models.UniqueConstraint(
                fields=["exam", "user", "attempt_no"], name="attempts_attempt_no_unique"
            ),
            # Only one open attempt per student per exam (no double start from 2 devices).
            models.UniqueConstraint(
                fields=["exam", "user"],
                condition=models.Q(status=AttemptStatus.IN_PROGRESS),
                name="attempts_one_in_progress",
            ),
            models.CheckConstraint(
                condition=models.Q(attempt_no__gte=1), name="attempts_attempt_no_positive"
            ),
            models.CheckConstraint(
                condition=models.Q(deadline_at__gt=models.F("started_at")),
                name="attempts_deadline_after_start",
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=AttemptStatus.values)
                & models.Q(submit_source__in=[*SubmitSource.values, ""])
                & models.Q(content_language__in=AttemptLanguage.values),
                name="attempts_choices_valid",
            ),
            # In progress ⇔ not submitted; finished ⇔ submitted_at and source are set.
            models.CheckConstraint(
                condition=(
                    models.Q(
                        status=AttemptStatus.IN_PROGRESS,
                        submitted_at__isnull=True,
                        submit_source="",
                    )
                    | (
                        models.Q(status__in=FINISHED_STATUSES, submitted_at__isnull=False)
                        & ~models.Q(submit_source="")
                    )
                ),
                name="attempts_submission_consistent",
            ),
            models.CheckConstraint(
                condition=~models.Q(status=AttemptStatus.AUTO_SUBMITTED)
                | models.Q(submit_source=SubmitSource.SERVER_AUTO),
                name="attempts_auto_submit_source",
            ),
        ]
        indexes = [
            models.Index(fields=["status", "deadline_at"], name="attempts_status_deadline_idx"),
            models.Index(fields=["user", "exam"], name="attempts_user_exam_idx"),
        ]

    def __str__(self) -> str:
        return f"attempt {self.public_id} · exam #{self.exam_id} · user #{self.user_id}"

    @property
    def is_finished(self) -> bool:
        return self.status in FINISHED_STATUSES


class AttemptAnswer(TimeStampedModel):
    attempt = models.ForeignKey(
        ExamAttempt, verbose_name=_("attempt"), on_delete=models.CASCADE, related_name="answers"
    )
    question = models.ForeignKey(
        Question, verbose_name=_("question"), on_delete=models.PROTECT, related_name="+"
    )
    display_order = models.PositiveIntegerField(_("display order"))
    # Option IDs in the order shown to this student (fixed at start).
    option_order = models.JSONField(_("option order"))
    marks = _marks_field(_("marks"))  # snapshot at start
    negative_marks = _marks_field(_("negative marks"))  # snapshot at start
    selected_option = models.ForeignKey(
        QuestionOption,
        verbose_name=_("selected option"),
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="+",
    )
    is_marked_for_review = models.BooleanField(_("marked for review"), default=False)
    answered_at = models.DateTimeField(_("answered at"), null=True, blank=True)  # server time
    # Device time of the change: only orders retried saves, never used for timing.
    client_saved_at = models.DateTimeField(_("saved on device at"), null=True, blank=True)
    # Filled only by scoring (results milestone).
    is_correct = models.BooleanField(_("correct"), null=True, blank=True)
    awarded_marks = _marks_field(_("awarded marks"), null=True, blank=True)

    class Meta:
        verbose_name = _("attempt answer")
        verbose_name_plural = _("attempt answers")
        ordering = ("display_order", "id")
        constraints = [
            models.UniqueConstraint(
                fields=["attempt", "question"], name="attempts_answer_question_once"
            ),
            models.UniqueConstraint(
                fields=["attempt", "display_order"], name="attempts_answer_order_unique"
            ),
            models.CheckConstraint(
                condition=models.Q(marks__gt=0) & models.Q(negative_marks__gte=0),
                name="attempts_answer_marks_valid",
            ),
        ]

    def __str__(self) -> str:
        return f"attempt #{self.attempt_id} · question #{self.question_id}"
