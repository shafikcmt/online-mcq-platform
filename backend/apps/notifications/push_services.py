"""Push notifications: devices, admin messages, delivery and automatic exam reminders.

- Everything is **off** while ``PUSH_ENABLED`` is false: an admin message is recorded with the
  status ``disabled`` (honest history, nothing sent) and the reminder scheduler does nothing.
- Delivery is idempotent: a message is claimed by moving it ``pending -> sending`` in one atomic
  update, so a repeated task never sends it twice. Each device gets the text of its owner's
  language (falling back to the other language); only active devices of active students count.
- Expo answers one ticket per message; ``DeviceNotRegistered`` deactivates that device. No token
  appears in logs.
"""

import logging
from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.http import Http404
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from apps.audit import services as audit
from apps.audit.services import AuditContext
from apps.cms.models import normalize_line
from apps.core.i18n import resolve_bilingual
from apps.exams.models import Exam, ExamStatus

from . import push
from .models import (
    PUSH_BODY_MAX_LENGTH,
    PUSH_TITLE_MAX_LENGTH,
    PushDevice,
    PushKind,
    PushMessage,
    PushStatus,
)

logger = logging.getLogger(__name__)

TOKEN_INVALID_MESSAGE = _("This is not a valid push token.")
TEXT_REQUIRED_MESSAGE = _("Enter a title and a text in Bangla or English.")
AUDIT_FIELDS = ("kind", "title_bn", "title_en", "exam_id", "status")
REMINDER_WINDOW_MINUTES = (
    5  # a reminder still goes out if the scheduler was late by up to this long
)


# --------------------------------------------------------------------------------------
# Devices
# --------------------------------------------------------------------------------------
@transaction.atomic
def register_device(user, token: str) -> PushDevice:
    """Store the phone's token for this student. The token is unique: a phone moves to whoever
    signed in last,
    and a registration reactivates a device that had been switched off."""
    token = (token or "").strip()
    if not push.is_valid_token(token):
        raise ValidationError({"token": ValidationError(TOKEN_INVALID_MESSAGE, code="invalid")})
    device, created = PushDevice.objects.select_for_update().get_or_create(
        token=token, defaults={"user": user}
    )
    if not created and (device.user_id != user.pk or not device.is_active or device.last_error):
        device.user, device.is_active, device.last_error = user, True, ""
        device.save(update_fields=["user", "is_active", "last_error", "updated_at"])
    return device


def unregister_device(user, token: str) -> int:
    """Remove this student's device with ``token`` (the student turned notifications off or signed
    out)."""
    deleted, _rows = PushDevice.objects.filter(user=user, token=(token or "").strip()).delete()
    return deleted


def active_devices():
    return PushDevice.objects.filter(
        is_active=True, user__is_active=True, user__role="student"
    ).select_related("user")


# --------------------------------------------------------------------------------------
# Messages
# --------------------------------------------------------------------------------------
def _clean(message: PushMessage) -> None:
    for lang in ("bn", "en"):
        setattr(
            message,
            f"title_{lang}",
            normalize_line(getattr(message, f"title_{lang}"))[:PUSH_TITLE_MAX_LENGTH],
        )
        setattr(
            message,
            f"body_{lang}",
            normalize_line(getattr(message, f"body_{lang}"))[:PUSH_BODY_MAX_LENGTH],
        )
    # each language is complete or empty; at least one is complete
    errors = {}
    complete = []
    for lang in ("bn", "en"):
        title, body = getattr(message, f"title_{lang}"), getattr(message, f"body_{lang}")
        if bool(title) != bool(body):
            errors[f"body_{lang}" if title else f"title_{lang}"] = ValidationError(
                TEXT_REQUIRED_MESSAGE, code="incomplete"
            )
        elif title:
            complete.append(lang)
    if not complete and not errors:
        errors["title_bn"] = ValidationError(TEXT_REQUIRED_MESSAGE, code="required")
    if errors:
        raise ValidationError(errors)


@transaction.atomic
def create_manual_message(message: PushMessage, *, ctx: AuditContext) -> PushMessage:
    """Record an admin's message and queue it for delivery once this transaction commits."""
    message.kind = PushKind.MANUAL
    message.created_by = ctx.actor
    _clean(message)
    message.status = PushStatus.PENDING if settings.PUSH_ENABLED else PushStatus.DISABLED
    message.save()
    audit.record(
        ctx,
        action="push.create",
        entity_type="notifications.pushmessage",
        entity_id=message.pk,
        summary=str(message)[:200],
        metadata={
            "values": {
                "kind": message.kind,
                "title_bn": message.title_bn,
                "title_en": message.title_en,
                "exam_id": message.exam_id,
                "status": message.status,
            }
        },
        allowed_fields=AUDIT_FIELDS,
    )
    if message.status == PushStatus.PENDING:
        from .tasks import send_push_message_task

        transaction.on_commit(lambda: send_push_message_task.delay(message.pk))
    return message


def _text(message: PushMessage, field: str, language: str) -> str:
    return resolve_bilingual(message, field, language)[0]


def _payload(message: PushMessage, device: PushDevice) -> dict:
    language = getattr(device.user, "preferred_language", "") or "bn"
    data = (
        {"type": "exam", "exam_slug": message.exam.slug} if message.exam_id else {"type": "notice"}
    )
    return {
        "to": device.token,
        "title": _text(message, "title", language),
        "body": _text(message, "body", language),
        "data": data,
        "sound": "default",
        "channelId": "default",
    }


