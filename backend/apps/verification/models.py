"""OTP codes and single-use verification tokens.

This module does not depend on ``accounts``: an OTP can exist before any user
does (registration), and the module never reveals whether an account exists.
"""

from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.core.models import TimeStampedModel

LANGUAGE_CODES = [code for code, _name in settings.LANGUAGES]
E164 = r"^\+[1-9][0-9]{7,14}$"


class OtpPurpose(models.TextChoices):
    REGISTRATION = "registration", _("Registration")
    PASSWORD_RESET = "password_reset", _("Password reset")


class OtpCode(TimeStampedModel):
    """One requested code. ``created_at`` is the request time.

    Only an HMAC of the code is stored (see ``hashing.py``) — never the code itself.
    The code is generated inside the SMS worker (``tasks.send_otp_sms``), so
    ``otp_hash`` is empty until the worker runs and the plaintext never passes through
    the web process, the database or the Celery broker.
    """

    mobile_number = models.CharField(_("mobile number"), max_length=20)
    purpose = models.CharField(_("purpose"), max_length=32, choices=OtpPurpose.choices)
    otp_hash = models.CharField(_("OTP hash"), max_length=64, blank=True, default="")
    language = models.CharField(_("language"), max_length=5, choices=settings.LANGUAGES)
    expires_at = models.DateTimeField(_("expires at"))
    used_at = models.DateTimeField(_("used at"), null=True, blank=True)
    # Set when a newer code is issued for the same number + purpose (only the latest works).
    invalidated_at = models.DateTimeField(_("invalidated at"), null=True, blank=True)
    failed_attempts = models.PositiveSmallIntegerField(_("failed attempts"), default=0)
    request_ip = models.GenericIPAddressField(_("request IP"), null=True, blank=True)

    class Meta:
        verbose_name = _("OTP code")
        verbose_name_plural = _("OTP codes")
        indexes = [
            models.Index(
                fields=["mobile_number", "purpose", "-created_at"],
                name="verif_otp_latest_idx",
            ),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(purpose__in=OtpPurpose.values),
                name="verif_otp_purpose_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(language__in=LANGUAGE_CODES),
                name="verif_otp_language_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(mobile_number__regex=E164),
                name="verif_otp_mobile_e164",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.get_purpose_display()} OTP #{self.pk}"


class VerificationToken(TimeStampedModel):
    """Proof that a mobile number passed OTP verification for one purpose.

    Returned to the client once; only its SHA-256 hash is stored. It is short-lived,
    single-use and NOT a login token. Milestone 2C registration / password reset
    consume it via ``services.consume_verification_token``.
    """

    token_hash = models.CharField(_("token hash"), max_length=64, unique=True)
    mobile_number = models.CharField(_("mobile number"), max_length=20)
    purpose = models.CharField(_("purpose"), max_length=32, choices=OtpPurpose.choices)
    otp = models.OneToOneField(
        OtpCode,
        on_delete=models.CASCADE,
        related_name="verification_token",
        verbose_name=_("OTP code"),
    )
    expires_at = models.DateTimeField(_("expires at"))
    used_at = models.DateTimeField(_("used at"), null=True, blank=True)

    class Meta:
        verbose_name = _("verification token")
        verbose_name_plural = _("verification tokens")
        constraints = [
            models.CheckConstraint(
                condition=models.Q(purpose__in=OtpPurpose.values),
                name="verif_token_purpose_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(mobile_number__regex=E164),
                name="verif_token_mobile_e164",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.get_purpose_display()} token #{self.pk}"
