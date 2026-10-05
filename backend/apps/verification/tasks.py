import logging
import math

from celery import shared_task
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.core.phone import mask_mobile

from .hashing import generate_otp, hash_otp
from .models import OtpCode
from .sms import SmsDeliveryError, get_sms_provider
from .templates_sms import render_otp_message

logger = logging.getLogger(__name__)


@shared_task(
    autoretry_for=(SmsDeliveryError,),
    retry_backoff=True,
    retry_backoff_max=60,
    retry_jitter=True,
    max_retries=3,
)
def send_otp_sms(otp_id: int) -> str:
    """Generate the code, store only its HMAC, and send it by SMS.

    Only ``otp_id`` travels through the broker. The plaintext code exists only in this
    worker's memory and in the SMS itself — never in Redis, PostgreSQL or logs.

    A retry (temporary provider failure) generates a fresh code and replaces the hash,
    so a code that may not have been delivered never stays valid. Codes that were
    used, replaced or expired before the worker ran are skipped.
    """
    with transaction.atomic():
        otp = OtpCode.objects.select_for_update().filter(pk=otp_id).first()
        if otp is None or otp.used_at or otp.invalidated_at or otp.expires_at <= timezone.now():
            logger.info("OTP SMS skipped otp_id=%s (no longer active)", otp_id)
            return "skipped"
        code = generate_otp()
        otp.otp_hash = hash_otp(otp.mobile_number, otp.purpose, code)
        otp.save(update_fields=["otp_hash", "updated_at"])

    minutes = max(1, math.ceil(settings.OTP_TTL_SECONDS / 60))
    message = render_otp_message(code, minutes, otp.language)
    result = get_sms_provider().send(otp.mobile_number, message)
    logger.info(
        "OTP SMS sent otp_id=%s to=%s provider=%s message_id=%s",
        otp_id,
        mask_mobile(otp.mobile_number),
        result.provider,
        result.message_id,
    )
    return "sent"
