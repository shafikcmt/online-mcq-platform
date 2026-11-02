from django.conf import settings
from django.contrib.auth.base_user import AbstractBaseUser
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from apps.core.i18n import normalize_text
from apps.core.models import TimeStampedModel

from .fields import MobileNumberField
from .managers import UserManager

LANGUAGE_CODES = [code for code, _name in settings.LANGUAGES]


class Role(models.TextChoices):
    """Phase-1 roles. Future staff roles (e.g. question editor) are added here."""

    STUDENT = "student", _("Student")
    ADMIN = "admin", _("Admin")


def default_language() -> str:
    """Platform default language (Bangla) — configurable via DEFAULT_LANGUAGE."""
    return settings.LANGUAGE_CODE


def normalize_email(value):
    """Lower-case and trim; empty values become ``None`` (so uniqueness ignores them)."""
    if value is None:
        return None
    value = value.strip().lower()
    return value or None


class User(AbstractBaseUser, PermissionsMixin):
    mobile_number = MobileNumberField(
        _("mobile number"),
        unique=True,
        help_text=_("Bangladeshi mobile number. Used to log in."),
        error_messages={"unique": _("A user with this mobile number already exists.")},
    )
    # NULL (not "") when absent, so the partial unique index only covers real addresses.
    email = models.EmailField(_("email address"), blank=True, null=True)  # noqa: DJ001
    full_name = models.CharField(_("full name"), max_length=150)
    role = models.CharField(
        _("role"), max_length=20, choices=Role.choices, default=Role.STUDENT, db_index=True
    )
    preferred_language = models.CharField(
        _("preferred language"),
        max_length=5,
        choices=settings.LANGUAGES,
        default=default_language,
    )
    is_active = models.BooleanField(
        _("active"),
        default=True,
        help_text=_("Inactive users cannot log in. Deactivate instead of deleting."),
    )
    is_mobile_verified = models.BooleanField(
        _("mobile verified"),
        default=False,
        help_text=_("Set only by the registration / account flow after OTP verification."),
    )
    # Incremented on password reset/change: every JWT carries the value it was issued
    # with, so all existing access AND refresh tokens stop working immediately.
    auth_version = models.PositiveIntegerField(_("authentication version"), default=1)
    is_staff = models.BooleanField(
        _("staff status"),
        default=False,
        help_text=_("Allows logging in to the internal Django administration."),
    )
    date_joined = models.DateTimeField(_("date joined"), default=timezone.now)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    objects = UserManager()

    USERNAME_FIELD = "mobile_number"
    EMAIL_FIELD = "email"
    REQUIRED_FIELDS = ["full_name"]  # asked by `createsuperuser` (besides mobile number)

    class Meta:
        verbose_name = _("user")
        verbose_name_plural = _("users")
        constraints = [
            models.UniqueConstraint(
                Lower("email"),
                condition=models.Q(email__isnull=False),
                name="accounts_user_email_unique_ci",
                violation_error_message=_("A user with this email address already exists."),
            ),
            models.CheckConstraint(
                condition=models.Q(role__in=Role.values),
                name="accounts_user_role_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(preferred_language__in=LANGUAGE_CODES),
                name="accounts_user_language_valid",
            ),
            # Last line of defence: only E.164-formatted numbers reach the table.
            models.CheckConstraint(
                condition=models.Q(mobile_number__regex=r"^\+[1-9][0-9]{7,14}$"),
                name="accounts_user_mobile_e164",
            ),
        ]

    def __str__(self) -> str:
        return self.mobile_number

    def clean_fields(self, exclude=None):
        # Normalize before field validation so "  Student@Example.COM " is accepted.
        self.email = normalize_email(self.email)
        self.full_name = normalize_text(self.full_name or "")
        super().clean_fields(exclude=exclude)

    def save(self, *args, **kwargs):
        # Keep data consistent even when code saves without calling full_clean().
        self.email = normalize_email(self.email)
        self.full_name = normalize_text(self.full_name or "")
        super().save(*args, **kwargs)

    @property
    def is_student(self) -> bool:
        return self.role == Role.STUDENT

    @property
    def is_admin(self) -> bool:
        return self.role == Role.ADMIN

    def get_full_name(self) -> str:
        return self.full_name

    def get_short_name(self) -> str:
        return self.full_name

    def ensure_student_profile(self):
        """Create the StudentProfile for students if it does not exist yet."""
        if self.is_student:
            StudentProfile.objects.get_or_create(user=self)


class StudentProfile(TimeStampedModel):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="student_profile",
        verbose_name=_("user"),
    )
    display_name = models.CharField(
        _("display name"),
        max_length=60,
        blank=True,
        help_text=_("Optional public nickname shown on leaderboards when enabled."),
    )

    class Meta:
        verbose_name = _("student profile")
        verbose_name_plural = _("student profiles")

    def __str__(self) -> str:
        return str(self.user)

    def save(self, *args, **kwargs):
        self.display_name = normalize_text(self.display_name or "")
        super().save(*args, **kwargs)
