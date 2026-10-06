"""Translate service-layer errors into the standard API error format."""

from django.utils.translation import gettext_lazy as _
from rest_framework import status

from apps.core.exceptions import ApiError
from apps.verification import exceptions as verification

from ..exceptions import AccountError, AccountExists, InvalidCredentials

VERIFICATION_STATUS = {
    verification.InvalidMobileNumber: status.HTTP_400_BAD_REQUEST,
    verification.OtpRateLimited: status.HTTP_429_TOO_MANY_REQUESTS,
    verification.OtpResendCooldown: status.HTTP_429_TOO_MANY_REQUESTS,
    verification.OtpServiceUnavailable: status.HTTP_503_SERVICE_UNAVAILABLE,
    verification.OtpInvalid: status.HTTP_400_BAD_REQUEST,
    verification.OtpExpired: status.HTTP_400_BAD_REQUEST,
    verification.OtpLocked: status.HTTP_400_BAD_REQUEST,
    verification.VerificationTokenInvalid: status.HTTP_400_BAD_REQUEST,
}

# Password-reset codes: one generic answer, so nobody can learn whether an account
# exists by watching for "expired"/"locked" or an attempts counter.
GENERIC_RESET_OTP_MESSAGE = _("The code is incorrect or has expired. Request a new code if needed.")


def from_verification_error(exc: verification.VerificationError, *, generic: bool = False):
    if generic and isinstance(
        exc, verification.OtpInvalid | verification.OtpExpired | verification.OtpLocked
    ):
        return ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code=verification.OtpInvalid.code,
            message=GENERIC_RESET_OTP_MESSAGE,
        )
    details = {}
    if exc.retry_after:
        details["retry_after"] = int(exc.retry_after)
    if exc.attempts_remaining is not None:
        details["attempts_remaining"] = exc.attempts_remaining
    return ApiError(
        status_code=VERIFICATION_STATUS.get(type(exc), status.HTTP_400_BAD_REQUEST),
        code=exc.code,
        message=str(exc.message),
        details=details,
        retry_after=exc.retry_after,
    )


def from_account_error(exc: AccountError):
    if isinstance(exc, InvalidCredentials):
        status_code = status.HTTP_401_UNAUTHORIZED
    elif isinstance(exc, AccountExists):
        status_code = status.HTTP_409_CONFLICT
    else:
        status_code = status.HTTP_400_BAD_REQUEST
    field_errors = {exc.field: [str(exc.message)]} if exc.field else {}
    return ApiError(
        status_code=status_code,
        code=exc.code,
        message=str(exc.message),
        field_errors=field_errors,
    )
