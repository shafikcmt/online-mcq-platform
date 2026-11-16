"""Exam builder: create / update / delete, the exam's question list, and the
publish / unpublish / archive / duplicate actions. All exam writes go through here.

Every write runs in one transaction with its audit entry and locks the exam row
(``SELECT … FOR UPDATE``), so actions on the same exam are applied one at a time.

Lock order (avoids deadlocks): exam row first, then question rows in id order.
- Publishing locks the assigned questions, so a concurrent question edit either
  finishes first (and is validated) or waits and then sees the exam as published
  (and is refused by the question lock, ``questions.locks``).
- Saving the question list locks the listed questions, so a concurrent question
  delete either finishes first (→ "question not found") or is blocked by the
  PROTECT reference (→ 409).
"""

import logging
from dataclasses import dataclass
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Count, ProtectedError, Q, RestrictedError
from django.http import Http404
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from apps.audit import services as audit
from apps.audit.services import AuditContext
from apps.catalog.models import SLUG_MAX_LENGTH
from apps.core import documents
from apps.core.i18n import normalize_digits, normalize_text
from apps.core.slugs import first_free_slug, slug_base
from apps.questions.models import Question, normalize_content

from .exceptions import (
    ALREADY_PUBLISHED_MESSAGE,
    EXAM_HAS_ATTEMPTS_MESSAGE,
    EXAM_IN_USE_MESSAGE,
    EXAM_LOCKED_MESSAGE,
    EXAM_NOT_DELETABLE_MESSAGE,
    NOT_ARCHIVABLE_MESSAGE,
    NOT_PUBLISHED_MESSAGE,
    ExamStateError,
)
from .locks import has_history
from .models import (
    EDITABLE_STATUSES,
    EXAM_SLUG_TAKEN_MESSAGE,
    SYLLABUS_LABEL_MAX_LENGTH,
    SYLLABUS_MAX_ITEMS,
    ContentLanguage,
    Exam,
    ExamQuestion,
    ExamStatus,
    ExamSyllabusItem,
    ExamType,
    MeritStrategy,
    ResultVisibility,
    RoutinePdf,
)

logger = logging.getLogger(__name__)

SLUG_REQUIRED_MESSAGE = _(
    "Enter a slug (English letters, digits and hyphens), or an English title to generate it."
)
SUBJECT_CATEGORY_MESSAGE = _("The subject must belong to the selected category.")
SCHEDULE_ORDER_MESSAGE = _("The end time must be after the start time.")
SCHEDULE_TOO_SHORT_MESSAGE = _("The exam window is shorter than the exam duration.")
SCHEDULE_REQUIRED_MESSAGE = _("Live exams need a start and an end time.")
RESULTS_AFTER_END_MESSAGE = _(
    "Results shown after the exam ends need an end time. Set an end time or choose "
    "another result visibility."
)
SCHEDULE_ENDED_MESSAGE = _("The end time has already passed.")
MAX_ATTEMPTS_MESSAGE = _(
    "With retakes allowed, set at least 2 attempts, or leave it empty for unlimited attempts."
)
TITLE_LANGUAGE_MESSAGE = _("A title in %(language)s is required for this exam's language.")
NO_QUESTIONS_MESSAGE = _("Add questions before publishing.")
QUESTION_COUNT_MESSAGE = _("This exam needs %(expected)s questions but %(actual)s are assigned.")
QUESTION_INACTIVE_MESSAGE = _("Question #%(id)s is inactive.")
QUESTION_LANGUAGE_MESSAGE = _("Question #%(id)s is not available in %(language)s.")
QUESTION_ANSWER_MESSAGE = _(
    "Question #%(id)s must have %(min)s–%(max)s options and one correct answer."
)
PASS_MARKS_MESSAGE = _("Pass marks cannot be higher than the total marks (%(total)s).")
CATEGORY_INACTIVE_MESSAGE = _("The category is inactive.")
SUBJECT_INACTIVE_MESSAGE = _("The subject is inactive.")
DUPLICATE_QUESTION_MESSAGE = _("Question #%(id)s is listed more than once.")
DUPLICATE_ORDER_MESSAGE = _("Each question needs a different sort order.")
QUESTION_MISSING_MESSAGE = _("Question #%(id)s does not exist.")
TOO_MANY_QUESTIONS_MESSAGE = _("An exam can have at most %(max)s questions.")

