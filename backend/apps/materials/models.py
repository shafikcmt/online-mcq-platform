"""Study materials: YouTube videos and PDF handouts, grouped by category, subject, exam and teacher.

- A **video** stores only the 11-character YouTube ID parsed from the link the admin pastes.
  Clients build the embed or watch address from that ID themselves, so a stored value can never
  smuggle in another host, a script or extra player parameters. Only public or unlisted videos can
  be shown: a *private* YouTube video cannot be embedded or opened by students at all.
- A **PDF** is checked and stored by ``core.documents`` (no active content, random stored name) and
  served only by the API.
- Materials are visible to everybody once published (``published_at`` set and not in the future);
  ``null`` means draft. Paid gating is deliberately not built (it needs an owner decision).
"""

import re
from urllib.parse import parse_qs, urlparse

from django.core.exceptions import ValidationError
from django.core.validators import MaxLengthValidator
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.catalog.models import Category, Subject
from apps.cms.models import (
    LANGUAGES,
    normalize_body,
    normalize_line,
)
from apps.core.models import TimeStampedModel
from apps.exams.models import Exam

TITLE_MAX_LENGTH = 200
DESCRIPTION_MAX_LENGTH = 2000
TEACHER_MAX_LENGTH = 100
YOUTUBE_ID_LENGTH = 11

YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
YOUTUBE_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
}
YOUTUBE_SHORT_HOST = "youtu.be"
YOUTUBE_PATH_PREFIXES = ("embed", "shorts", "live", "v")

YOUTUBE_INVALID_MESSAGE = _(
    "Enter a YouTube video link (for example https://www.youtube.com/watch?v=… or https://youtu.be/…)."
)
VIDEO_NEEDS_LINK_MESSAGE = _("A video needs a YouTube link.")
TITLE_REQUIRED_MESSAGE = _("Enter a title in Bangla or English.")
SUBJECT_CATEGORY_MESSAGE = _("This subject does not belong to the chosen category.")


def parse_youtube_id(value: str | None) -> str:
    """The 11-character video ID from a YouTube link (watch, youtu.be, embed, shorts, live) or a
    bare ID; ``""`` when it is none of those. Only YouTube's own hosts are accepted and the link
    must be ``http(s)`` — nothing else is ever stored."""
    text = (value or "").strip()
    if not text or len(text) > 300 or any(ord(ch) < 32 for ch in text):
        return ""
    if YOUTUBE_ID.fullmatch(text):
        return text
    parsed = urlparse(text if "://" in text else f"https://{text}")
    if parsed.scheme not in ("http", "https") or parsed.username or parsed.password:
        return ""
    host = (parsed.hostname or "").lower()
    candidate = ""
    if host == YOUTUBE_SHORT_HOST:
        candidate = parsed.path.lstrip("/").split("/")[0]
    elif host in YOUTUBE_HOSTS:
        parts = [part for part in parsed.path.split("/") if part]
        if parts[:1] == ["watch"]:
            candidate = (parse_qs(parsed.query).get("v") or [""])[0]
        elif len(parts) >= 2 and parts[0] in YOUTUBE_PATH_PREFIXES:
            candidate = parts[1]
    return candidate if YOUTUBE_ID.fullmatch(candidate) else ""


class MaterialKind(models.TextChoices):
    VIDEO = "video", _("Video (YouTube)")
    PDF = "pdf", _("PDF")


