"""OTP verification services (no HTTP here — Milestone 2C adds the API endpoints).

Flow:
    request_otp(mobile, purpose)       → SMS with a code (via Celery)
    verify_otp(mobile, purpose, code)  → single-use verification token (returned once)
    consume_verification_token(...)    → used by registration / password reset (2C)

Account enumeration: these services never look at user accounts, so their results
and errors are identical whether or not an account exists for the number.

Redis failure: requesting codes fails closed (``OtpServiceUnavailable``). Verifying
codes and consuming tokens use only PostgreSQL and keep working.
"""

import logging
import math
from dataclasses import dataclass
from datetime import datetime, timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.core.i18n import normalize_digits, normalize_language
from apps.core.phone import mask_mobile, normalize_bd_mobile

from . import ratelimit
from .exceptions import (
    InvalidMobileNumber,
    OtpExpired,
    OtpInvalid,
    OtpLocked,
    OtpRateLimited,
    OtpResendCooldown,
    OtpServiceUnavailable,
    VerificationTokenInvalid,
)
from .hashing import generate_verification_token, hash_verification_token, otp_matches
from .models import OtpCode, OtpPurpose, VerificationToken

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class OtpRequestResult:
    mobile_number: str
    purpose: str
    expires_at: datetime
    resend_available_at: datetime


@dataclass(frozen=True)
class OtpVerificationResult:
    verification_token: str  # raw value — return to the client once, never store or log
    mobile_number: str
    purpose: str
    expires_at: datetime


def _normalize_mobile(value, error=InvalidMobileNumber):
    try:
        return normalize_bd_mobile(value)
    except ValidationError as exc:
        raise error() from exc


def _check_purpose(purpose: str) -> None:
    if purpose not in OtpPurpose.values:
        raise ValueError(f"Unknown OTP purpose: {purpose!r}")


def _seconds_until(moment: datetime, now: datetime) -> int:
    return max(1, math.ceil((moment - now).total_seconds()))


# --------------------------------------------------------------------------------------
# Request
# --------------------------------------------------------------------------------------
def request_otp(
    mobile_number: str,
    purpose: str,
    *,
    language: str | None = None,
    request_ip: str | None = None,
) -> OtpRequestResult:
    """Run every abuse check, then issue and send a code."""
    mobile = check_otp_request(mobile_number, purpose, request_ip=request_ip)
    return issue_otp(mobile, purpose, language=language, request_ip=request_ip)


def check_otp_request(mobile_number: str, purpose: str, *, request_ip: str | None = None) -> str:
    """Apply all abuse limits for one code request and return the normalized number.

    Raises the same errors (and updates the same Redis counters) whether or not a code
    is issued afterwards. The API uses it on its own for password resets, so the web
    request does identical work for real and unknown numbers (see accounts.tasks).
    """
    try:
        return _check_otp_request(mobile_number, purpose, request_ip=request_ip)
    except ratelimit.RateLimiterUnavailable as exc:
        # Fail closed: never issue codes when the abuse limits cannot be enforced.
        raise OtpServiceUnavailable(retry_after=30) from exc


def _check_otp_request(mobile_number, purpose, *, request_ip) -> str:
    mobile = _normalize_mobile(mobile_number)
    _check_purpose(purpose)
    now = timezone.now()

    # 1) Per-IP limit (Redis). Counts every request, including rejected ones.
    if request_ip:
        ip_limit = ratelimit.hit(
            "otp-ip",
            request_ip,
            limit=settings.OTP_IP_REQUEST_LIMIT,
            window=settings.OTP_IP_REQUEST_WINDOW_SECONDS,
            now=now.timestamp(),
        )
        if not ip_limit.allowed:
            logger.warning("OTP request blocked: IP limit reached")
            raise OtpRateLimited(retry_after=ip_limit.retry_after)

    # 2) Resend cooldown per number + purpose (database is authoritative).
    cooldown = settings.OTP_RESEND_COOLDOWN_SECONDS
    latest = (
        OtpCode.objects.filter(mobile_number=mobile, purpose=purpose)
        .order_by("-created_at")
        .values_list("created_at", flat=True)
        .first()
    )
    if latest and cooldown and now < latest + timedelta(seconds=cooldown):
        raise OtpResendCooldown(
            retry_after=_seconds_until(latest + timedelta(seconds=cooldown), now)
        )

    # 3) Per-number limit across all purposes within the window (protects SMS balance).
    #    Database history first (authoritative, sliding window) …
    window = settings.OTP_REQUEST_WINDOW_SECONDS
    recent = list(
        OtpCode.objects.filter(mobile_number=mobile, created_at__gt=now - timedelta(seconds=window))
        .order_by("created_at")
        .values_list("created_at", flat=True)[: settings.OTP_REQUEST_LIMIT]
    )
    if len(recent) >= settings.OTP_REQUEST_LIMIT:
        logger.warning("OTP request blocked: number limit reached to=%s", mask_mobile(mobile))
        raise OtpRateLimited(retry_after=_seconds_until(recent[0] + timedelta(seconds=window), now))

    # 4) Atomic cooldown claim (Redis) — stops two simultaneous requests both passing step 2.
    claim = f"{mobile}:{purpose}"
    if cooldown and not ratelimit.acquire_cooldown(
        "otp", claim, seconds=cooldown, now=now.timestamp()
    ):
        raise OtpResendCooldown(
            retry_after=ratelimit.cooldown_retry_after(
                "otp", claim, seconds=cooldown, now=now.timestamp()
            )
        )

    # 5) … then an atomic Redis counter, so simultaneous requests (e.g. different
    #    purposes) cannot all pass step 3 before any of them has inserted its row.
    number_limit = ratelimit.hit(
        "otp-mobile",
        mobile,
        limit=settings.OTP_REQUEST_LIMIT,
        window=window,
        now=now.timestamp(),
    )
    if not number_limit.allowed:
        logger.warning("OTP request blocked: number limit reached to=%s", mask_mobile(mobile))
        raise OtpRateLimited(retry_after=number_limit.retry_after)

    return mobile


