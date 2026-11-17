"""Sample participants: invented examinees an admin can add to an exam so a new exam does not look
empty.

They are **never real and never presented as real**. By design:

- they live in their own tables and touch nothing else: no user account, no attempt, no result, no
  merit position, no payment, no statistic, no real leaderboard row (every real query ignores them);
- every place that shows them says "sample participant", shows them in a separate block with no
  rank, and counts them apart from real students ("120 students + 30 sample participants");
- the admin controls who they are (a reusable library of names) and each one's marks in each exam.
"""

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.cms.models import normalize_line
from apps.core.models import TimeStampedModel
from apps.exams.models import Exam

NAME_MAX_LENGTH = 120
MAX_ENTRIES_PER_EXAM = 500
MAX_NAMES_PER_BATCH = 200
NAME_REQUIRED_MESSAGE = _("Enter a name.")


class SamplePerson(TimeStampedModel):
    """One reusable sample participant: just a display name."""

    name = models.CharField(_("name"), max_length=NAME_MAX_LENGTH)
    is_active = models.BooleanField(_("active"), default=True)

    AUDIT_VALUE_FIELDS = ("name", "is_active")

    class Meta:
        verbose_name = _("sample participant")
        verbose_name_plural = _("sample participants")
        ordering = ("name", "id")
        constraints = [
            models.CheckConstraint(condition=models.Q(name__gt=""), name="simulation_person_name"),
        ]

    def __str__(self) -> str:
        return self.name

    def clean_fields(self, exclude=None):
        self.name = normalize_line(self.name)
        super().clean_fields(exclude=exclude)

    def clean(self):
        super().clean()
        if not self.name:
            raise ValidationError({"name": ValidationError(NAME_REQUIRED_MESSAGE, code="required")})


class SampleEntry(TimeStampedModel):
    """A sample participant taking part in one exam, with the marks the admin gave them."""

    exam = models.ForeignKey(
        Exam, verbose_name=_("exam"), on_delete=models.CASCADE, related_name="sample_entries"
    )
    person = models.ForeignKey(
        SamplePerson,
        verbose_name=_("sample participant"),
        on_delete=models.PROTECT,
        related_name="entries",
    )
    marks = models.DecimalField(
        _("marks"),
        max_digits=8,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0"))],
    )

    class Meta:
        verbose_name = _("sample entry")
        verbose_name_plural = _("sample entries")
        ordering = ("-marks", "person__name", "id")
        constraints = [
            models.UniqueConstraint(fields=["exam", "person"], name="simulation_entry_unique"),
            models.CheckConstraint(condition=models.Q(marks__gte=0), name="simulation_entry_marks"),
        ]

    def __str__(self) -> str:
        return f"{self.person} · {self.exam_id}: {self.marks}"
