"""Append-only audit log of admin actions (docs/DATABASE_DESIGN.md §4.12).

Append-only is enforced three times:
1. the model and its queryset refuse updates and deletes;
2. a PostgreSQL trigger (migration 0001) rejects UPDATE and DELETE on the table;
3. no API or Django-admin path can change or delete a row.
"""

from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _


class AuditLogImmutable(Exception):
    """Raised when code tries to change or delete an audit entry."""


class AuditLogQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise AuditLogImmutable("Audit log entries cannot be changed.")

    def delete(self):
        raise AuditLogImmutable("Audit log entries cannot be deleted.")


class AuditLog(models.Model):
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name=_("actor"),
        null=True,
        blank=True,
        # Users with audit history cannot be hard-deleted (deactivate them instead);
        # this keeps "who did it" intact without ever rewriting an audit row.
        on_delete=models.PROTECT,
        related_name="audit_logs",
    )
    action = models.CharField(_("action"), max_length=64, db_index=True)
    entity_type = models.CharField(_("entity type"), max_length=64)
    entity_id = models.CharField(_("entity ID"), max_length=64)
    summary = models.CharField(_("summary"), max_length=255, blank=True)
    metadata = models.JSONField(_("metadata"), default=dict, blank=True)
    ip_address = models.GenericIPAddressField(_("IP address"), null=True, blank=True)
    user_agent = models.CharField(_("user agent"), max_length=255, blank=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True, db_index=True)

    objects = AuditLogQuerySet.as_manager()

    class Meta:
        verbose_name = _("audit log entry")
        verbose_name_plural = _("audit log")
        ordering = ("-created_at", "-id")
        indexes = [
            models.Index(fields=["entity_type", "entity_id"], name="audit_entity_idx"),
            models.Index(fields=["actor", "created_at"], name="audit_actor_created_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.action} {self.entity_type}:{self.entity_id}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise AuditLogImmutable("Audit log entries cannot be changed.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise AuditLogImmutable("Audit log entries cannot be deleted.")