LANGUAGE_NAMES = {"bn": _("Bangla"), "en": _("English")}
REQUIRED_LANGUAGES = {
    ContentLanguage.BANGLA: ("bn",),
    ContentLanguage.ENGLISH: ("en",),
    ContentLanguage.BOTH: ("bn", "en"),
}
# A question offering ``available_languages`` can serve these exam languages.
SERVES = {"bn": {"bn"}, "en": {"en"}, "both": {"bn", "en", "both"}}

# Fields an admin may change through create/update (status never; see actions below).
EXAM_FIELDS = (
    "title_bn",
    "title_en",
    "slug",
    "description_bn",
    "description_en",
    "instructions_bn",
    "instructions_en",
    "content_language",
    "category",
    "subject",
    "exam_type",
    "access_type",
    "duration_minutes",
    "total_questions",
    "default_marks",
    "negative_marks",
    "pass_marks",
    "start_at",
    "end_at",
    "shuffle_questions",
    "shuffle_options",
    "allow_retake",
    "max_attempts",
    "merit_enabled",
    "merit_strategy",
    "result_visibility",
    "allow_answer_review",
    "is_featured",
)
_COMPARED = tuple(f"{f}_id" if f in ("category", "subject") else f for f in EXAM_FIELDS)
# Reset on duplicate: identity, schedule, and is_featured (featuring is a publishing
# decision for a specific exam, not part of its configuration).
COPIED_FIELDS = tuple(
    f for f in _COMPARED if f not in ("slug", "start_at", "end_at", "is_featured")
)


def _error(field: str, text, code: str, **params) -> ValidationError:
    return ValidationError({field: ValidationError(text, code=code, params=params or None)})


# --------------------------------------------------------------------------------------
# Rules shared by create/update/publish
# --------------------------------------------------------------------------------------
def apply_type_defaults(exam: Exam, provided: set[str]) -> None:
    """Doc defaults by exam type for settings the admin did not send
    (DATABASE_DESIGN §4.5): practice → retakes, unlimited attempts, no merit list."""
    if exam.exam_type == ExamType.PRACTICE:
        if "allow_retake" not in provided:
            exam.allow_retake = True
        if "max_attempts" not in provided:
            exam.max_attempts = None
        if "merit_enabled" not in provided:
            exam.merit_enabled = False


def normalize_rules(exam: Exam) -> None:
    """Force the fixed rules and validate the configurable ones."""
    if exam.exam_type == ExamType.LIVE:
        exam.allow_retake = False
        exam.max_attempts = 1
        exam.merit_strategy = MeritStrategy.FIRST_ATTEMPT
    elif not exam.allow_retake:
        exam.max_attempts = 1
    elif exam.max_attempts == 1:
        raise _error("max_attempts", MAX_ATTEMPTS_MESSAGE, "max_attempts_too_low")

    # "after_exam_end" must have a real end: otherwise results would never appear.
    if exam.result_visibility == ResultVisibility.AFTER_EXAM_END and not exam.end_at:
        raise _error("end_at", RESULTS_AFTER_END_MESSAGE, "end_required_for_results")

    if exam.subject_id and exam.subject.category_id != exam.category_id:
        raise _error("subject", SUBJECT_CATEGORY_MESSAGE, "subject_category_mismatch")

    if exam.start_at and exam.end_at:
        if exam.end_at <= exam.start_at:
            raise _error("end_at", SCHEDULE_ORDER_MESSAGE, "schedule_order")
        window_minutes = (exam.end_at - exam.start_at).total_seconds() / 60
        if window_minutes < exam.duration_minutes:
            raise _error("end_at", SCHEDULE_TOO_SHORT_MESSAGE, "schedule_too_short")


