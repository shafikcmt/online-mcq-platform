"""Creating and reading notifications.

Creation is called only by trusted domain code, inside the caller's transaction:
- ``payments.services`` — when a payment becomes verified ``success`` (normal or the
  late-provider-success recovery), in the same savepoint as the status change;
- ``results`` — when a result is (or becomes) visible to its student.

Every insert is ``INSERT … ON CONFLICT DO NOTHING`` against the unique
``(user, type, source_id)``: retries, replays, reconciliation and concurrent workers can
never create a second notification, and no IntegrityError reaches the caller. Because the
row is written in the caller's transaction, a rolled-back payment/result never leaves a
notification behind. Logs carry ids only.
"""

import logging

from django.db import transaction
from django.utils import timezone

from .models import Notification, NotificationRollout, NotificationType
from .templates import PARAM_KEYS

logger = logging.getLogger(__name__)


def _checked(notification_type: str, params: dict) -> dict:
    allowed = PARAM_KEYS[notification_type]
    unknown = set(params) - allowed
    if unknown:
        raise ValueError(f"Notification params not allow-listed: {sorted(unknown)}")
    return {key: "" if value is None else str(value) for key, value in params.items()}


def _create(rows: list[Notification]) -> None:
    if rows:
        Notification.objects.bulk_create(rows, ignore_conflicts=True)


def build(user_id, notification_type: str, source_id: int, params: dict) -> Notification:
    return Notification(
        user_id=user_id,
        type=notification_type,
        source_id=source_id,
        params=_checked(notification_type, params),
    )


# --------------------------------------------------------------------------------------
# Domain events
# --------------------------------------------------------------------------------------
def notify_payment_success(payment) -> None:
    """Call inside the transaction that marks ``payment`` successful."""
    package = payment.package
    _create(
        [
            build(
                payment.user_id,
                NotificationType.PAYMENT_SUCCESS,
                payment.pk,
                {
                    "payment_id": payment.public_id,
                    "package_slug": package.slug,
                    "package_name_bn": package.name_bn,
                    "package_name_en": package.name_en,
                    "verified_at": payment.verified_at.isoformat(),
                },
            )
        ]
    )


def result_notification(result, attempt, exam) -> Notification:
    return build(
        result.user_id,
        NotificationType.RESULT_PUBLISHED,
        result.pk,
        {
            "attempt_id": attempt.public_id,
            "exam_slug": exam.slug,
            "exam_title_bn": exam.title_bn,
            "exam_title_en": exam.title_en,
        },
    )


def notify_results(rows: list[Notification]) -> None:
    """Insert result notifications (already built); existing ones are left as they are."""
    _create(rows)


# --------------------------------------------------------------------------------------
# Reader actions (the student's own rows only)
# --------------------------------------------------------------------------------------
def rollout_start(notification_type: str):
    """When ``notification_type`` started (migration ``0002``), or ``None`` if unknown."""
    return (
        NotificationRollout.objects.filter(type=notification_type)
        .values_list("starts_at", flat=True)
        .first()
    )


def own_notifications(user):
    return Notification.objects.filter(user_id=user.pk)


@transaction.atomic
def mark_read(user, public_id) -> Notification | None:
    """Idempotent: the first call sets ``read_at``; later calls keep it."""
    notification = own_notifications(user).select_for_update().filter(public_id=public_id).first()
    if notification is None:
        return None
    if notification.read_at is None:
        notification.read_at = max(timezone.now(), notification.created_at)
        notification.save(update_fields=["read_at"])
    return notification


def mark_all_read(user) -> int:
    """One UPDATE over the user's unread rows (partial index); idempotent."""
    now = timezone.now()
    count = (
        own_notifications(user)
        .filter(read_at__isnull=True, created_at__lte=now)
        .update(read_at=now)
    )
    if count:
        logger.info("Notifications marked read user=%s count=%s", user.pk, count)
    return count
