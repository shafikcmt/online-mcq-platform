"""Errors raised by the verification services.

Each has a stable machine ``code`` (for clients/API) and a localized ``message``.
They deliberately reveal nothing about whether an account exists.
"""

from django.utils.translation import gettext_lazy as _


class VerificationError(Exception):
    code = "verification_error"
    default_message = _("Verification failed.")

    def __init__(self, message=None, *, retry_after=None, attempts_remaining=None):
        self.message = message or self.default_message
        self.retry_after = retry_after
        self.attempts_remaining = attempts_remaining
        super().__init__(str(self.code))


class InvalidMobileNumber(VerificationError):
    code = "invalid_mobile"
    default_message = _("Enter a valid Bangladeshi mobile number, for example 01712345678.")


class OtpRateLimited(VerificationError):
    code = "otp_rate_limited"
    default_message = _("Too many code requests. Please try again later.")


class OtpServiceUnavailable(VerificationError):
    """Rate limiting could not be checked (e.g. Redis down) — fail closed."""

    code = "otp_unavailable"
    default_message = _("Codes cannot be sent right now. Please try again shortly.")


class OtpResendCooldown(VerificationError):
    code = "otp_resend_cooldown"
    default_message = _("Please wait before requesting a new code.")


class OtpInvalid(VerificationError):
    code = "otp_invalid"
    default_message = _("The code is incorrect.")


class OtpExpired(VerificationError):
    code = "otp_expired"
    default_message = _("The code has expired. Please request a new one.")


class OtpLocked(VerificationError):
    code = "otp_locked"
    default_message = _("Too many wrong attempts. Please request a new code.")


class VerificationTokenInvalid(VerificationError):
    code = "verification_token_invalid"
    default_message = _("Your verification has expired or is invalid. Please verify again.")