def _ensure_slug(exam: Exam, exclude_pk=None) -> str:
    """Fill an empty slug from the English title. Returns the base it was generated
    from ("" when the admin entered the slug)."""
    exam.slug = normalize_digits(normalize_text(exam.slug or "")).lower()
    if exam.slug:
        return ""
    base = slug_base(exam.title_en, SLUG_MAX_LENGTH)
    if not base:
        raise _error("slug", SLUG_REQUIRED_MESSAGE, "required")
    exam.slug = first_free_slug(base, _taken_slugs(base, exclude_pk))
    return base


def _taken_slugs(base: str, exclude_pk=None) -> set[str]:
    queryset = Exam.objects.filter(slug__startswith=base)
    if exclude_pk:
        queryset = queryset.exclude(pk=exclude_pk)
    return set(queryset.values_list("slug", flat=True))


def _save(exam: Exam, *, slug_from: str) -> None:
    """Save; a generated slug (``slug_from`` = its base) that lost a race with another
    admin is regenerated, an admin-entered one is reported as taken."""
    tried = set()
    for _attempt in range(5):
        try:
            with transaction.atomic():  # savepoint: the outer transaction stays usable
                exam.save()
            return
        except IntegrityError as exc:
            if "slug" not in str(exc):
                raise
            if not slug_from:
                raise _error("slug", EXAM_SLUG_TAKEN_MESSAGE, "slug_taken") from exc
            tried.add(exam.slug)
            exam.slug = first_free_slug(slug_from, _taken_slugs(slug_from, exam.pk) | tried)
    raise _error("slug", EXAM_SLUG_TAKEN_MESSAGE, "slug_taken")


def _validate_and_normalize(exam: Exam, exclude_pk=None) -> str:
    exam.normalize()
    # Title and other fields first (clearer errors), then the (possibly generated) slug.
    exam.full_clean(
        exclude=["created_by", "slug"], validate_unique=False, validate_constraints=False
    )
    generated = _ensure_slug(exam, exclude_pk)
    exam.full_clean(exclude=["created_by"], validate_constraints=False)
    normalize_rules(exam)
    return generated


# --------------------------------------------------------------------------------------
# Audit
# --------------------------------------------------------------------------------------
@dataclass(frozen=True)
class _State:
    exam_type: str
    status: str
    content_language: str
    access_type: str
    allow_retake: bool
    max_attempts: int | None
    merit_enabled: bool
    merit_strategy: str
    result_visibility: str
    question_count: int
    has_schedule: bool
    category_id: int
    subject_id: int | None

    @classmethod
    def of(cls, exam: Exam, question_count: int | None = None) -> "_State":
        if question_count is None:
            question_count = exam.exam_questions.count() if exam.pk else 0
        return cls(
            exam.exam_type,
            exam.status,
            exam.content_language,
            exam.access_type,
            exam.allow_retake,
            exam.max_attempts,
            exam.merit_enabled,
            exam.merit_strategy,
            exam.result_visibility,
            question_count,
            bool(exam.start_at or exam.end_at),
            exam.category_id,
            exam.subject_id,
        )

    def values(self) -> dict:
        return dict(self.__dict__)


def _audit(ctx, action: str, exam_id: int, metadata: dict) -> None:
    audit.record(
        ctx,
        action=action,
        entity_type="exams.exam",
        entity_id=exam_id,
        summary=f"exam #{exam_id}",
        metadata=metadata,
        allowed_fields=(*Exam.AUDIT_VALUE_FIELDS, *Exam.AUDIT_PRESENCE_FIELDS),
    )


