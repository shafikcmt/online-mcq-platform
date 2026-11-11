"""Study material writes. Every admin write runs in one transaction with its audit entry, validates
the model (``full_clean``) and writes nothing (no audit) when nothing changed."""

from django.db import transaction
from django.http import Http404

from apps.audit import services as audit
from apps.audit.services import AuditContext
from apps.core import documents

from .models import MaterialKind, StudyMaterial

FIELDS = (
    *StudyMaterial.AUDIT_VALUE_FIELDS,
    *StudyMaterial.AUDIT_DATE_FIELDS,
    *StudyMaterial.AUDIT_REFERENCE_FIELDS,
    *StudyMaterial.AUDIT_PRESENCE_FIELDS,
)


def _iso(value):
    return value.isoformat() if value is not None else None


def _snapshot(item: StudyMaterial) -> dict:
    values = {
        field: getattr(item, field)
        for field in (*item.AUDIT_VALUE_FIELDS, *item.AUDIT_REFERENCE_FIELDS)
    }
    values.update({field: _iso(getattr(item, field)) for field in item.AUDIT_DATE_FIELDS})
    return values


def _record(ctx, action: str, item: StudyMaterial, entity_id, metadata: dict) -> None:
    audit.record(
        ctx,
        action=f"material.{action}",
        entity_type="materials.studymaterial",
        entity_id=entity_id,
        summary=str(item)[:200] or f"#{entity_id}",
        metadata=metadata,
        allowed_fields=FIELDS,
    )


@transaction.atomic
def create_material(item: StudyMaterial, *, ctx: AuditContext) -> StudyMaterial:
    item.full_clean(validate_constraints=False)
    item.save()
    _record(
        ctx,
        "create",
        item,
        item.pk,
        {
            "values": _snapshot(item),
            "descriptions": [f for f in item.AUDIT_PRESENCE_FIELDS if getattr(item, f)],
        },
    )
    return item


@transaction.atomic
def update_material(pk: int, data: dict, *, ctx: AuditContext) -> StudyMaterial:
    item = StudyMaterial.objects.select_for_update().filter(pk=pk).first()
    if item is None:
        raise Http404
    before = StudyMaterial.objects.get(pk=pk)
    for field, value in data.items():
        setattr(item, field, value)
    item.full_clean(validate_constraints=False)
    changed = [field for field in FIELDS if getattr(before, field) != getattr(item, field)]
    if not changed:
        return item
    if item.kind != before.kind and before.pdf:
        # Changing a PDF material into a video drops its file.
        documents.delete_after_commit(before.pdf.name)
        item.pdf.name, item.pdf_name, item.pdf_size, item.pdf_sha256 = "", "", 0, ""
    item.save()
    old, new = _snapshot(before), _snapshot(item)
    _record(
        ctx,
        "update",
        item,
        item.pk,
        {
            "changed_fields": changed,
            "changes": {f: {"from": old[f], "to": new[f]} for f in changed if f in new},
        },
    )
    return item


@transaction.atomic
def delete_material(pk: int, *, ctx: AuditContext) -> None:
    item = StudyMaterial.objects.select_for_update().filter(pk=pk).first()
    if item is None:
        raise Http404
    snapshot = _snapshot(item)
    if item.pdf:
        documents.delete_after_commit(item.pdf.name)
    item.delete()
    _record(ctx, "delete", item, pk, {"snapshot": snapshot})


@transaction.atomic
def set_material_pdf(pk: int, upload, *, ctx: AuditContext) -> StudyMaterial:
    """Attach or replace the PDF of a PDF-type material. Raises ``documents.DocumentError``."""
    checked = documents.validate_pdf(upload)
    item = StudyMaterial.objects.select_for_update().filter(pk=pk).first()
    if item is None:
        raise Http404
    if item.kind != MaterialKind.PDF:
        raise documents.DocumentError("not_a_pdf_material", "Only a PDF material can have a file.")
    old_name = item.pdf.name if item.pdf else ""
    item.pdf.name = documents.store_pdf(checked)
    item.pdf_name = (getattr(upload, "name", "") or "material.pdf")[:200]
    item.pdf_size = checked.size
    item.pdf_sha256 = checked.sha256
    item.save(update_fields=["pdf", "pdf_name", "pdf_size", "pdf_sha256", "updated_at"])
    documents.delete_after_commit(old_name)
    _record(ctx, "pdf_set", item, pk, {"changed_fields": ["pdf"]})
    return item


@transaction.atomic
def remove_material_pdf(pk: int, *, ctx: AuditContext) -> StudyMaterial:
    item = StudyMaterial.objects.select_for_update().filter(pk=pk).first()
    if item is None:
        raise Http404
    if not item.pdf:
        return item
    documents.delete_after_commit(item.pdf.name)
    item.pdf.name, item.pdf_name, item.pdf_size, item.pdf_sha256 = "", "", 0, ""
    item.save(update_fields=["pdf", "pdf_name", "pdf_size", "pdf_sha256", "updated_at"])
    _record(ctx, "pdf_remove", item, pk, {"changed_fields": ["pdf"]})
    return item