class StudyMaterial(TimeStampedModel):
    kind = models.CharField(_("type"), max_length=10, choices=MaterialKind.choices)
    title_bn = models.CharField(_("title (Bangla)"), max_length=TITLE_MAX_LENGTH, blank=True)
    title_en = models.CharField(_("title (English)"), max_length=TITLE_MAX_LENGTH, blank=True)
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
    youtube_id = models.CharField(_("YouTube video ID"), max_length=YOUTUBE_ID_LENGTH, blank=True)
    pdf = models.FileField(_("PDF"), upload_to="documents/", blank=True)
    pdf_name = models.CharField(_("PDF file name"), max_length=200, blank=True, default="")
    pdf_size = models.PositiveIntegerField(_("PDF size (bytes)"), default=0)
    pdf_sha256 = models.CharField(_("PDF SHA-256"), max_length=64, blank=True, default="")
    category = models.ForeignKey(
        Category,
        verbose_name=_("category"),
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    subject = models.ForeignKey(
        Subject,
        verbose_name=_("subject"),
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    exam = models.ForeignKey(
        Exam,
        verbose_name=_("exam"),
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    teacher = models.CharField(_("teacher"), max_length=TEACHER_MAX_LENGTH, blank=True)
    sort_order = models.PositiveIntegerField(_("order"), default=0)
    # null = draft; visible from published_at on.
    published_at = models.DateTimeField(_("published at"), null=True, blank=True)

    AUDIT_VALUE_FIELDS = ("kind", "title_bn", "title_en", "youtube_id", "teacher", "sort_order")
    AUDIT_DATE_FIELDS = ("published_at",)
    AUDIT_REFERENCE_FIELDS = ("category_id", "subject_id", "exam_id")
    AUDIT_PRESENCE_FIELDS = ("description_bn", "description_en", "pdf")

    class Meta:
        verbose_name = _("study material")
        verbose_name_plural = _("study materials")
        ordering = ("sort_order", "-published_at", "-id")
        constraints = [
            models.CheckConstraint(
                condition=models.Q(kind__in=MaterialKind.values), name="materials_kind_valid"
            ),
            # A video has an ID; a PDF material never has one.
            models.CheckConstraint(
                condition=(models.Q(kind="video") & ~models.Q(youtube_id=""))
                | (models.Q(kind="pdf") & models.Q(youtube_id="")),
                name="materials_kind_matches_content",
            ),
        ]
        indexes = [
            models.Index(fields=["published_at"], name="materials_published_idx"),
            models.Index(fields=["category", "published_at"], name="materials_category_idx"),
        ]

    def __str__(self) -> str:
        return self.title_en or self.title_bn or f"#{self.pk}"

    def normalize(self) -> None:
        for lang in LANGUAGES:
            setattr(self, f"title_{lang}", normalize_line(getattr(self, f"title_{lang}")))
            setattr(
                self, f"description_{lang}", normalize_body(getattr(self, f"description_{lang}"))
            )
        self.teacher = normalize_line(self.teacher)
        self.youtube_id = (self.youtube_id or "").strip()

    def clean_fields(self, exclude=None):
        self.normalize()
        super().clean_fields(exclude=exclude)

    def save(self, *args, **kwargs):
        self.normalize()
        super().save(*args, **kwargs)

    def clean(self):
        super().clean()
        errors = {}
        # A description in one language only is fine; the title must exist in at least one.
        if not (self.title_bn or self.title_en):
            for field in ("title_bn", "title_en"):
                errors[field] = ValidationError(TITLE_REQUIRED_MESSAGE, code="title_required")
        if self.kind == MaterialKind.VIDEO:
            if not self.youtube_id:
                errors["youtube_url"] = ValidationError(
                    VIDEO_NEEDS_LINK_MESSAGE, code="youtube_required"
                )
            elif not YOUTUBE_ID.fullmatch(self.youtube_id):
                errors["youtube_url"] = ValidationError(
                    YOUTUBE_INVALID_MESSAGE, code="youtube_invalid"
                )
        elif self.youtube_id:
            errors["youtube_url"] = ValidationError(YOUTUBE_INVALID_MESSAGE, code="youtube_invalid")
        if self.subject_id and self.category_id and self.subject.category_id != self.category_id:
            errors["subject"] = ValidationError(
                SUBJECT_CATEGORY_MESSAGE, code="subject_category_mismatch"
            )
        if errors:
            raise ValidationError(errors)