def _changes(before: _State, after: _State) -> dict:
    return {
        field: {"from": getattr(before, field), "to": getattr(after, field)}
        for field in before.values()
        if getattr(before, field) != getattr(after, field)
    }


def _field_name(compared: str) -> str:
    return compared[:-3] if compared in ("category_id", "subject_id") else compared


# --------------------------------------------------------------------------------------
# Locks
# --------------------------------------------------------------------------------------
def _lock_exam(exam_id) -> Exam:
    exam = Exam.objects.select_for_update().filter(pk=exam_id).first()
    if exam is None:
        raise Http404
    return exam


def _ensure_editable(exam: Exam) -> None:
    """Only draft and unpublished exams change, and only while no student has taken
    them (``exams.locks``; registered by the attempts app) — admins then duplicate the
    exam. The exam row is locked by the caller, and attempts can only start on a
    published exam, so no attempt can appear while an edit is running."""
    if exam.status not in EDITABLE_STATUSES:
        raise ExamStateError("exam_locked", EXAM_LOCKED_MESSAGE)
    if has_history(exam.pk):
        raise ExamStateError("exam_has_attempts", EXAM_HAS_ATTEMPTS_MESSAGE)


# --------------------------------------------------------------------------------------
# Create / update / delete
# --------------------------------------------------------------------------------------
@transaction.atomic
def create_exam(exam: Exam, *, ctx: AuditContext, provided: set[str] | None = None) -> Exam:
    exam.status = ExamStatus.DRAFT
    apply_type_defaults(exam, provided if provided is not None else set())
    slug_from = _validate_and_normalize(exam)
    if ctx.actor is not None:
        exam.created_by = ctx.actor
    _save(exam, slug_from=slug_from)
    _audit(ctx, "exam.create", exam.pk, {"values": _State.of(exam, 0).values()})
    return exam


@transaction.atomic
def update_exam(exam_id: int, data: dict, *, ctx: AuditContext) -> Exam:
    exam = _lock_exam(exam_id)
    _ensure_editable(exam)
    before = {field: getattr(exam, field) for field in _COMPARED}
    before_state = _State.of(exam)
    for field, value in data.items():
        if field in EXAM_FIELDS:
            setattr(exam, field, value)
    slug_from = _validate_and_normalize(exam, exclude_pk=exam.pk)
    changed = [_field_name(f) for f in _COMPARED if getattr(exam, f) != before[f]]
    if not changed:
        return exam
    _save(exam, slug_from=slug_from)
    after_state = _State.of(exam, before_state.question_count)
    _audit(
        ctx,
        "exam.update",
        exam.pk,
        {"changed_fields": changed, "changes": _changes(before_state, after_state)},
    )
    return exam


@transaction.atomic
def delete_exam(exam_id: int, *, ctx: AuditContext) -> None:
    """Only drafts (never published) can be deleted; published history is kept —
    unpublish/archive instead. Its question list goes with it; questions stay. An
    exam a package grants (``subscriptions``) is protected → 409 ``in_use``."""
    exam = _lock_exam(exam_id)
    if exam.status != ExamStatus.DRAFT:
        raise ExamStateError("exam_not_deletable", EXAM_NOT_DELETABLE_MESSAGE)
    snapshot = _State.of(exam).values()
    try:
        with transaction.atomic():
            exam.delete()
    except (ProtectedError, RestrictedError) as exc:  # e.g. a package access rule
        raise ExamStateError("in_use", EXAM_IN_USE_MESSAGE) from exc
    _audit(ctx, "exam.delete", exam_id, {"snapshot": snapshot})


