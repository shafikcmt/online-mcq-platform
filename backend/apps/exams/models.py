"""Exams and their assigned questions (docs/DATABASE_DESIGN.md §4.5).

Lifecycle (``status``): draft → published ⇄ unpublished; draft/unpublished → archived.
Status only changes through ``exams.services`` actions (publish/unpublish/archive),
never through a field update. Only draft and unpublished exams can be edited.

Rules kept by the database as the last guard (services validate first):
- live exams: one attempt, no retake, merit by the first attempt;
- no retake ⇒ ``max_attempts = 1``; ``max_attempts`` is NULL (unlimited) or ≥ 1;
- ``end_at > start_at``; positive duration, question count and marks.
Titles/descriptions/instructions are bilingual plain text (rendered escaped).
"""

import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxLengthValidator, MinValueValidator, RegexValidator
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.catalog.models import SLUG_INVALID_MESSAGE, SLUG_MAX_LENGTH, SLUG_REGEX, Category, Subject
from apps.core.i18n import clean_multiline, clean_single_line, has_meaningful_text
from apps.core.models import TimeStampedModel
from apps.questions.models import Question

TITLE_MAX_LENGTH = 200
TEXT_MAX_LENGTH = 5000
MARKS_DIGITS, MARKS_DECIMALS = 7, 2

TITLE_REQUIRED_MESSAGE = _("Enter a title in Bangla or English (at least one is required).")
EXAM_SLUG_TAKEN_MESSAGE = _("An exam with this slug already exists.")


class ExamType(models.TextChoices):
    PRACTICE = "practice", _("Practice")
    REGULAR = "regular", _("Regular")
    LIVE = "live", _("Live")


class AccessType(models.TextChoices):
    FREE = "free", _("Free")
    PAID = "paid", _("Paid")


class ContentLanguage(models.TextChoices):
    BANGLA = "bn", _("Bangla")
    ENGLISH = "en", _("English")
    BOTH = "both", _("Bangla and English")


class ExamStatus(models.TextChoices):
    DRAFT = "draft", _("Draft")
    PUBLISHED = "published", _("Published")
    UNPUBLISHED = "unpublished", _("Unpublished")
    ARCHIVED = "archived", _("Archived")


class MeritStrategy(models.TextChoices):
    FIRST_ATTEMPT = "first_attempt", _("First attempt")
    BEST_ATTEMPT = "best_attempt", _("Best attempt")
    LATEST_ATTEMPT = "latest_attempt", _("Latest attempt")


class ResultVisibility(models.TextChoices):
    IMMEDIATE = "immediate", _("Immediately after submission")
    AFTER_EXAM_END = "after_exam_end", _("After the exam ends")
    MANUAL = "manual", _("When an admin publishes results")


EDITABLE_STATUSES = (ExamStatus.DRAFT, ExamStatus.UNPUBLISHED)


def normalize_title(value: str | None) -> str:
    text = clean_single_line(value)
    return text if has_meaningful_text(text, allow_symbols=True) else ""


def normalize_long_text(value: str | None) -> str:
    text = clean_multiline(value)
    return text if has_meaningful_text(text, allow_symbols=True) else ""


def _marks_field(verbose_name, **kwargs):
    return models.DecimalField(
        verbose_name, max_digits=MARKS_DIGITS, decimal_places=MARKS_DECIMALS, **kwargs
    )


