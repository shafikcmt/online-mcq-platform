"""CMS writes. Every admin write runs in one transaction with its audit entry, normalizes
and validates the model (``full_clean``) and writes nothing (no audit) when nothing
changed. The public contact form is the only non-admin write.
"""

import logging

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.http import Http404

from apps.audit import services as audit
from apps.audit.services import AuditContext
from apps.core import documents

from .models import (
    PAGE_SLUG_TAKEN_MESSAGE,
    Announcement,
    BilingualContent,
    ContactMessage,
    ContactStatus,
    Faq,
    Page,
    SiteSettings,
)
from .selectors import forget_default_language

logger = logging.getLogger(__name__)

SETTINGS_FIELDS = SiteSettings.AUDIT_VALUE_FIELDS


def _iso(value):
    return value.isoformat() if value is not None else None


# --------------------------------------------------------------------------------------
# Site settings
# --------------------------------------------------------------------------------------
@transaction.atomic
def update_site_settings(data: dict, *, ctx: AuditContext) -> SiteSettings:
    row = SiteSettings.objects.select_for_update().filter(pk=SiteSettings.SINGLETON_ID).first()
    created = row is None
    if created:
        row = SiteSettings.defaults()
    before = {field: getattr(row, field) for field in SETTINGS_FIELDS}
    for field, value in data.items():
        if field in SETTINGS_FIELDS:
            setattr(row, field, value)
    row.full_clean(validate_unique=False, validate_constraints=False)
    changed = [field for field in SETTINGS_FIELDS if getattr(row, field) != before[field]]
    if not changed and not created:
        return row
    row.save()
    audit.record(
        ctx,
        action="site_settings.update",
        entity_type="cms.sitesettings",
        entity_id=row.pk,
        summary="site settings",
        metadata={
            "changed_fields": changed,
            "changes": {
                field: {"from": before[field], "to": getattr(row, field)} for field in changed
            },
        },
        allowed_fields=SETTINGS_FIELDS,
    )
    if "default_language" in changed:
        transaction.on_commit(forget_default_language)
    return row


# --------------------------------------------------------------------------------------
# Announcements, FAQ, pages (same lifecycle)
# --------------------------------------------------------------------------------------
_ENTITY = {Announcement: "announcement", Faq: "faq", Page: "page"}


def _fields(model) -> tuple:
    return (*model.AUDIT_VALUE_FIELDS, *model.AUDIT_DATE_FIELDS, *model.AUDIT_PRESENCE_FIELDS)


def _snapshot(instance) -> dict:
    values = {field: getattr(instance, field) for field in instance.AUDIT_VALUE_FIELDS}
    values.update({field: _iso(getattr(instance, field)) for field in instance.AUDIT_DATE_FIELDS})
    return values


def _summary(instance) -> str:
    return str(instance)[:200] or f"#{instance.pk}"


def _record(ctx, action: str, instance, entity_id, summary: str, metadata: dict) -> None:
    name = _ENTITY[type(instance)]
    audit.record(
        ctx,
        action=f"{name}.{action}",
        entity_type=f"cms.{type(instance)._meta.model_name}",
        entity_id=entity_id,
        summary=summary,
        metadata=metadata,
        allowed_fields=_fields(type(instance)),
    )


def _save(instance) -> None:
    try:
        with transaction.atomic():
            instance.save()
    except IntegrityError as exc:
        if isinstance(instance, Page) and "slug" in str(exc):
            raise ValidationError(
                {"slug": ValidationError(PAGE_SLUG_TAKEN_MESSAGE, code="slug_taken")}
            ) from exc
        raise


@transaction.atomic
def create_content(instance: BilingualContent, *, ctx: AuditContext) -> BilingualContent:
    instance.full_clean(validate_constraints=False)
    _save(instance)
    _record(
        ctx,
        "create",
        instance,
        instance.pk,
        _summary(instance),
        {
            "values": _snapshot(instance),
            "descriptions": [f for f in instance.AUDIT_PRESENCE_FIELDS if getattr(instance, f)],
        },
    )
    return instance