# --------------------------------------------------------------------------------------
# Question list (complete replacement)
# --------------------------------------------------------------------------------------
def _build_items(exam: Exam, items: list[dict]) -> list[ExamQuestion]:
    maximum = settings.EXAM_MAX_QUESTIONS
    if len(items) > maximum:
        raise _error("questions", TOO_MANY_QUESTIONS_MESSAGE, "too_many", max=maximum)
    built, seen = [], set()
    for index, item in enumerate(items):
        question_id = item["question"]
        if question_id in seen:
            raise _error("questions", DUPLICATE_QUESTION_MESSAGE, "duplicate", id=question_id)
        seen.add(question_id)
        built.append(
            ExamQuestion(
                exam=exam,
                question_id=question_id,
                sort_order=item.get("sort_order", index),
                marks=item.get("marks"),
            )
        )
    if len({item.sort_order for item in built}) != len(built):
        raise _error("questions", DUPLICATE_ORDER_MESSAGE, "duplicate_order")
    # Lock the questions (id order): a concurrent delete waits or has already happened.
    found = set(
        Question.objects.select_for_update(no_key=True)
        .filter(pk__in=seen)
        .order_by("pk")
        .values_list("pk", flat=True)
    )
    for question_id in sorted(seen - found):
        raise _error("questions", QUESTION_MISSING_MESSAGE, "does_not_exist", id=question_id)
    return sorted(built, key=lambda item: item.sort_order)


def _signature(items) -> tuple:
    return tuple(
        (i.question_id, i.sort_order, None if i.marks is None else Decimal(i.marks))
        for i in sorted(items, key=lambda i: i.sort_order)
    )


@transaction.atomic
def set_exam_questions(exam_id: int, items: list[dict], *, ctx: AuditContext) -> Exam:
    """Replace the exam's complete question list (order and marks overrides)."""
    exam = _lock_exam(exam_id)
    _ensure_editable(exam)
    current = list(exam.exam_questions.all())
    built = _build_items(exam, items)
    if _signature(built) == _signature(current):
        return exam
    exam.exam_questions.all().delete()
    ExamQuestion.objects.bulk_create(built)
    exam.save(update_fields=["updated_at"])
    _audit(
        ctx,
        "exam.questions_update",
        exam.pk,
        {
            "changed_fields": ["questions"],
            "changes": {"question_count": {"from": len(current), "to": len(built)}},
        },
    )
    return exam


# --------------------------------------------------------------------------------------
# Syllabus
# --------------------------------------------------------------------------------------
SYLLABUS_FIELDS = ("subject", "chapter", "topic")
SYLLABUS_TOO_MANY_MESSAGE = _("A syllabus can have at most %(max)s lines.")
SYLLABUS_EMPTY_LINE_MESSAGE = _("Line %(number)s is empty: fill the subject, chapter or topic.")
SYLLABUS_TOO_LONG_MESSAGE = _(
    "Line %(number)s: %(field)s is too long (maximum %(max)s characters)."
)


def _syllabus_key(items) -> list[tuple]:
    return [tuple(getattr(item, name) for name in SYLLABUS_FIELDS) for item in items]


def build_syllabus(exam: Exam, items: list[dict]) -> list[ExamSyllabusItem]:
    """Validate the complete syllabus and return unsaved lines in the order given."""
    if len(items) > SYLLABUS_MAX_ITEMS:
        raise _error("syllabus", SYLLABUS_TOO_MANY_MESSAGE, "too_many", max=SYLLABUS_MAX_ITEMS)
    built = []
    for index, item in enumerate(items):
        number = index + 1
        values = {}
        for name in SYLLABUS_FIELDS:
            raw = item.get(name, "")
            text = " ".join(normalize_content(raw if isinstance(raw, str) else "").split())
            if len(text) > SYLLABUS_LABEL_MAX_LENGTH:
                raise _error(
                    "syllabus",
                    SYLLABUS_TOO_LONG_MESSAGE,
                    "too_long",
                    number=number,
                    field=name,
                    max=SYLLABUS_LABEL_MAX_LENGTH,
                )
            values[name] = text
        if not any(values.values()):
            raise _error("syllabus", SYLLABUS_EMPTY_LINE_MESSAGE, "empty_line", number=number)
        built.append(ExamSyllabusItem(exam=exam, sort_order=index, **values))
    return built


