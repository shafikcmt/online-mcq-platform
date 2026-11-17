"""Sample participant writes, each in one transaction with its audit entry (nothing is written,
and nothing audited, when nothing changed)."""

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import ProtectedError
from django.http import Http404

from apps.audit import services as audit
from apps.audit.services import AuditContext
from apps.cms.models import normalize_line
from apps.exams.models import Exam
from apps.exams.selectors import with_question_totals

from .models import MAX_ENTRIES_PER_EXAM, SampleEntry, SamplePerson

PERSON_FIELDS = SamplePerson.AUDIT_VALUE_FIELDS


class SampleInUse(Exception):
    """The sample participant is part of one or more exams."""

    def __init__(self, exams: int):
        super().__init__(f"in {exams} exam(s)")
        self.exams = exams


def _person_audit(ctx, action: str, person: SamplePerson, entity_id, metadata: dict) -> None:
    audit.record(
        ctx,
        action=f"sample_person.{action}",
        entity_type="simulation.sampleperson",
        entity_id=entity_id,
        summary=person.name[:200],
        metadata=metadata,
        allowed_fields=PERSON_FIELDS,
    )


def _values(person: SamplePerson) -> dict:
    return {field: getattr(person, field) for field in PERSON_FIELDS}


@transaction.atomic
def create_person(person: SamplePerson, *, ctx: AuditContext) -> SamplePerson:
    person.full_clean(validate_constraints=False)
    person.save()
    _person_audit(ctx, "create", person, person.pk, {"values": _values(person)})
    return person


@transaction.atomic
def create_people(names: list[str], *, ctx: AuditContext) -> tuple[list[SamplePerson], int]:
    """Add many names at once (all or none). Blank lines are ignored; a name that is already in
    the list, or repeated in the batch, is skipped (compared without regard to case). Returns the
    people created and how many names were skipped."""
    existing = {name.casefold() for name in SamplePerson.objects.values_list("name", flat=True)}
    created, skipped = [], 0
    for raw in names:
        name = normalize_line(raw)
        if not name:
            continue
        if name.casefold() in existing:
            skipped += 1
            continue
        existing.add(name.casefold())
        created.append(create_person(SamplePerson(name=name), ctx=ctx))  # validates the name
    return created, skipped


@transaction.atomic
def update_person(pk: int, data: dict, *, ctx: AuditContext) -> SamplePerson:
    person = SamplePerson.objects.select_for_update().filter(pk=pk).first()
    if person is None:
        raise Http404
    before = _values(person)
    for field, value in data.items():
        setattr(person, field, value)
    person.full_clean(validate_constraints=False)
    after = _values(person)
    changed = [field for field in PERSON_FIELDS if before[field] != after[field]]
    if not changed:
        return person
    person.save()
    _person_audit(
        ctx,
        "update",
        person,
        pk,
        {
            "changed_fields": changed,
            "changes": {f: {"from": before[f], "to": after[f]} for f in changed},
        },
    )
    return person


@transaction.atomic
def delete_person(pk: int, *, ctx: AuditContext) -> None:
    person = SamplePerson.objects.select_for_update().filter(pk=pk).first()
    if person is None:
        raise Http404
    snapshot = _values(person)
    try:
        with transaction.atomic():
            person.delete()
    except ProtectedError as exc:
        raise SampleInUse(person.entries.count()) from exc
    _person_audit(ctx, "delete", person, pk, {"snapshot": snapshot})


def _marks(value, total: Decimal) -> Decimal:
    try:
        marks = Decimal(str(value)).quantize(Decimal("0.01"), ROUND_HALF_UP)
    except (InvalidOperation, ValueError, TypeError):
        raise ValidationError("Enter marks as a number.", code="marks_invalid") from None
    if marks < 0 or marks > total:
        raise ValidationError(
            "Marks must be between 0 and the exam's total marks.", code="marks_out_of_range"
        )
    return marks


@transaction.atomic
def set_exam_entries(exam_id: int, items: list[dict], *, ctx: AuditContext) -> Exam:
    """Replace the exam's COMPLETE list of sample participants with ``items``
    (``{"person": <id>, "marks": <number>}``)."""
    exam = Exam.objects.select_for_update().filter(pk=exam_id).first()
    if exam is None:
        raise Http404
    total = with_question_totals(Exam.objects.filter(pk=exam_id)).get().total_marks
    if len(items) > MAX_ENTRIES_PER_EXAM:
        raise ValidationError(
            f"An exam can have at most {MAX_ENTRIES_PER_EXAM} sample participants.",
            code="too_many",
        )
    ids = [item["person"] for item in items]
    if len(set(ids)) != len(ids):
        raise ValidationError(
            "A sample participant can be added to an exam only once.", code="duplicate"
        )
    people = {person.pk: person for person in SamplePerson.objects.filter(pk__in=ids)}
    wanted = {}
    for item in items:
        person = people.get(item["person"])
        if person is None:
            raise ValidationError("This sample participant does not exist.", code="not_found")
        wanted[person.pk] = _marks(item["marks"], total)
    current = {
        entry.person_id: entry.marks for entry in SampleEntry.objects.filter(exam_id=exam_id)
    }
    if wanted == current:
        return exam
    SampleEntry.objects.filter(exam_id=exam_id).exclude(person_id__in=wanted).delete()
    for person_id, marks in wanted.items():
        SampleEntry.objects.update_or_create(
            exam_id=exam_id, person_id=person_id, defaults={"marks": marks}
        )
    audit.record(
        ctx,
        action="exam.sample_participants_update",
        entity_type="exams.exam",
        entity_id=exam_id,
        summary=str(exam)[:200],
        metadata={"changed_fields": ["sample_participants"]},
        allowed_fields=("sample_participants",),
    )
    return exam