def deliver(message_id: int) -> PushMessage | None:
    """Send a pending message to every active device. Safe to call twice: only one call wins the
    claim."""
    claimed = PushMessage.objects.filter(pk=message_id, status=PushStatus.PENDING).update(
        status=PushStatus.SENDING
    )
    if not claimed:
        return None
    message = PushMessage.objects.select_related("exam").get(pk=message_id)
    if not settings.PUSH_ENABLED:
        PushMessage.objects.filter(pk=message_id).update(status=PushStatus.DISABLED)
        return PushMessage.objects.get(pk=message_id)
    devices = list(active_devices())
    sent = failed = 0
    dead: list[int] = []
    errors: dict[int, str] = {}
    batch_size = settings.PUSH_BATCH_SIZE
    transport_failed = False
    for start in range(0, len(devices), batch_size):
        chunk = devices[start : start + batch_size]
        try:
            tickets = push.post_messages([_payload(message, device) for device in chunk])
        except push.PushTransportError as exc:
            logger.warning("Push batch failed message=%s reason=%s", message_id, exc)
            failed += len(chunk)
            transport_failed = True
            continue
        for device, ticket in zip(chunk, tickets, strict=True):
            if ticket.get("status") == "ok":
                sent += 1
                continue
            failed += 1
            error = str((ticket.get("details") or {}).get("error") or "error")[:60]
            errors[device.pk] = error
            if error == "DeviceNotRegistered":
                dead.append(device.pk)
    if dead:
        PushDevice.objects.filter(pk__in=dead).update(
            is_active=False, last_error="DeviceNotRegistered"
        )
    for device_id, error in errors.items():
        if error != "DeviceNotRegistered":
            PushDevice.objects.filter(pk=device_id).update(last_error=error)
    status = PushStatus.FAILED if (transport_failed and sent == 0 and devices) else PushStatus.SENT
    PushMessage.objects.filter(pk=message_id).update(
        status=status,
        device_count=len(devices),
        sent_count=sent,
        failed_count=failed,
        sent_at=timezone.now(),
    )
    logger.info(
        "Push delivered message=%s devices=%s sent=%s failed=%s",
        message_id,
        len(devices),
        sent,
        failed,
    )
    return PushMessage.objects.get(pk=message_id)


# --------------------------------------------------------------------------------------
# Exam reminders
# --------------------------------------------------------------------------------------
def reminder_text(exam: Exam, minutes: int) -> dict:
    """Bilingual title and text for "starts in about N" (hours for whole hours, days for whole
    days)."""
    if minutes % 1440 == 0:
        n, unit_en, unit_bn = minutes // 1440, "day" if minutes == 1440 else "days", "দিন"
    elif minutes % 60 == 0:
        n, unit_en, unit_bn = minutes // 60, "hour" if minutes == 60 else "hours", "ঘণ্টা"
    else:
        n, unit_en, unit_bn = minutes, "minute" if minutes == 1 else "minutes", "মিনিট"
    digits_bn = str(n).translate(str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯"))
    texts = {}
    title_en = exam.title_en or exam.title_bn
    title_bn = exam.title_bn or exam.title_en
    texts["title_en"] = "Exam reminder"
    texts["body_en"] = f"“{title_en}” starts in {n} {unit_en}."
    texts["title_bn"] = "পরীক্ষার রিমাইন্ডার"
    texts["body_bn"] = f"“{title_bn}” শুরু হবে {digits_bn} {unit_bn} পরে।"
    return {key: value[:PUSH_BODY_MAX_LENGTH] for key, value in texts.items()}


def due_reminders(now=None) -> list[tuple[Exam, int]]:
    """(exam, offset) pairs whose reminder time has come and that have not been sent: a published
    exam
    that starts in (offset - window, offset] minutes."""
    now = now or timezone.now()
    due = []
    for offset in sorted(set(settings.EXAM_REMINDER_OFFSETS_MINUTES)):
        if offset <= 0:
            continue
        window_start = now + timedelta(minutes=max(offset - REMINDER_WINDOW_MINUTES, 0))
        window_end = now + timedelta(minutes=offset)
        exams = Exam.objects.filter(
            status=ExamStatus.PUBLISHED, start_at__gt=window_start, start_at__lte=window_end
        ).exclude(
            pk__in=PushMessage.objects.filter(
                kind=PushKind.EXAM_REMINDER, reminder_offset=offset
            ).values("exam_id")
        )
        due.extend((exam, offset) for exam in exams)
    return due


def send_due_reminders(now=None) -> int:
    """Create and send the reminders that are due. Returns how many were created. No-op while push
    is off."""
    if not settings.PUSH_ENABLED:
        return 0
    created = 0
    for exam, offset in due_reminders(now):
        text = reminder_text(exam, offset)
        try:
            with transaction.atomic():
                message = PushMessage.objects.create(
                    kind=PushKind.EXAM_REMINDER,
                    exam=exam,
                    reminder_offset=offset,
                    status=PushStatus.PENDING,
                    **text,
                )
        except (
            IntegrityError
        ):  # another worker created it first: the unique constraint is the guard
            continue
        created += 1
        deliver(message.pk)
    return created


def get_message(pk: int) -> PushMessage:
    message = PushMessage.objects.select_related("exam").filter(pk=pk).first()
    if message is None:
        raise Http404
    return message