@transaction.atomic
def set_syllabus(exam_id: int, items: list[dict], *, ctx: AuditContext) -> Exam:
    """Replace the exam's complete syllabus. Allowed on a published exam too: a syllabus never
    changes what is asked or how it is scored."""
    exam = _lock_exam(exam_id)
    current = list(exam.syllabus_items.all())
    built = build_syllabus(exam, items)
    if _syllabus_key(built) == _syllabus_key(current):
        return exam
    exam.syllabus_items.all().delete()
    ExamSyllabusItem.objects.bulk_create(built)
    exam.save(update_fields=["updated_at"])
    _audit(
        ctx,
        "exam.syllabus_update",
        exam.pk,
        {"changed_fields": ["syllabus"]},
    )
    return exam


# --------------------------------------------------------------------------------------
# Publish / unpublish / archive
# --------------------------------------------------------------------------------------
def publish_errors(exam: Exam) -> dict[str, list]:
    """Everything that must hold for a published exam. Caller holds the exam lock."""
    errors: dict[str, list] = {}

    def add(field, text, code, **params):
        errors.setdefault(field, []).append(ValidationError(text, code=code, params=params or None))

    required = REQUIRED_LANGUAGES[exam.content_language]
    for lang in required:
        if not getattr(exam, f"title_{lang}"):
            add(
                f"title_{lang}",
                TITLE_LANGUAGE_MESSAGE,
                "title_language",
                language=LANGUAGE_NAMES[lang],
            )

    if not exam.category.is_active:
        add("category", CATEGORY_INACTIVE_MESSAGE, "category_inactive")
    if exam.subject_id and not exam.subject.is_active:
        add("subject", SUBJECT_INACTIVE_MESSAGE, "subject_inactive")

    try:
        normalize_rules(exam)
    except ValidationError as exc:
        for field, messages in exc.error_dict.items():
            errors.setdefault(field, []).extend(messages)
    if exam.exam_type == ExamType.LIVE and not (exam.start_at and exam.end_at):
        add("start_at", SCHEDULE_REQUIRED_MESSAGE, "schedule_required")
    if exam.end_at and exam.end_at <= timezone.now():
        add("end_at", SCHEDULE_ENDED_MESSAGE, "schedule_ended")

    items = list(exam.exam_questions.order_by("sort_order", "id"))
    if not items:
        add("questions", NO_QUESTIONS_MESSAGE, "no_questions")
    elif len(items) != exam.total_questions:
        add(
            "questions",
            QUESTION_COUNT_MESSAGE,
            "question_count",
            expected=exam.total_questions,
            actual=len(items),
        )

    # Lock the assigned questions (id order), then read their current option counts.
    question_ids = list(
        Question.objects.select_for_update(no_key=True)
        .filter(pk__in=[item.question_id for item in items])
        .order_by("pk")
        .values_list("pk", flat=True)
    )
    questions = {
        q.pk: q
        for q in Question.objects.filter(pk__in=question_ids).annotate(
            option_total=Count("options", distinct=True),
            correct_total=Count("options", filter=Q(options__is_correct=True), distinct=True),
        )
    }
    minimum, maximum = settings.QUESTION_MIN_OPTIONS, settings.QUESTION_MAX_OPTIONS
    total_marks = Decimal(0)
    for item in items:
        question = questions[item.question_id]
        total_marks += item.marks if item.marks is not None else exam.default_marks
        if not question.is_active:
            add("questions", QUESTION_INACTIVE_MESSAGE, "question_inactive", id=question.pk)
        for lang in required:
            if lang not in SERVES[question.available_languages]:
                add(
                    "questions",
                    QUESTION_LANGUAGE_MESSAGE,
                    "question_language",
                    id=question.pk,
                    language=LANGUAGE_NAMES[lang],
                )
        if question.correct_total != 1 or not minimum <= question.option_total <= maximum:
            add(
                "questions",
                QUESTION_ANSWER_MESSAGE,
                "question_answer",
                id=question.pk,
                min=minimum,
                max=maximum,
            )
    if items and exam.pass_marks is not None and exam.pass_marks > total_marks:
        add("pass_marks", PASS_MARKS_MESSAGE, "pass_marks_too_high", total=total_marks)
    return errors


