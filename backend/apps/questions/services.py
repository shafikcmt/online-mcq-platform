"""Create / update / delete questions with their options (all writes go through here).

Every write:
- runs in one database transaction together with its audit entry;
- locks the question row (updates/deletes) and the subject row it attaches to, so
  concurrent edits are serialized and a subject cannot be deleted mid-create;
- validates the complete option set: ``QUESTION_MIN_OPTIONS``..``QUESTION_MAX_OPTIONS``
  options, **exactly one** correct, each option covering the question's languages.

Options are owned by the question: they are only ever replaced as a complete set,
never edited one by one, so a question can never be left with zero or two correct
options. Option IDs change when the set is replaced; once questions are used in exams
by an exam that is not a draft, ``_ensure_editable`` refuses content edits
(see ``questions.locks``; Milestone 4 adds attempts).
"""

import io
import logging
import uuid
import warnings
from dataclasses import dataclass

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import ProtectedError, RestrictedError
from django.http import Http404
from django.utils.translation import gettext_lazy as _
from PIL import Image, UnidentifiedImageError

from apps.audit import services as audit
from apps.audit.services import AuditContext
from apps.catalog.models import Subject

from .exceptions import (
    QUESTION_DEACTIVATE_LOCKED_MESSAGE,
    QUESTION_IN_USE_MESSAGE,
    QUESTION_LOCKED_MESSAGE,
    QuestionInUse,
    QuestionLocked,
)
from .locks import CONTENT, DEACTIVATE, LOCK_EXEMPT_FIELDS, is_locked
from .models import (
    LANGUAGES,
    OPTION_TEXT_MAX_LENGTH,
    OPTION_TEXT_REQUIRED_MESSAGE,
    Question,
    QuestionOption,
    languages_of,
)

logger = logging.getLogger(__name__)

SUBJECT_MISSING_MESSAGE = _("This subject no longer exists.")
OPTION_COUNT_MESSAGE = _("Add between %(min)s and %(max)s options.")
ONE_CORRECT_MESSAGE = _("Mark exactly one option as correct.")
OPTION_LANGUAGE_MESSAGE = _("Option %(number)s needs text in %(language)s, like the question.")
OPTION_EMPTY_MESSAGE = _("Option %(number)s: %(detail)s")
OPTION_TOO_LONG_MESSAGE = _("Option %(number)s is too long (maximum %(max)s characters).")
OPTION_ORDER_MESSAGE = _("Each option needs a different sort order.")
OPTION_DUPLICATE_MESSAGE = _("Two options have the same text.")
IMAGE_TOO_LARGE_MESSAGE = _("The image is too large (maximum %(max)s MB).")
IMAGE_INVALID_MESSAGE = _("Upload a valid JPEG, PNG or WebP image.")
IMAGE_TOO_MANY_PIXELS_MESSAGE = _("The image dimensions are too large.")

LANGUAGE_NAMES = {"bn": _("Bangla"), "en": _("English")}
# Detected format → (file extension, save options). Never derived from the filename.
IMAGE_FORMATS = {
    "JPEG": ("jpg", {"quality": 90, "optimize": True}),
    "PNG": ("png", {"optimize": True}),
    "WEBP": ("webp", {"quality": 90}),
}


# --------------------------------------------------------------------------------------
# Option validation
# --------------------------------------------------------------------------------------
def _error(field: str, text, code: str, **params) -> ValidationError:
    return ValidationError({field: ValidationError(text, code=code, params=params or None)})