def issue_otp(
    mobile_number: str,
    purpose: str,
    *,
    language: str | None = None,
    request_ip: str | None = None,
) -> OtpRequestResult:
    """Record a new code request (only the newest code stays valid) and queue the SMS.

    Call only after ``check_otp_request`` passed. ``mobile_number`` must be normalized.
    The code itself is generated by the SMS worker, so it never passes through this
    process, the database or the Celery broker in plain text.
    """
    _check_purpose(purpose)
    language = normalize_language(language) or settings.LANGUAGE_CODE
    now = timezone.now()
    expires_at = now + timedelta(seconds=settings.OTP_TTL_SECONDS)
    with transaction.atomic():
        OtpCode.objects.filter(
            mobile_number=mobile_number,
            purpose=purpose,
            used_at__isnull=True,
            invalidated_at__isnull=True,
        ).update(invalidated_at=now)
        otp = OtpCode.objects.create(
            mobile_number=mobile_number,
            purpose=purpose,
            language=language,
            expires_at=expires_at,
            request_ip=request_ip,
        )
        transaction.on_commit(lambda: _enqueue_sms(otp.pk))

    logger.info(
        "OTP issued otp_id=%s purpose=%s to=%s", otp.pk, purpose, mask_mobile(mobile_number)
    )
    return OtpRequestResult(
        mobile_number=mobile_number,
        purpose=purpose,
        expires_at=expires_at,
        resend_available_at=now + timedelta(seconds=settings.OTP_RESEND_COOLDOWN_SECONDS),
    )


def _enqueue_sms(otp_id: int) -> None:
    from .tasks import send_otp_sms

    send_otp_sms.delay(otp_id)  # only the row id travels through the broker


# --------------------------------------------------------------------------------------
# Verify
# --------------------------------------------------------------------------------------
def verify_otp(mobile_number: str, purpose: str, code: str) -> OtpVerificationResult:
    """Check a code. On success it is used up and a verification token is returned.

    Concurrency: the OTP row is locked (SELECT … FOR UPDATE), so two simultaneous
    correct submissions produce exactly one token.
    """
    mobile = _normalize_mobile(mobile_number, error=OtpInvalid)
    _check_purpose(purpose)
    submitted = normalize_digits(str(code or "")).strip()
    now = timezone.now()
    max_attempts = settings.OTP_MAX_ATTEMPTS

    with transaction.atomic():
        otp = (
            OtpCode.objects.select_for_update()
            .filter(
                mobile_number=mobile,
                purpose=purpose,
                used_at__isnull=True,
                invalidated_at__isnull=True,
            )
            .order_by("-created_at")
            .first()
        )
        if otp is None:
            outcome, remaining = "invalid", None
        elif otp.expires_at <= now:
            outcome, remaining = "expired", None
        elif otp.failed_attempts >= max_attempts:
            outcome, remaining = "locked", 0
        elif not (
            otp.otp_hash  # empty until the SMS worker generated the code
            and submitted.isdigit()
            and otp_matches(otp.otp_hash, mobile, purpose, submitted)
        ):
            otp.failed_attempts += 1
            otp.save(update_fields=["failed_attempts", "updated_at"])
            remaining = max(0, max_attempts - otp.failed_attempts)
            outcome = "locked" if remaining == 0 else "wrong"
        else:
            otp.used_at = now
            otp.save(update_fields=["used_at", "updated_at"])
            token = generate_verification_token()
            token_expires_at = now + timedelta(seconds=settings.VERIFICATION_TOKEN_TTL_SECONDS)
            VerificationToken.objects.create(
                token_hash=hash_verification_token(token),
                mobile_number=mobile,
                purpose=purpose,
                otp=otp,
                expires_at=token_expires_at,
            )
            outcome, remaining = "ok", None

    # Raise only after the transaction committed, so failed-attempt counts are saved.
    if outcome == "ok":
        logger.info("OTP verified otp_id=%s purpose=%s", otp.pk, purpose)
        return OtpVerificationResult(
            verification_token=token,
            mobile_number=mobile,
            purpose=purpose,
            expires_at=token_expires_at,
        )
    if outcome == "expired":
        raise OtpExpired()
    if outcome == "locked":
        logger.warning("OTP locked after too many attempts otp_id=%s", otp.pk)
        raise OtpLocked(attempts_remaining=0)
    raise OtpInvalid(attempts_remaining=remaining)


# --------------------------------------------------------------------------------------
# Verification token
# --------------------------------------------------------------------------------------
def consume_verification_token(token: str, mobile_number: str, purpose: str) -> str:
    """Use up a verification token. Returns the normalized mobile number.

    Fails (always with the same error) if the token is unknown, expired, already used,
    or was issued for a different number or purpose. Call it inside the same
    transaction that creates the account / changes the password (Milestone 2C).
    """
    mobile = _normalize_mobile(mobile_number, error=VerificationTokenInvalid)
    _check_purpose(purpose)
    if not token:
        raise VerificationTokenInvalid()
    now = timezone.now()

    with transaction.atomic():
        record = (
            VerificationToken.objects.select_for_update()
            .filter(token_hash=hash_verification_token(token))
            .first()
        )
        valid = (
            record is not None
            and record.used_at is None
            and record.expires_at > now
            and record.mobile_number == mobile
            and record.purpose == purpose
        )
        if valid:
            record.used_at = now
            record.save(update_fields=["used_at", "updated_at"])

    if not valid:
        raise VerificationTokenInvalid()
    return mobile