@transaction.atomic
def publish_exam(exam_id: int, *, ctx: AuditContext) -> Exam:
    exam = _lock_exam(exam_id)
    if exam.status not in EDITABLE_STATUSES:
        code = "already_published" if exam.status == ExamStatus.PUBLISHED else "invalid_status"
        raise ExamStateError(
            code, ALREADY_PUBLISHED_MESSAGE if code == "already_published" else EXAM_LOCKED_MESSAGE
        )
    errors = publish_errors(exam)
    if errors:
        raise ValidationError(errors)
    before = exam.status
    exam.status = ExamStatus.PUBLISHED
    if exam.first_published_at is None:
        exam.first_published_at = timezone.now()
    exam.save(update_fields=["status", "first_published_at", "updated_at"])
    _audit(
        ctx,
        "exam.publish",
        exam.pk,
        {
            "values": _State.of(exam).values(),
            "changes": {"status": {"from": before, "to": exam.status}},
        },
    )
    return exam


@transaction.atomic
def unpublish_exam(exam_id: int, *, ctx: AuditContext) -> Exam:
    exam = _lock_exam(exam_id)
    if exam.status != ExamStatus.PUBLISHED:
        raise ExamStateError("not_published", NOT_PUBLISHED_MESSAGE)
    exam.status = ExamStatus.UNPUBLISHED
    exam.save(update_fields=["status", "updated_at"])
    _audit(
        ctx,
        "exam.unpublish",
        exam.pk,
        {"changes": {"status": {"from": ExamStatus.PUBLISHED, "to": exam.status}}},
    )
    return exam


@transaction.atomic
def archive_exam(exam_id: int, *, ctx: AuditContext) -> Exam:
    exam = _lock_exam(exam_id)
    if exam.status not in EDITABLE_STATUSES:
        raise ExamStateError("not_archivable", NOT_ARCHIVABLE_MESSAGE)
    before = exam.status
    exam.status = ExamStatus.ARCHIVED
    exam.save(update_fields=["status", "updated_at"])
    _audit(
        ctx, "exam.archive", exam.pk, {"changes": {"status": {"from": before, "to": exam.status}}}
    )
    return exam


# --------------------------------------------------------------------------------------
# Result publication (Milestone 4C)
# --------------------------------------------------------------------------------------
@transaction.atomic
def publish_results(exam_id: int, *, ctx: AuditContext) -> Exam:
    """Make the exam's results visible to students (any visibility mode; the only way
    for ``manual``). Already published → no change, no audit entry."""
    exam = _lock_exam(exam_id)
    if exam.result_published_at is not None:
        return exam
    exam.result_published_at = timezone.now()
    exam.save(update_fields=["result_published_at", "updated_at"])
    # Announce the now-visible results after commit (bounded, idempotent task).
    transaction.on_commit(lambda: _notify_published_results(exam.pk))
    _audit(
        ctx,
        "exam.results_publish",
        exam.pk,
        {"changes": {"results_published": {"from": False, "to": True}}},
    )
    return exam


def _notify_published_results(exam_id: int) -> None:
    from apps.results.tasks import notify_visible_results_task

    try:
        notify_visible_results_task.delay(exam_id)
    except Exception:  # noqa: BLE001 — the beat job sends them later; never fail the publish
        logger.warning("Could not queue result notifications exam=%s", exam_id)