def build_options(question: Question, options: list[dict]) -> list[QuestionOption]:
    """Validate a complete option set for ``question`` and return unsaved options."""
    minimum, maximum = settings.QUESTION_MIN_OPTIONS, settings.QUESTION_MAX_OPTIONS
    if not minimum <= len(options) <= maximum:
        raise _error("options", OPTION_COUNT_MESSAGE, "option_count", min=minimum, max=maximum)

    built: list[QuestionOption] = []
    for index, item in enumerate(options):
        number = index + 1
        option = QuestionOption(
            question=question,
            text_bn=item.get("text_bn", ""),
            text_en=item.get("text_en", ""),
            is_correct=bool(item.get("is_correct", False)),
            sort_order=item.get("sort_order", index),
        )
        option.normalize()
        if not languages_of(option):
            raise _error(
                "options",
                OPTION_EMPTY_MESSAGE,
                "option_text_required",
                number=number,
                detail=OPTION_TEXT_REQUIRED_MESSAGE,
            )
        for lang in LANGUAGES:
            if len(getattr(option, f"text_{lang}")) > OPTION_TEXT_MAX_LENGTH:
                raise _error(
                    "options",
                    OPTION_TOO_LONG_MESSAGE,
                    "option_too_long",
                    number=number,
                    max=OPTION_TEXT_MAX_LENGTH,
                )
        for lang in sorted(languages_of(question) - languages_of(option)):
            raise _error(
                "options",
                OPTION_LANGUAGE_MESSAGE,
                "option_language_missing",
                number=number,
                language=LANGUAGE_NAMES[lang],
            )
        built.append(option)

    if sum(option.is_correct for option in built) != 1:
        raise _error("options", ONE_CORRECT_MESSAGE, "one_correct_required")
    if len({option.sort_order for option in built}) != len(built):
        raise _error("options", OPTION_ORDER_MESSAGE, "duplicate_sort_order")
    keys = [_duplicate_key(option) for option in built]
    if len(set(keys)) != len(keys):
        raise _error("options", OPTION_DUPLICATE_MESSAGE, "duplicate_option")
    return sorted(built, key=lambda option: option.sort_order)


def _duplicate_key(option: QuestionOption) -> tuple:
    """Two options are duplicates when they read the same in EVERY language — compared
    after normalization, ignoring case and runs of whitespace (a missing language only
    matches a missing language). Options that differ in at least one language are
    different answers, even if they share the other language's text."""
    return tuple(" ".join(getattr(option, f"text_{lang}").split()).casefold() for lang in LANGUAGES)


def _signature(options) -> tuple:
    return tuple(
        (o.sort_order, o.text_bn, o.text_en, o.is_correct)
        for o in sorted(options, key=lambda o: o.sort_order)
    )


def _correct_answer(options) -> tuple:
    return next(((o.text_bn, o.text_en) for o in options if o.is_correct), ())


# --------------------------------------------------------------------------------------
# Audit helpers — identity values and changed field NAMES only (never content)
# --------------------------------------------------------------------------------------
@dataclass(frozen=True)
class _State:
    subject_id: int
    difficulty: str
    is_active: bool
    available_languages: str
    option_count: int

    @classmethod
    def of(cls, question: Question, option_count: int) -> "_State":
        return cls(
            question.subject_id,
            question.difficulty,
            question.is_active,
            question.available_languages,
            option_count,
        )

    def values(self) -> dict:
        return dict(self.__dict__)


def _audit(ctx, action: str, question_id: int, metadata: dict) -> None:
    audit.record(
        ctx,
        action=action,
        entity_type="questions.question",
        entity_id=question_id,
        summary=f"question #{question_id}",
        metadata=metadata,
        allowed_fields=(*Question.AUDIT_VALUE_FIELDS, *Question.AUDIT_PRESENCE_FIELDS),
    )


def _update_metadata(before: _State, after: _State, changed: list[str]) -> dict:
    changes = {
        field: {"from": getattr(before, field), "to": getattr(after, field)}
        for field in Question.AUDIT_VALUE_FIELDS
        if getattr(before, field) != getattr(after, field)
    }
    return {"changed_fields": changed, "changes": changes}


# --------------------------------------------------------------------------------------
# Locks and extension points
# --------------------------------------------------------------------------------------
def _lock_subject(subject_id) -> Subject:
    """Lock the parent subject so it cannot be deleted while this transaction runs."""
    subject = Subject.objects.select_for_update(no_key=True).filter(pk=subject_id).first()
    if subject is None:
        raise _error("subject", SUBJECT_MISSING_MESSAGE, "does_not_exist")
    return subject


def _lock_question(question_id) -> Question:
    question = Question.objects.select_for_update().filter(pk=question_id).first()
    if question is None:
        raise Http404
    return question


