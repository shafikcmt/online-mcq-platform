import logging

from celery import shared_task

from apps.core.phone import mask_mobile
from apps.verification.models import OtpPurpose
from apps.verification.services import issue_otp

from .services import active_student_exists

logger = logging.getLogger(__name__)


@shared_task
def deliver_password_reset_otp(
    mobile_number: str, language: str, request_ip: str | None = None
) -> str:
    """Issue a password-reset code only if an active student owns the number.

    Runs in the worker so that the web request does exactly the same work for real
    and unknown numbers (abuse checks + one queued task): response time, status, body
    and headers reveal nothing about whether an account exists. Unknown numbers leave
    no record and receive no SMS.
    """
    if not active_student_exists(mobile_number):
        logger.info(
            "Password reset code not issued (no eligible account) to=%s", mask_mobile(mobile_number)
        )
        return "skipped"
    issue_otp(mobile_number, OtpPurpose.PASSWORD_RESET, language=language, request_ip=request_ip)
    return "issued"
