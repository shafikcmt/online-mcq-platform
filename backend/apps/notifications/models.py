"""In-app notifications (docs/DATABASE_DESIGN.md §4.11) — Milestone 6B. In-app only.

A notification stores **what happened** (``type`` + an allow-listed ``params`` snapshot),
never rendered text: title and message are rendered from gettext templates in the reader's
current language at read time (``notifications.templates``), so switching language also
translates old notifications (docs/LOCALIZATION.md).

Created only by trusted domain events (payment verified success, result became visible),
never by an API. ``(user, type, source_id)`` is unique: ``source_id`` is the payment /
result the notification is about, so retries and races cannot create a second one. There
is deliberately no foreign key to the source row — the notification is history and stays
even if that row is ever removed.
"""

import uuid

from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _


class NotificationType(models.TextChoices):
    PAYMENT_SUCCESS = "payment_success", _("Payment successful")
    RESULT_PUBLISHED = "result_published", _("Result published")


class Notification(models.Model):
    public_id = models.UUIDField(_("public ID"), default=uuid.uuid4, unique=True, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name=_("user"),
        on_delete=models.PROTECT,  # users are deactivated, never deleted
        related_name="notifications",
    )
    type = models.CharField(_("type"), max_length=32, choices=NotificationType.choices)
    # The payment / result this notification is about (dedupe identity; not a FK).
    source_id = models.BigIntegerField(_("source ID"))
    params = models.JSONField(_("parameters"), default=dict, blank=True)  # allow-listed
    read_at = models.DateTimeField(_("read at"), null=True, blank=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("notification")
        verbose_name_plural = _("notifications")
        ordering = ("-created_at", "-id")
        constraints = [
            models.CheckConstraint(
                condition=models.Q(type__in=NotificationType.values),
                name="notifications_type_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(source_id__gt=0), name="notifications_source_valid"
            ),
            models.CheckConstraint(
                condition=models.Q(read_at__isnull=True)
                | models.Q(read_at__gte=models.F("created_at")),
                name="notifications_read_after_created",
            ),
            # One notification per event: the idempotency guard (ON CONFLICT DO NOTHING).
            models.UniqueConstraint(
                fields=["user", "type", "source_id"], name="notifications_one_per_event"
            ),
        ]
        indexes = [
            models.Index(fields=["user", "-created_at"], name="notif_user_created_idx"),
            models.Index(
                fields=["user", "created_at"],
                condition=models.Q(read_at__isnull=True),
                name="notif_user_unread_idx",
            ),
            models.Index(fields=["type", "source_id"], name="notif_type_source_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.type} · user #{self.user_id}"

    @property
    def is_read(self) -> bool:
        return self.read_at is not None


class NotificationRollout(models.Model):
    """When notifications of a type started (one row per type, written by migration
    ``0002``). Catch-up jobs only announce events that happened at or after
    ``starts_at``, so data that existed before the rollout is never announced in bulk —
    however long the jobs were down. Changed only deliberately (shell), never by an API."""

    type = models.CharField(_("type"), max_length=32, choices=NotificationType.choices, unique=True)
    starts_at = models.DateTimeField(_("starts at"))

    class Meta:
        verbose_name = _("notification rollout")
        verbose_name_plural = _("notification rollouts")
        constraints = [
            models.CheckConstraint(
                condition=models.Q(type__in=NotificationType.values),
                name="notifications_rollout_type_valid",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.type} from {self.starts_at.isoformat()}"


# --------------------------------------------------------------------------------------
# Push notifications (Expo). Off until the owner turns it on (PUSH_ENABLED) and has an Expo
# project with push credentials; nothing here is needed for the in-app notifications above.
# --------------------------------------------------------------------------------------
PUSH_TOKEN_MAX_LENGTH = 200
PUSH_TITLE_MAX_LENGTH = 100
PUSH_BODY_MAX_LENGTH = 300


class PushDevice(models.Model):
    """One phone that agreed to push notifications: its Expo push token and whose it is.

    The token is the only thing stored (no device name, no IP). The app registers it after
    sign-in and removes it on sign-out or when the student turns notifications off; Expo's
    ``DeviceNotRegistered`` answer deactivates it. A token belongs to one user at a time (signing
    in on the same phone as someone else moves it).
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name=_("user"),
        on_delete=models.CASCADE,
        related_name="push_devices",
    )
    token = models.CharField(_("Expo push token"), max_length=PUSH_TOKEN_MAX_LENGTH, unique=True)
    is_active = models.BooleanField(_("active"), default=True)
    last_error = models.CharField(_("last error"), max_length=60, blank=True, default="")
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        verbose_name = _("push device")
        verbose_name_plural = _("push devices")
        ordering = ("id",)
        indexes = [models.Index(fields=["is_active", "user"], name="push_device_active_idx")]

    def __str__(self) -> str:
        return f"device of user #{self.user_id}"


class PushKind(models.TextChoices):
    MANUAL = "manual", _("Sent by an admin")
    EXAM_REMINDER = "exam_reminder", _("Exam reminder")
    NEW_EXAM = "new_exam", _("New exam announcement")


class PushStatus(models.TextChoices):
    PENDING = "pending", _("Waiting to be sent")
    SENDING = "sending", _("Sending")
    SENT = "sent", _("Sent")
    FAILED = "failed", _("Failed")
    DISABLED = "disabled", _("Not sent: push is switched off on the server")


class PushMessage(models.Model):
    """One push message to all active devices: the text in both languages (each device gets its
    owner's language, falling back to the other) and an optional exam to open when it is tapped.
    Admin messages and automatic exam reminders share this record, which is also the history and the
    guard against sending the same reminder twice."""

    kind = models.CharField(_("type"), max_length=20, choices=PushKind.choices)
    title_bn = models.CharField(_("title (Bangla)"), max_length=PUSH_TITLE_MAX_LENGTH, blank=True)
    title_en = models.CharField(_("title (English)"), max_length=PUSH_TITLE_MAX_LENGTH, blank=True)
    body_bn = models.CharField(_("text (Bangla)"), max_length=PUSH_BODY_MAX_LENGTH, blank=True)
    body_en = models.CharField(_("text (English)"), max_length=PUSH_BODY_MAX_LENGTH, blank=True)
    exam = models.ForeignKey(
        "exams.Exam",
        verbose_name=_("exam"),
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    # For a reminder: how many minutes before the start it is for (null for manual messages).
    reminder_offset = models.PositiveIntegerField(
        _("reminder offset (minutes)"), null=True, blank=True
    )
    status = models.CharField(
        _("status"), max_length=10, choices=PushStatus.choices, default=PushStatus.PENDING
    )
    device_count = models.PositiveIntegerField(_("devices"), default=0)
    sent_count = models.PositiveIntegerField(_("accepted by Expo"), default=0)
    failed_count = models.PositiveIntegerField(_("failed"), default=0)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name=_("created by"),
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    sent_at = models.DateTimeField(_("sent at"), null=True, blank=True)

    class Meta:
        verbose_name = _("push message")
        verbose_name_plural = _("push messages")
        ordering = ("-created_at", "-id")
        constraints = [
            models.CheckConstraint(
                condition=models.Q(kind__in=PushKind.values), name="push_message_kind_valid"
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=PushStatus.values), name="push_message_status_valid"
            ),
            models.CheckConstraint(
                condition=models.Q(title_bn__gt="") | models.Q(title_en__gt=""),
                name="push_message_title_required",
            ),
            models.CheckConstraint(
                condition=models.Q(body_bn__gt="") | models.Q(body_en__gt=""),
                name="push_message_body_required",
            ),
            # One reminder per exam and offset, whatever happens (the scheduler may run twice).
            models.UniqueConstraint(
                fields=["exam", "kind", "reminder_offset"],
                condition=models.Q(kind="exam_reminder"),
                name="push_reminder_once",
            ),
            # One "new exam" announcement per exam, ever.
            models.UniqueConstraint(
                fields=["exam", "kind"],
                condition=models.Q(kind="new_exam"),
                name="push_new_exam_once",
            ),
        ]
        indexes = [models.Index(fields=["status", "created_at"], name="push_message_status_idx")]

    def __str__(self) -> str:
        return self.title_en or self.title_bn or f"push #{self.pk}"