def _ensure_editable(question: Question, changed=("content",)) -> None:
    """Refuse changes that registered locks forbid (see ``questions.locks``):
    content changes to a question used by a once-published exam, and deactivating a
    question used by a currently published exam. Reactivating is always allowed.

    Must be called with the question row locked (``_lock_question``): exams lock the
    same rows while publishing, so the check and the publish cannot interleave.
    """
    if set(changed) - LOCK_EXEMPT_FIELDS and is_locked(question, CONTENT):
        raise QuestionLocked(QUESTION_LOCKED_MESSAGE)
    if "is_active" in changed and not question.is_active and is_locked(question, DEACTIVATE):
        raise QuestionLocked(QUESTION_DEACTIVATE_LOCKED_MESSAGE)


QUESTION_FIELDS = (
    "subject",
    "text_bn",
    "text_en",
    "explanation_bn",
    "explanation_en",
    "difficulty",
    "is_active",
)
_COMPARED_FIELDS = (
    "subject_id",
    "text_bn",
    "text_en",
    "explanation_bn",
    "explanation_en",
    "difficulty",
    "is_active",
)


# --------------------------------------------------------------------------------------
# Create / update / delete
# --------------------------------------------------------------------------------------
@transaction.atomic
def create_question(question: Question, options: list[dict], *, ctx: AuditContext) -> Question:
    question.subject = _lock_subject(question.subject_id)
    if ctx.actor is not None:
        question.created_by = ctx.actor
    question.full_clean(exclude=["image", "created_by"], validate_constraints=False)
    built = build_options(question, options)
    question.save()
    for option in built:
        option.question = question
    QuestionOption.objects.bulk_create(built)
    _audit(
        ctx,
        "question.create",
        question.pk,
        {
            "values": _State.of(question, len(built)).values(),
            "changed_fields": [
                f
                for f in ("text_bn", "text_en", "explanation_bn", "explanation_en")
                if getattr(question, f)
            ],
        },
    )
    return question


@transaction.atomic
def update_question(
    question_id: int, data: dict, options: list[dict] | None = None, *, ctx: AuditContext
) -> Question:
    """Apply ``data`` (question fields) and, if given, replace the complete option set."""
    question = _lock_question(question_id)
    current_options = list(question.options.all())
    before = {field: getattr(question, field) for field in _COMPARED_FIELDS}
    before_state = _State.of(question, len(current_options))

    for field, value in data.items():
        if field in QUESTION_FIELDS:
            setattr(question, field, value)
    if question.subject_id != before["subject_id"]:
        question.subject = _lock_subject(question.subject_id)
    question.full_clean(exclude=["image", "created_by"], validate_constraints=False)

    # Re-validate the (new or existing) option set against the question's languages.
    if options is None:
        options = [
            {
                "text_bn": o.text_bn,
                "text_en": o.text_en,
                "is_correct": o.is_correct,
                "sort_order": o.sort_order,
            }
            for o in current_options
        ]
    built = build_options(question, options)

    changed = [f for f in _COMPARED_FIELDS if getattr(question, f) != before[f]]
    options_changed = _signature(built) != _signature(current_options)
    if options_changed:
        changed.append("options")
        if _correct_answer(built) != _correct_answer(current_options):
            changed.append("correct_option")
    if not changed:
        return question  # nothing to save, nothing to audit
    _ensure_editable(question, changed)

    question.save()
    if options_changed:
        question.options.all().delete()
        for option in built:
            option.question = question
        QuestionOption.objects.bulk_create(built)
    after_state = _State.of(question, len(built))
    _audit(
        ctx,
        "question.update",
        question.pk,
        _update_metadata(before_state, after_state, changed),
    )
    return question


@transaction.atomic
def delete_question(question_id: int, *, ctx: AuditContext) -> None:
    question = _lock_question(question_id)
    snapshot = _State.of(question, question.options.count()).values()
    image_name = question.image.name
    try:
        with transaction.atomic():
            # Exam questions / attempt answers (3C/4) will reference questions with
            # PROTECT, which lands here as 409 instead of deleting used questions.
            question.delete()  # options are deleted with it (CASCADE)
    except (ProtectedError, RestrictedError) as exc:
        raise QuestionInUse(QUESTION_IN_USE_MESSAGE) from exc
    _audit(ctx, "question.delete", question_id, {"snapshot": snapshot})
    if image_name:
        _delete_file_after_commit(image_name)