@transaction.atomic
def update_content(model, pk: int, data: dict, *, ctx: AuditContext):
    instance = model.objects.select_for_update().filter(pk=pk).first()
    if instance is None:
        raise Http404
    before = model.objects.get(pk=pk)
    for field, value in data.items():
        setattr(instance, field, value)
    instance.full_clean(validate_constraints=False)
    fields = _fields(model)
    changed = [field for field in fields if getattr(before, field) != getattr(instance, field)]
    if not changed:
        return instance
    _save(instance)
    old, new = _snapshot(before), _snapshot(instance)
    _record(
        ctx,
        "update",
        instance,
        instance.pk,
        _summary(instance),
        {
            "changed_fields": changed,
            "changes": {
                field: {"from": old[field], "to": new[field]} for field in changed if field in new
            },
        },
    )
    return instance


@transaction.atomic
def delete_content(model, pk: int, *, ctx: AuditContext) -> None:
    instance = model.objects.select_for_update().filter(pk=pk).first()
    if instance is None:
        raise Http404
    snapshot, summary = _snapshot(instance), _summary(instance)
    if isinstance(instance, Announcement) and instance.pdf:
        documents.delete_after_commit(instance.pdf.name)
    instance.delete()
    _record(ctx, "delete", instance, pk, summary, {"snapshot": snapshot})


# --------------------------------------------------------------------------------------
# Contact form
# --------------------------------------------------------------------------------------
def submit_contact_message(data: dict, *, language: str, ip_address) -> ContactMessage:
    """Store one website contact message (already validated by the serializer)."""
    message = ContactMessage.objects.create(
        name=data["name"],
        phone=data.get("phone", ""),
        email=data.get("email", ""),
        subject=data["subject"],
        message=data["message"],
        language=language,
        ip_address=ip_address,
    )
    logger.info("Contact message received id=%s language=%s", message.pk, language)
    return message


@transaction.atomic
def set_contact_status(message_id: int, status: str, *, ctx: AuditContext) -> ContactMessage:
    message = ContactMessage.objects.select_for_update().filter(pk=message_id).first()
    if message is None:
        raise Http404
    if status not in ContactStatus.values:
        raise ValidationError({"status": ValidationError("invalid", code="invalid_choice")})
    if message.status == status:
        return message
    before = message.status
    message.status = status
    message.handled_by = ctx.actor
    message.save(update_fields=["status", "handled_by", "updated_at"])
    audit.record(
        ctx,
        action="contact_message.status",
        entity_type="cms.contactmessage",
        entity_id=message.pk,
        summary=f"contact message #{message.pk}",
        metadata={"changes": {"status": {"from": before, "to": status}}},
        allowed_fields=("status",),
    )
    return message


# --------------------------------------------------------------------------------------
# Notice PDF
# --------------------------------------------------------------------------------------
@transaction.atomic
def set_announcement_pdf(pk: int, upload, *, ctx: AuditContext) -> Announcement:
    """Attach (or replace) the notice's PDF. Raises ``documents.DocumentError``."""
    checked = documents.validate_pdf(upload)
    notice = Announcement.objects.select_for_update().filter(pk=pk).first()
    if notice is None:
        raise Http404
    old_name = notice.pdf.name if notice.pdf else ""
    notice.pdf.name = documents.store_pdf(checked)
    notice.pdf_name = (getattr(upload, "name", "") or "notice.pdf")[:200]
    notice.pdf_size = checked.size
    notice.pdf_sha256 = checked.sha256
    notice.save(update_fields=["pdf", "pdf_name", "pdf_size", "pdf_sha256", "updated_at"])
    documents.delete_after_commit(old_name)
    _record(ctx, "pdf_set", notice, pk, _summary(notice), {"changed_fields": ["pdf"]})
    return notice


@transaction.atomic
def remove_announcement_pdf(pk: int, *, ctx: AuditContext) -> Announcement:
    notice = Announcement.objects.select_for_update().filter(pk=pk).first()
    if notice is None:
        raise Http404
    if not notice.pdf:
        return notice
    documents.delete_after_commit(notice.pdf.name)
    notice.pdf.name = ""
    notice.pdf_name = ""
    notice.pdf_size = 0
    notice.pdf_sha256 = ""
    notice.save(update_fields=["pdf", "pdf_name", "pdf_size", "pdf_sha256", "updated_at"])
    _record(ctx, "pdf_remove", notice, pk, _summary(notice), {"changed_fields": ["pdf"]})
    return notice
