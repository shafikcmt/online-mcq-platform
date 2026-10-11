"""Question bank: Subject → many Questions → options (docs/DATABASE_DESIGN.md §4.4).

- Phase-1 is single-answer MCQ: every question has ``QUESTION_MIN_OPTIONS`` to
  ``QUESTION_MAX_OPTIONS`` options and **exactly one** correct option. The service layer
  guarantees "exactly one" for every write; the database guarantees "at most one"
  (partial unique constraint) as the last guard.
- Text is bilingual plain text (``text_bn`` / ``text_en``): NFC-normalized, control
  characters removed. At least one language must contain meaningful text; every option
  must cover the question's languages. Clients render it escaped — never as HTML.
- ``is_correct`` and ``explanation_*`` are answer data: only admin serializers include
  them; student serializers (Milestone 4) must list safe fields explicitly.
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxLengthValidator
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.catalog.models import Subject
from apps.core.i18n import clean_multiline, has_meaningful_text
from apps.core.models import TimeStampedModel

QUESTION_TEXT_MAX_LENGTH = 5000
EXPLANATION_MAX_LENGTH = 5000
OPTION_TEXT_MAX_LENGTH = 1000
LANGUAGES = ("bn", "en")

TEXT_REQUIRED_MESSAGE = _("Enter the question in Bangla or English (at least one is required).")
OPTION_TEXT_REQUIRED_MESSAGE = _("Enter the option in Bangla or English.")


def normalize_content(value: str | None) -> str:
    """Plain text; text without any letter, digit or symbol counts as empty."""
    text = clean_multiline(value)
    return text if has_meaningful_text(text, allow_symbols=True) else ""


class Difficulty(models.TextChoices):
    EASY = "easy", _("Easy")
    MEDIUM = "medium", _("Medium")
    HARD = "hard", _("Hard")


class AvailableLanguages(models.TextChoices):
    BANGLA = "bn", _("Bangla")
    ENGLISH = "en", _("English")
    BOTH = "both", _("Bangla and English")


def languages_of(obj) -> set[str]:
    return {lang for lang in LANGUAGES if getattr(obj, f"text_{lang}")}


def available_languages_for(languages: set[str]) -> str:
    if languages == {"bn", "en"}:
        return AvailableLanguages.BOTH
    return AvailableLanguages.BANGLA if "bn" in languages else AvailableLanguages.ENGLISH


class Question(TimeStampedModel):
    subject = models.ForeignKey(
        Subject,
        verbose_name=_("subject"),
        # A subject that still has questions cannot be deleted (catalog → 409 in_use).
        on_delete=models.PROTECT,
        related_name="questions",
    )
    text_bn = models.TextField(
        _("question (Bangla)"),
        blank=True,
        validators=[MaxLengthValidator(QUESTION_TEXT_MAX_LENGTH)],
    )
    text_en = models.TextField(
        _("question (English)"),
        blank=True,
        validators=[MaxLengthValidator(QUESTION_TEXT_MAX_LENGTH)],
    )
    explanation_bn = models.TextField(
        _("explanation (Bangla)"),
        blank=True,
        validators=[MaxLengthValidator(EXPLANATION_MAX_LENGTH)],
    )
    explanation_en = models.TextField(
        _("explanation (English)"),
        blank=True,
        validators=[MaxLengthValidator(EXPLANATION_MAX_LENGTH)],
    )
    # Optional: empty = not set (docs/DATABASE_DESIGN.md §4.4).
    difficulty = models.CharField(
        _("difficulty"), max_length=10, choices=Difficulty.choices, blank=True, default=""
    )
    # Stored file name is random (see services.process_image); language-neutral.
    image = models.ImageField(_("image"), upload_to="questions/", blank=True)
    available_languages = models.CharField(
        _("available languages"),
        max_length=5,
        choices=AvailableLanguages.choices,
        editable=False,
        db_index=True,
    )
    is_active = models.BooleanField(_("active"), default=True, db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name=_("created by"),
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    # Audit allow-lists: short values that may be stored, and fields recorded only as
    # "changed" (their content never enters the audit log).
    AUDIT_VALUE_FIELDS = (
        "subject_id",
        "difficulty",
        "is_active",
        "available_languages",
        "option_count",
    )
    AUDIT_PRESENCE_FIELDS = (
        "text_bn",
        "text_en",
        "explanation_bn",
        "explanation_en",
        "image",
        "options",
        "correct_option",
    )

    class Meta:
        verbose_name = _("question")
        verbose_name_plural = _("questions")
        ordering = ("-created_at", "-id")
        constraints = [
            models.CheckConstraint(
                condition=models.Q(text_bn__gt="") | models.Q(text_en__gt=""),
                name="questions_question_text_required",
                violation_error_message=TEXT_REQUIRED_MESSAGE,
            ),
            models.CheckConstraint(
                condition=models.Q(difficulty__in=["", *Difficulty.values]),
                name="questions_question_difficulty_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(available_languages__in=AvailableLanguages.values),
                name="questions_question_languages_valid",
            ),
        ]
        indexes = [
            models.Index(fields=["subject", "is_active"], name="questions_subject_active_idx"),
            models.Index(fields=["difficulty"], name="questions_difficulty_idx"),
        ]

    def __str__(self) -> str:
        return f"#{self.pk}" if self.pk else "new question"

    def normalize(self) -> None:
        for field in ("text_bn", "text_en"):
            setattr(self, field, normalize_content(getattr(self, field)))
        for field in ("explanation_bn", "explanation_en"):
            setattr(self, field, normalize_content(getattr(self, field)))
        self.difficulty = self.difficulty or ""
        languages = languages_of(self)
        if languages:
            self.available_languages = available_languages_for(languages)

    def clean_fields(self, exclude=None):
        self.normalize()
        super().clean_fields(exclude=exclude)

    def clean(self):
        super().clean()
        if not languages_of(self):
            message = ValidationError(TEXT_REQUIRED_MESSAGE, code="text_required")
            raise ValidationError({"text_bn": message, "text_en": message})

    def save(self, *args, **kwargs):
        self.normalize()
        super().save(*args, **kwargs)


class QuestionOption(TimeStampedModel):
    question = models.ForeignKey(
        Question,
        verbose_name=_("question"),
        on_delete=models.CASCADE,  # options belong to their question
        related_name="options",
    )
    text_bn = models.TextField(
        _("option (Bangla)"), blank=True, validators=[MaxLengthValidator(OPTION_TEXT_MAX_LENGTH)]
    )
    text_en = models.TextField(
        _("option (English)"), blank=True, validators=[MaxLengthValidator(OPTION_TEXT_MAX_LENGTH)]
    )
    # Answer data: never serialized to students before submission.
    is_correct = models.BooleanField(_("correct"), default=False)
    sort_order = models.PositiveSmallIntegerField(_("sort order"), default=0)  # CHECK >= 0

    class Meta:
        verbose_name = _("option")
        verbose_name_plural = _("options")
        ordering = ("sort_order", "id")
        constraints = [
            # Database guarantee: at most one correct option per question.
            models.UniqueConstraint(
                fields=["question"],
                condition=models.Q(is_correct=True),
                name="questions_option_one_correct",
            ),
            models.UniqueConstraint(
                fields=["question", "sort_order"], name="questions_option_order_unique"
            ),
            models.CheckConstraint(
                condition=models.Q(text_bn__gt="") | models.Q(text_en__gt=""),
                name="questions_option_text_required",
                violation_error_message=OPTION_TEXT_REQUIRED_MESSAGE,
            ),
        ]

    def __str__(self) -> str:
        return f"option {self.sort_order} of question #{self.question_id}"

    def normalize(self) -> None:
        self.text_bn = normalize_content(self.text_bn)
        self.text_en = normalize_content(self.text_en)

    def save(self, *args, **kwargs):
        self.normalize()
        super().save(*args, **kwargs)
