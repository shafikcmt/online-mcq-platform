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
