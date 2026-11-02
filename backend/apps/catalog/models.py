"""Academic structure: Category → many Subjects (docs/DATABASE_DESIGN.md §4.3).

Bilingual content follows the paired-column convention (``name_bn`` / ``name_en``):
at least one name is required (model validation + database CHECK); the other language
falls back when shown to students (docs/LOCALIZATION.md §3.3). Descriptions are
optional plain text — clients must render them escaped (no HTML is accepted as markup).

Text is normalized on every save (NFC, trimmed; names also collapse inner whitespace),
so admin, API and shell writes are stored the same way.
"""

from django.core.exceptions import ValidationError
from django.core.validators import MaxLengthValidator, RegexValidator
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.core.i18n import (
    clean_multiline,
    clean_single_line,
    has_meaningful_text,
    normalize_digits,
    normalize_text,
)
from apps.core.models import TimeStampedModel

NAME_MAX_LENGTH = 120
SLUG_MAX_LENGTH = 140
DESCRIPTION_MAX_LENGTH = 2000
SLUG_REGEX = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"

NAME_REQUIRED_MESSAGE = _("Enter a name in Bangla or English (at least one is required).")
SLUG_INVALID_MESSAGE = _(
    "Use only lowercase English letters, digits and single hyphens (for example: physics-1)."
)
CATEGORY_SLUG_TAKEN_MESSAGE = _("A category with this slug already exists.")
SUBJECT_SLUG_TAKEN_MESSAGE = _("This category already has a subject with this slug.")

slug_validator = RegexValidator(SLUG_REGEX, SLUG_INVALID_MESSAGE, code="invalid_slug")


def normalize_name(value: str | None) -> str:
    """Single line; a name without any letter or digit (e.g. only invisible characters
    or punctuation) counts as empty."""
    text = clean_single_line(value)
    return text if has_meaningful_text(text) else ""


def normalize_description(value: str | None) -> str:
    return clean_multiline(value)


def normalize_slug(value: str | None) -> str:
    return normalize_digits(normalize_text(value or "")).lower()


class CatalogEntry(TimeStampedModel):
    """Fields and rules shared by Category and Subject."""

    name_bn = models.CharField(_("name (Bangla)"), max_length=NAME_MAX_LENGTH, blank=True)
    name_en = models.CharField(_("name (English)"), max_length=NAME_MAX_LENGTH, blank=True)
    description_bn = models.TextField(
        _("description (Bangla)"),
        blank=True,
        validators=[MaxLengthValidator(DESCRIPTION_MAX_LENGTH)],
    )
    description_en = models.TextField(
        _("description (English)"),
        blank=True,
        validators=[MaxLengthValidator(DESCRIPTION_MAX_LENGTH)],
    )
    is_active = models.BooleanField(_("active"), default=True, db_index=True)
    sort_order = models.PositiveIntegerField(_("sort order"), default=0)  # CHECK >= 0

    class Meta:
        abstract = True

    # Values worth keeping in the audit log (short identity fields); long text fields
    # are recorded as "changed" only.
    AUDIT_VALUE_FIELDS: tuple[str, ...] = ("name_bn", "name_en", "slug", "is_active", "sort_order")
    AUDIT_PRESENCE_FIELDS: tuple[str, ...] = ("description_bn", "description_en")

    def __str__(self) -> str:
        return self.name_en or self.name_bn or self.slug

    def normalize(self) -> None:
        self.name_bn = normalize_name(self.name_bn)
        self.name_en = normalize_name(self.name_en)
        self.description_bn = normalize_description(self.description_bn)
        self.description_en = normalize_description(self.description_en)
        self.slug = normalize_slug(self.slug)

    def clean_fields(self, exclude=None):
        self.normalize()
        super().clean_fields(exclude=exclude)

    def clean(self):
        super().clean()
        if not self.name_bn and not self.name_en:
            raise ValidationError(
                {
                    "name_bn": ValidationError(NAME_REQUIRED_MESSAGE, code="name_required"),
                    "name_en": ValidationError(NAME_REQUIRED_MESSAGE, code="name_required"),
                }
            )

    def save(self, *args, **kwargs):
        self.normalize()
        super().save(*args, **kwargs)


def _name_present():
    return models.Q(name_bn__gt="") | models.Q(name_en__gt="")


class Category(CatalogEntry):
    slug = models.CharField(
        _("slug"),
        max_length=SLUG_MAX_LENGTH,
        unique=True,
        validators=[slug_validator],
        error_messages={"unique": CATEGORY_SLUG_TAKEN_MESSAGE},
        help_text=_("Used in web addresses. Generated from the English name if left empty."),
    )

    class Meta:
        verbose_name = _("category")
        verbose_name_plural = _("categories")
        ordering = ("sort_order", "id")
        constraints = [
            models.CheckConstraint(
                condition=_name_present(),
                name="catalog_category_name_required",
                violation_error_message=NAME_REQUIRED_MESSAGE,
            ),
            models.CheckConstraint(
                condition=models.Q(slug__regex=SLUG_REGEX),
                name="catalog_category_slug_format",
                violation_error_message=SLUG_INVALID_MESSAGE,
            ),
        ]
        indexes = [models.Index(fields=["is_active", "sort_order"], name="catalog_cat_active_idx")]


class Subject(CatalogEntry):
    category = models.ForeignKey(
        Category,
        verbose_name=_("category"),
        # A category that still has subjects cannot be deleted (no accidental cascade).
        on_delete=models.PROTECT,
        related_name="subjects",
    )
    slug = models.CharField(
        _("slug"),
        max_length=SLUG_MAX_LENGTH,
        validators=[slug_validator],
        help_text=_(
            "Used in web addresses; unique within the category. "
            "Generated from the English name if left empty."
        ),
    )

    AUDIT_VALUE_FIELDS = (*CatalogEntry.AUDIT_VALUE_FIELDS, "category_id")

    def clean(self):
        super().clean()
        # Report a duplicate slug on the "slug" field (the database constraint is the
        # final guard against races).
        if self.category_id and self.slug:
            duplicate = Subject.objects.filter(category_id=self.category_id, slug=self.slug)
            if self.pk:
                duplicate = duplicate.exclude(pk=self.pk)
            if duplicate.exists():
                raise ValidationError(
                    {"slug": ValidationError(SUBJECT_SLUG_TAKEN_MESSAGE, code="slug_taken")}
                )

    class Meta:
        verbose_name = _("subject")
        verbose_name_plural = _("subjects")
        ordering = ("sort_order", "id")
        constraints = [
            models.UniqueConstraint(
                fields=["category", "slug"],
                name="catalog_subject_category_slug_unique",
                violation_error_message=SUBJECT_SLUG_TAKEN_MESSAGE,
            ),
            models.CheckConstraint(
                condition=_name_present(),
                name="catalog_subject_name_required",
                violation_error_message=NAME_REQUIRED_MESSAGE,
            ),
            models.CheckConstraint(
                condition=models.Q(slug__regex=SLUG_REGEX),
                name="catalog_subject_slug_format",
                violation_error_message=SLUG_INVALID_MESSAGE,
            ),
        ]
        indexes = [
            models.Index(
                fields=["category", "is_active", "sort_order"], name="catalog_subj_cat_active_idx"
            )
        ]