# --------------------------------------------------------------------------------------
# Image
#
# File lifecycle rule: the database is the source of truth.
# - A new file is written BEFORE the transaction; if the transaction does not commit,
#   the new file is deleted again (so it is never orphaned).
# - An old file is deleted only AFTER a successful commit (on_commit), so a failed or
#   rolled-back change never loses the image that is still referenced.
# --------------------------------------------------------------------------------------
def _image_storage():
    return Question._meta.get_field("image").storage


def _delete_file_after_commit(name: str) -> None:
    storage = _image_storage()

    def delete():
        try:
            storage.delete(name)
        except OSError:  # the change is committed; a leftover file is only logged
            logger.warning("Could not delete replaced question image file.")

    transaction.on_commit(delete, robust=True)


def process_image(upload) -> tuple[ContentFile, str]:
    """Validate an uploaded image and re-encode it.

    The filename and declared content type are ignored: the format is detected by
    Pillow and only JPEG/PNG/WebP are accepted. Re-encoding drops metadata (EXIF/GPS)
    and anything appended to or embedded in the original file.
    """
    max_bytes = settings.QUESTION_IMAGE_MAX_BYTES
    if upload.size > max_bytes:
        raise _error(
            "image",
            IMAGE_TOO_LARGE_MESSAGE,
            "image_too_large",
            max=round(max_bytes / (1024 * 1024), 1),
        )
    try:
        with warnings.catch_warnings():
            # Pillow warns (DecompressionBombWarning) before it refuses; treat both as
            # invalid uploads. Our own pixel limit below is stricter than Pillow's.
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            return _reencode(upload)
    except ValidationError:
        raise
    except (
        UnidentifiedImageError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        OSError,
        ValueError,
        SyntaxError,
    ) as exc:
        raise _error("image", IMAGE_INVALID_MESSAGE, "invalid_image") from exc


def _reencode(upload) -> tuple[ContentFile, str]:
    upload.seek(0)
    with Image.open(upload) as probe:
        if probe.format not in IMAGE_FORMATS:
            raise _error("image", IMAGE_INVALID_MESSAGE, "invalid_image")
        if probe.width * probe.height > settings.QUESTION_IMAGE_MAX_PIXELS:
            raise _error("image", IMAGE_TOO_MANY_PIXELS_MESSAGE, "image_too_many_pixels")
        probe.verify()
    upload.seek(0)
    with Image.open(upload) as image:
        image_format = image.format
        image.load()
        if image_format == "JPEG" and image.mode not in ("RGB", "L"):
            image = image.convert("RGB")
        elif image.mode not in ("RGB", "RGBA", "L", "LA"):
            image = image.convert("RGBA")
        extension, save_options = IMAGE_FORMATS[image_format]
        output = io.BytesIO()
        image.save(output, format=image_format, **save_options)
    # Random name; the directory and extension are ours — nothing from the upload.
    return ContentFile(output.getvalue()), f"questions/{uuid.uuid4().hex}.{extension}"


def set_question_image(question_id: int, upload, *, ctx: AuditContext) -> Question:
    """Replace the question image. Must not run inside another transaction
    (``durable=True`` enforces it): the new file is only safe to keep once this
    transaction has really committed."""
    content, name = process_image(upload)  # validated before touching the database
    storage = _image_storage()
    stored_name = storage.save(name, content)
    try:
        with transaction.atomic(durable=True):
            question = _lock_question(question_id)
            _ensure_editable(question)
            old_name = question.image.name
            question.image.name = stored_name
            question.save(update_fields=["image", "updated_at"])
            _audit(ctx, "question.update", question.pk, {"changed_fields": ["image"]})
            if old_name:
                _delete_file_after_commit(old_name)
    except BaseException:
        storage.delete(stored_name)  # never leave an unreferenced file behind
        raise
    return question


@transaction.atomic
def remove_question_image(question_id: int, *, ctx: AuditContext) -> Question:
    question = _lock_question(question_id)
    _ensure_editable(question)
    old_name = question.image.name
    if not old_name:
        return question  # no-op: nothing to audit
    question.image.name = ""
    question.save(update_fields=["image", "updated_at"])
    _audit(ctx, "question.update", question.pk, {"changed_fields": ["image"]})
    _delete_file_after_commit(old_name)
    return question