@transaction.atomic
def hide_results(exam_id: int, *, ctx: AuditContext) -> Exam:
    """Withdraw the publication. ``immediate`` results stay visible (that mode does not
    depend on publication); ``after_exam_end`` falls back to the exam's end time."""
    exam = _lock_exam(exam_id)
    if exam.result_published_at is None:
        return exam
    exam.result_published_at = None
    exam.save(update_fields=["result_published_at", "updated_at"])
    _audit(
        ctx,
        "exam.results_hide",
        exam.pk,
        {"changes": {"results_published": {"from": True, "to": False}}},
    )
    return exam


# --------------------------------------------------------------------------------------
# Duplicate
# --------------------------------------------------------------------------------------
@transaction.atomic
def duplicate_exam(exam_id: int, *, ctx: AuditContext) -> Exam:
    """New draft with the same configuration and question list (order + marks).
    Not copied: id/public_id, status, schedule (start/end), ``is_featured`` (reset to
    False), audit history — and, from
    Milestone 4/5, attempts, results and access data. Titles are kept; the copy gets
    a new slug (``<slug>-copy``, ``<slug>-copy-2`` …)."""
    source = _lock_exam(exam_id)
    copy = Exam(**{field: getattr(source, field) for field in COPIED_FIELDS})
    copy.status = ExamStatus.DRAFT
    copy.start_at = copy.end_at = None
    base = f"{source.slug[: SLUG_MAX_LENGTH - 12]}-copy"
    copy.slug = first_free_slug(base, _taken_slugs(base))
    copy.normalize()
    copy.full_clean(exclude=["created_by"], validate_constraints=False)
    normalize_rules(copy)
    if ctx.actor is not None:
        copy.created_by = ctx.actor
    _save(copy, slug_from=base)
    items = [
        ExamQuestion(exam=copy, question_id=i.question_id, sort_order=i.sort_order, marks=i.marks)
        for i in source.exam_questions.all()
    ]
    ExamQuestion.objects.bulk_create(items)
    values = _State.of(copy, len(items)).values()
    _audit(ctx, "exam.duplicate", copy.pk, {"values": {**values, "source_exam_id": source.pk}})
    return copy


# --------------------------------------------------------------------------------------
# Routine PDF
# --------------------------------------------------------------------------------------
def _routine_audit(ctx, action: str, summary: str) -> None:
    audit.record(
        ctx,
        action=action,
        entity_type="exams.routine_pdf",
        entity_id=RoutinePdf.SINGLETON_ID,
        summary=summary,
    )


@transaction.atomic
def set_routine_pdf(upload, *, ctx: AuditContext) -> RoutinePdf:
    """Replace the routine PDF with a checked upload. Raises ``documents.DocumentError``."""
    checked = documents.validate_pdf(upload)
    row, _created = RoutinePdf.objects.select_for_update().get_or_create(pk=RoutinePdf.SINGLETON_ID)
    old_name = row.file.name if row.file else ""
    row.file.name = documents.store_pdf(checked)
    row.original_name = (getattr(upload, "name", "") or "routine.pdf")[:200]
    row.size_bytes = checked.size
    row.sha256 = checked.sha256
    row.uploaded_by = ctx.actor
    row.save()
    documents.delete_after_commit(old_name)
    _routine_audit(ctx, "routine.pdf_set", f"routine PDF set ({checked.size} bytes)")
    return row


@transaction.atomic
def remove_routine_pdf(*, ctx: AuditContext) -> None:
    row = RoutinePdf.objects.select_for_update().filter(pk=RoutinePdf.SINGLETON_ID).first()
    if row is None or not row.file:
        return
    documents.delete_after_commit(row.file.name)
    row.file.name = ""
    row.original_name = ""
    row.size_bytes = 0
    row.sha256 = ""
    row.save()
    _routine_audit(ctx, "routine.pdf_remove", "routine PDF removed")