class Exam(TimeStampedModel):
    public_id = models.UUIDField(_("public ID"), default=uuid.uuid4, unique=True, editable=False)
    title_bn = models.CharField(_("title (Bangla)"), max_length=TITLE_MAX_LENGTH, blank=True)
    title_en = models.CharField(_("title (English)"), max_length=TITLE_MAX_LENGTH, blank=True)
    slug = models.CharField(
        _("slug"),
        max_length=SLUG_MAX_LENGTH,
        unique=True,
        validators=[RegexValidator(SLUG_REGEX, SLUG_INVALID_MESSAGE, code="invalid_slug")],
        error_messages={"unique": EXAM_SLUG_TAKEN_MESSAGE},
    )
    description_bn = models.TextField(
        _("description (Bangla)"), blank=True, validators=[MaxLengthValidator(TEXT_MAX_LENGTH)]
    )
    description_en = models.TextField(
        _("description (English)"), blank=True, validators=[MaxLengthValidator(TEXT_MAX_LENGTH)]
    )
    instructions_bn = models.TextField(
        _("instructions (Bangla)"), blank=True, validators=[MaxLengthValidator(TEXT_MAX_LENGTH)]
    )
    instructions_en = models.TextField(
        _("instructions (English)"), blank=True, validators=[MaxLengthValidator(TEXT_MAX_LENGTH)]
    )
    content_language = models.CharField(
        _("content language"),
        max_length=5,
        choices=ContentLanguage.choices,
        default=ContentLanguage.BANGLA,
    )
    category = models.ForeignKey(
        Category, verbose_name=_("category"), on_delete=models.PROTECT, related_name="exams"
    )
    subject = models.ForeignKey(
        Subject,
        verbose_name=_("subject"),
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="exams",
    )
    exam_type = models.CharField(
        _("exam type"), max_length=10, choices=ExamType.choices, default=ExamType.REGULAR
    )
    # Stored for packages/subscriptions (Milestone 4/5); no access logic yet.
    access_type = models.CharField(
        _("access"), max_length=10, choices=AccessType.choices, default=AccessType.FREE
    )
    status = models.CharField(
        _("status"),
        max_length=12,
        choices=ExamStatus.choices,
        default=ExamStatus.DRAFT,
        editable=False,
    )
    duration_minutes = models.PositiveIntegerField(
        _("duration (minutes)"), validators=[MinValueValidator(1)]
    )
    total_questions = models.PositiveIntegerField(
        _("total questions"), validators=[MinValueValidator(1)]
    )
    default_marks = _marks_field(_("marks per question"), default=1)
    negative_marks = _marks_field(_("negative marks per wrong answer"), default=0)
    pass_marks = _marks_field(_("pass marks"), null=True, blank=True)
    start_at = models.DateTimeField(_("starts at"), null=True, blank=True)
    end_at = models.DateTimeField(_("ends at"), null=True, blank=True)
    shuffle_questions = models.BooleanField(_("shuffle questions"), default=False)
    shuffle_options = models.BooleanField(_("shuffle options"), default=False)
    allow_retake = models.BooleanField(_("allow retake"), default=False)
    max_attempts = models.PositiveIntegerField(
        _("maximum attempts"), null=True, blank=True, default=1
    )
    merit_enabled = models.BooleanField(_("merit list enabled"), default=True)
    merit_strategy = models.CharField(
        _("merit strategy"),
        max_length=20,
        choices=MeritStrategy.choices,
        default=MeritStrategy.FIRST_ATTEMPT,
    )
    result_visibility = models.CharField(
        _("result visibility"),
        max_length=20,
        choices=ResultVisibility.choices,
        default=ResultVisibility.IMMEDIATE,
    )
    allow_answer_review = models.BooleanField(_("allow answer review"), default=True)
    is_featured = models.BooleanField(_("featured"), default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name=_("created by"),
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    questions = models.ManyToManyField(Question, through="ExamQuestion", related_name="exams")

    # Audit allow-lists (see exams.services): values that may be stored, and fields
    # recorded only by name.
    AUDIT_VALUE_FIELDS = (
        "exam_type",
        "status",
        "content_language",
        "access_type",
        "allow_retake",
        "max_attempts",
        "merit_enabled",
        "merit_strategy",
        "result_visibility",
        "question_count",
        "has_schedule",
        "category_id",
        "subject_id",
        "source_exam_id",
    )
    AUDIT_PRESENCE_FIELDS = (
        "title_bn",
        "title_en",
        "slug",
        "description_bn",
        "description_en",
        "instructions_bn",
        "instructions_en",
        "category",
        "subject",
        "duration_minutes",
        "total_questions",
        "default_marks",
        "negative_marks",
        "pass_marks",
        "start_at",
        "end_at",
        "shuffle_questions",
        "shuffle_options",
        "allow_answer_review",
        "is_featured",
        "questions",
    )

    class Meta:
        verbose_name = _("exam")
        verbose_name_plural = _("exams")
        ordering = ("-created_at", "-id")
        constraints = [
            models.CheckConstraint(
                condition=models.Q(title_bn__gt="") | models.Q(title_en__gt=""),
                name="exams_exam_title_required",
                violation_error_message=TITLE_REQUIRED_MESSAGE,
            ),
            models.CheckConstraint(
                condition=models.Q(slug__regex=SLUG_REGEX), name="exams_exam_slug_format"
            ),
            models.CheckConstraint(
                condition=models.Q(duration_minutes__gt=0), name="exams_exam_duration_positive"
            ),
            models.CheckConstraint(
                condition=models.Q(total_questions__gt=0),
                name="exams_exam_total_questions_positive",
            ),
            models.CheckConstraint(
                condition=models.Q(default_marks__gt=0), name="exams_exam_default_marks_positive"
            ),
            models.CheckConstraint(
                condition=models.Q(negative_marks__gte=0), name="exams_exam_negative_marks_valid"
            ),
            models.CheckConstraint(
                condition=models.Q(pass_marks__isnull=True) | models.Q(pass_marks__gte=0),
                name="exams_exam_pass_marks_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(start_at__isnull=True)
                | models.Q(end_at__isnull=True)
                | models.Q(end_at__gt=models.F("start_at")),
                name="exams_exam_schedule_order",
            ),
            models.CheckConstraint(
                condition=models.Q(max_attempts__isnull=True) | models.Q(max_attempts__gte=1),
                name="exams_exam_max_attempts_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(allow_retake=True) | models.Q(max_attempts=1),
                name="exams_exam_no_retake_single_attempt",
            ),
            models.CheckConstraint(
                condition=~models.Q(exam_type=ExamType.LIVE)
                | models.Q(
                    allow_retake=False,
                    max_attempts=1,
                    merit_strategy=MeritStrategy.FIRST_ATTEMPT,
                ),
                name="exams_exam_live_single_attempt",
            ),
            models.CheckConstraint(
                condition=~models.Q(exam_type=ExamType.LIVE)
                | models.Q(status=ExamStatus.DRAFT)
                | models.Q(start_at__isnull=False, end_at__isnull=False),
                name="exams_exam_live_schedule_required",
            ),
            models.CheckConstraint(
                condition=models.Q(exam_type__in=ExamType.values)
                & models.Q(access_type__in=AccessType.values)
                & models.Q(status__in=ExamStatus.values)
                & models.Q(content_language__in=ContentLanguage.values)
                & models.Q(merit_strategy__in=MeritStrategy.values)
                & models.Q(result_visibility__in=ResultVisibility.values),
                name="exams_exam_choices_valid",
            ),
        ]
        indexes = [
            models.Index(fields=["status", "start_at"], name="exams_status_start_idx"),
            models.Index(fields=["category", "status"], name="exams_category_status_idx"),
            models.Index(fields=["access_type"], name="exams_access_type_idx"),
        ]

    def __str__(self) -> str:
        return self.title_en or self.title_bn or self.slug

    @property
    def is_editable(self) -> bool:
        return self.status in EDITABLE_STATUSES

    def clean(self):
        super().clean()
        if not self.title_bn and not self.title_en:
            message = ValidationError(TITLE_REQUIRED_MESSAGE, code="title_required")
            raise ValidationError({"title_bn": message, "title_en": message})

    def clean_fields(self, exclude=None):
        self.normalize()
        super().clean_fields(exclude=exclude)

    def normalize(self) -> None:
        self.title_bn = normalize_title(self.title_bn)
        self.title_en = normalize_title(self.title_en)
        for field in ("description_bn", "description_en", "instructions_bn", "instructions_en"):
            setattr(self, field, normalize_long_text(getattr(self, field)))

    def save(self, *args, **kwargs):
        self.normalize()
        super().save(*args, **kwargs)


class ExamQuestion(TimeStampedModel):
    exam = models.ForeignKey(
        Exam, verbose_name=_("exam"), on_delete=models.CASCADE, related_name="exam_questions"
    )
    # PROTECT: a question used by any exam cannot be deleted (→ 409 in_use).
    question = models.ForeignKey(
        Question, verbose_name=_("question"), on_delete=models.PROTECT, related_name="+"
    )
    sort_order = models.PositiveIntegerField(_("sort order"))
    # Override; NULL = the exam's default_marks.
    marks = _marks_field(_("marks"), null=True, blank=True)

    class Meta:
        verbose_name = _("exam question")
        verbose_name_plural = _("exam questions")
        ordering = ("sort_order", "id")
        constraints = [
            models.UniqueConstraint(fields=["exam", "question"], name="exams_question_once"),
            models.UniqueConstraint(fields=["exam", "sort_order"], name="exams_question_order"),
            models.CheckConstraint(
                condition=models.Q(marks__isnull=True) | models.Q(marks__gt=0),
                name="exams_question_marks_positive",
            ),
        ]

    def __str__(self) -> str:
        return f"exam #{self.exam_id} · question #{self.question_id}"

    @property
    def effective_marks(self):
        return self.marks if self.marks is not None else self.exam.default_marks
