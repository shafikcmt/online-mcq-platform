"""Create / update / delete categories and subjects (all writes go through here).

Every write:
- runs in one database transaction together with its audit entry;
- locks the rows it depends on, so concurrent admin actions cannot leave a subject
  without a category or a category deleted while a subject is being added to it;
- normalizes and validates the model (``full_clean``) before saving.

Used by the admin API views and the internal Django admin.
"""

import re

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError, RestrictedError
from django.http import Http404
from django.utils.text import slugify
from django.utils.translation import gettext_lazy as _

from apps.audit import services as audit
from apps.audit.services import AuditContext

from .exceptions import CATEGORY_IN_USE_MESSAGE, SUBJECT_IN_USE_MESSAGE, CatalogInUse
from .models import (
    CATEGORY_SLUG_TAKEN_MESSAGE,
    SLUG_MAX_LENGTH,
    SUBJECT_SLUG_TAKEN_MESSAGE,
    CatalogEntry,
    Category,
    Subject,
)

SLUG_REQUIRED_MESSAGE = _(
    "Enter a slug (English letters, digits and hyphens), or an English name to generate it."
)
CATEGORY_MISSING_MESSAGE = _("This category no longer exists.")
_SLUG_SUFFIX_ROOM = 6  # "-99999"


# --------------------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------------------
def _slug_base(name_en: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", slugify(name_en or "")).strip("-")
    return base[: SLUG_MAX_LENGTH - _SLUG_SUFFIX_ROOM].strip("-")


def _ensure_slug(instance: CatalogEntry, scope) -> None:
    """Generate ``slug`` from the English name when it was left empty."""
    instance.normalize()
    if instance.slug:
        return
    base = _slug_base(instance.name_en)
    if not base:
        raise ValidationError({"slug": ValidationError(SLUG_REQUIRED_MESSAGE, code="required")})
    taken = set(scope.filter(slug__startswith=base).values_list("slug", flat=True))
    candidate, number = base, 2
    while candidate in taken:
        candidate = f"{base}-{number}"
        number += 1
    instance.slug = candidate


def _summary(instance: CatalogEntry) -> str:
    return f"{instance.name_en or instance.name_bn} [{instance.slug}]"


def _values(instance: CatalogEntry) -> dict:
    return {field: getattr(instance, field) for field in instance.AUDIT_VALUE_FIELDS}


def _changed_fields(before: CatalogEntry, after: CatalogEntry) -> list[str]:
    fields = (*after.AUDIT_VALUE_FIELDS, *after.AUDIT_PRESENCE_FIELDS)
    return [field for field in fields if getattr(before, field) != getattr(after, field)]


def _update_metadata(before: CatalogEntry, after: CatalogEntry, changed: list[str]) -> dict:
    return {
        "changed_fields": changed,
        "changes": {
            field: {"from": getattr(before, field), "to": getattr(after, field)}
            for field in changed
            if field in after.AUDIT_VALUE_FIELDS
        },
    }


def _create_metadata(instance: CatalogEntry) -> dict:
    return {
        "values": _values(instance),
        "descriptions": [f for f in instance.AUDIT_PRESENCE_FIELDS if getattr(instance, f)],
    }


def _save(instance: CatalogEntry, slug_message) -> None:
    try:
        with transaction.atomic():  # savepoint: a constraint error leaves the outer tx usable
            instance.save()
    except IntegrityError as exc:
        if "slug" in str(exc):  # unique slug lost a race with another admin
            raise ValidationError(
                {"slug": ValidationError(slug_message, code="slug_taken")}
            ) from exc
        raise


def _audit(ctx, action: str, instance: CatalogEntry, entity_id, summary: str, metadata: dict):
    """One audit entry; only the model's allow-listed fields may appear in metadata."""
    model = type(instance)
    audit.record(
        ctx,
        action=action,
        entity_type=f"catalog.{model._meta.model_name}",
        entity_id=entity_id,
        summary=summary,
        metadata=metadata,
        allowed_fields=(*model.AUDIT_VALUE_FIELDS, *model.AUDIT_PRESENCE_FIELDS),
    )


def _apply(instance: CatalogEntry, data: dict) -> None:
    for field, value in data.items():
        setattr(instance, field, value)


# --------------------------------------------------------------------------------------
# Category
# --------------------------------------------------------------------------------------
@transaction.atomic
def create_category(category: Category, *, ctx: AuditContext) -> Category:
    _ensure_slug(category, Category.objects.all())
    category.full_clean(validate_constraints=False)
    _save(category, CATEGORY_SLUG_TAKEN_MESSAGE)
    _audit(
        ctx,
        "category.create",
        category,
        category.pk,
        _summary(category),
        _create_metadata(category),
    )
    return category


@transaction.atomic
def update_category(category_id: int, data: dict, *, ctx: AuditContext) -> Category:
    category = Category.objects.select_for_update().filter(pk=category_id).first()
    if category is None:
        raise Http404
    before = Category.objects.get(pk=category_id)
    _apply(category, data)
    _ensure_slug(category, Category.objects.exclude(pk=category_id))
    category.full_clean(validate_constraints=False)
    changed = _changed_fields(before, category)
    if not changed:
        return category  # nothing to save, nothing to audit
    _save(category, CATEGORY_SLUG_TAKEN_MESSAGE)
    _audit(
        ctx,
        "category.update",
        category,
        category.pk,
        _summary(category),
        _update_metadata(before, category, changed),
    )
    return category


@transaction.atomic
def delete_category(category_id: int, *, ctx: AuditContext) -> None:
    # FOR UPDATE waits for (and then sees) any subject being added concurrently.
    category = Category.objects.select_for_update().filter(pk=category_id).first()
    if category is None:
        raise Http404
    subject_count = category.subjects.count()
    if subject_count:
        raise CatalogInUse(CATEGORY_IN_USE_MESSAGE, details={"subject_count": subject_count})
    snapshot, summary = _values(category), _summary(category)
    try:
        with transaction.atomic():
            category.delete()
    except (ProtectedError, RestrictedError) as exc:  # e.g. exams in later milestones
        raise CatalogInUse(CATEGORY_IN_USE_MESSAGE) from exc
    _audit(ctx, "category.delete", category, category_id, summary, {"snapshot": snapshot})


# --------------------------------------------------------------------------------------
# Subject
# --------------------------------------------------------------------------------------
def _lock_category(category_id) -> Category:
    """Lock the parent row so it cannot be deleted while this transaction runs."""
    category = Category.objects.select_for_update(no_key=True).filter(pk=category_id).first()
    if category is None:
        raise ValidationError(
            {"category": ValidationError(CATEGORY_MISSING_MESSAGE, code="does_not_exist")}
        )
    return category


@transaction.atomic
def create_subject(subject: Subject, *, ctx: AuditContext) -> Subject:
    subject.category = _lock_category(subject.category_id)
    _ensure_slug(subject, Subject.objects.filter(category_id=subject.category_id))
    subject.full_clean(validate_constraints=False)
    _save(subject, SUBJECT_SLUG_TAKEN_MESSAGE)
    _audit(ctx, "subject.create", subject, subject.pk, _summary(subject), _create_metadata(subject))
    return subject


@transaction.atomic
def update_subject(subject_id: int, data: dict, *, ctx: AuditContext) -> Subject:
    subject = Subject.objects.select_for_update().filter(pk=subject_id).first()
    if subject is None:
        raise Http404
    before = Subject.objects.get(pk=subject_id)
    _apply(subject, data)
    subject.category = _lock_category(subject.category_id)
    _ensure_slug(
        subject, Subject.objects.filter(category_id=subject.category_id).exclude(pk=subject_id)
    )
    subject.full_clean(validate_constraints=False)
    changed = _changed_fields(before, subject)
    if not changed:
        return subject
    _save(subject, SUBJECT_SLUG_TAKEN_MESSAGE)
    _audit(
        ctx,
        "subject.update",
        subject,
        subject.pk,
        _summary(subject),
        _update_metadata(before, subject, changed),
    )
    return subject


@transaction.atomic
def delete_subject(subject_id: int, *, ctx: AuditContext) -> None:
    subject = Subject.objects.select_for_update().filter(pk=subject_id).first()
    if subject is None:
        raise Http404
    snapshot, summary = _values(subject), _summary(subject)
    try:
        with transaction.atomic():
            # Questions (Milestone 3B) will reference subjects with PROTECT, which
            # lands here as ProtectedError → 409 instead of deleting them.
            subject.delete()
    except (ProtectedError, RestrictedError) as exc:
        raise CatalogInUse(SUBJECT_IN_USE_MESSAGE) from exc
    _audit(ctx, "subject.delete", subject, subject_id, summary, {"snapshot": snapshot})
