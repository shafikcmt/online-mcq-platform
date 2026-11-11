"""Bulk question import from a CSV or Excel (.xlsx) file.

The admin uploads a file, sees a **preview** (every row checked, nothing written), and then
**imports** the rows that passed. Both steps run the same code over the same file, so what
the preview promised is what the import does. Each question goes through the normal
``services.create_question`` (the same rules, locks and audit entry as adding one by hand);
nothing here bypasses them.

File format (first row = headers, order does not matter, headers are case-insensitive):

====================  =============================================================
``question``          the question; its language (Bangla / English) is detected from
                      the letters. ``question_bn`` / ``question_en`` set it explicitly
``option_a`` ...      up to ``QUESTION_MAX_OPTIONS`` options (``option_a`` .. ``option_j``);
                      ``option_a_bn`` / ``option_a_en`` for bilingual questions
``correct_answer``    ``A``..``J``, ``1``..``10`` or ``ক``..``ঞ`` / ``১``..``১০``
``explanation``       optional (``explanation_bn`` / ``explanation_en``)
``subject``           name (Bangla or English) or slug of an existing subject; may be left
                      empty when a default subject is chosen in the upload form
``chapter``, ``topic``  optional free text
``difficulty``        optional: ``easy`` / ``medium`` / ``hard``
====================  =============================================================

Safety: size and row limits, only ``.csv`` / ``.xlsx`` (checked by content, not just the name),
a zip-bomb guard for workbooks, ``openpyxl`` read-only with ``defusedxml``, text only (formulas
are read as their stored value, never evaluated), and no subject is ever created from a file.
"""

import csv
import io
import re
import unicodedata
import zipfile
from dataclasses import dataclass, field

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q

from apps.audit import services as audit
from apps.audit.services import AuditContext
from apps.catalog.models import Subject

from . import services
from .models import LABEL_MAX_LENGTH, Difficulty, Question

MAX_LISTED_ERRORS = 500
PREVIEW_ROWS = 20
MAX_WORKBOOK_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
MAX_WORKBOOK_ENTRIES = 300
MAX_COLUMNS = 60
LETTERS = "abcdefghij"
# Bangla letters used as answer labels (ক = A, খ = B ...) and Bangla digits.
BANGLA_LETTERS = {"ক": 0, "খ": 1, "গ": 2, "ঘ": 3, "ঙ": 4, "চ": 5, "ছ": 6, "জ": 7, "ঝ": 8, "ঞ": 9}
BANGLA_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")
HEADER_ALIASES = {
    "answer": "correct_answer",
    "correct": "correct_answer",
    "correct_option": "correct_answer",
    "ans": "correct_answer",
    "q": "question",
    "description": "explanation",
}


class ImportFileError(Exception):
    """The file as a whole cannot be used. ``code`` is stable (the panel translates it)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class RowError:
    row: int
    field: str
    code: str
    message: str

    def as_dict(self) -> dict:
        return {"row": self.row, "field": self.field, "code": self.code, "message": self.message}


@dataclass
class ParsedRow:
    row: int
    subject: Subject
    fields: dict
    options: list[dict]
    correct_index: int


@dataclass
class Report:
    total_rows: int = 0
    valid: list[ParsedRow] = field(default_factory=list)
    errors: list[RowError] = field(default_factory=list)
    invalid_rows: int = 0
    columns: list[str] = field(default_factory=list)
    unknown_columns: list[str] = field(default_factory=list)
    created: int = 0
    aborted: bool = False

    def as_dict(self, *, committed: bool) -> dict:
        listed = self.errors[:MAX_LISTED_ERRORS]
        body = {
            "total_rows": self.total_rows,
            "valid_rows": len(self.valid),
            "invalid_rows": self.invalid_rows,
            "columns": self.columns,
            "unknown_columns": self.unknown_columns,
            "errors": [error.as_dict() for error in listed],
            "errors_truncated": len(self.errors) > len(listed),
            "preview": [_preview(item) for item in self.valid[:PREVIEW_ROWS]],
        }
        if committed:
            body.update(
                {"created": self.created, "skipped": self.invalid_rows, "aborted": self.aborted}
            )
        return body


# --------------------------------------------------------------------------------------
# Reading the file
# --------------------------------------------------------------------------------------
def _clean_cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return unicodedata.normalize("NFC", str(value)).strip()


def _normalize_header(value) -> str:
    text = _clean_cell(value).lower()
    text = re.sub(r"[\s\-\.]+", "_", text).strip("_")
    return HEADER_ALIASES.get(text, text)


def _check_size(upload) -> None:
    limit = settings.QUESTION_IMPORT_MAX_BYTES
    if upload is None:
        raise ImportFileError("file_missing", "Choose a CSV or Excel (.xlsx) file.")
    if upload.size > limit:
        raise ImportFileError(
            "file_too_large", f"The file is too large (maximum {limit // (1024 * 1024)} MB)."
        )
    if upload.size == 0:
        raise ImportFileError("file_empty", "The file is empty.")


def _read_csv(data: bytes) -> list[list[str]]:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ImportFileError(
            "csv_encoding",
            "Save the CSV as UTF-8 (in Excel: 'CSV UTF-8') so Bangla text stays readable.",
        ) from None
    if "\x00" in text:
        raise ImportFileError("file_invalid", "This is not a text CSV file.")
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    try:
        return [list(row) for row in csv.reader(io.StringIO(text), dialect)]
    except csv.Error:
        raise ImportFileError("file_invalid", "The CSV file could not be read.") from None


def _read_xlsx(data: bytes) -> list[list[str]]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ImportFileError("file_invalid", "This is not a valid Excel (.xlsx) file.") from None
    infos = archive.infolist()
    if len(infos) > MAX_WORKBOOK_ENTRIES or sum(i.file_size for i in infos) > (
        MAX_WORKBOOK_UNCOMPRESSED_BYTES
    ):
        raise ImportFileError("file_invalid", "The Excel file is too large when unpacked.")
    if "xl/workbook.xml" not in {info.filename for info in infos}:
        raise ImportFileError("file_invalid", "This is not a valid Excel (.xlsx) file.")
    from openpyxl import load_workbook

    try:
        workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        sheet = workbook.worksheets[0]
        rows = [[_clean_cell(cell) for cell in row] for row in sheet.iter_rows(values_only=True)]
        workbook.close()
    except Exception:  # noqa: BLE001 - any parser failure is "not a usable workbook"
        raise ImportFileError("file_invalid", "The Excel file could not be read.") from None
    return rows


def read_table(upload) -> tuple[list[str], list[tuple[int, dict]]]:
    """The file as (headers, [(spreadsheet row number, {header: text})]). Empty rows are
    dropped. Raises ``ImportFileError``."""
    _check_size(upload)
    name = (getattr(upload, "name", "") or "").lower()
    data = upload.read()
    if name.endswith(".xlsx"):
        if not data.startswith(b"PK"):
            raise ImportFileError("file_invalid", "This is not a valid Excel (.xlsx) file.")
        table = _read_xlsx(data)
    elif name.endswith(".csv"):
        table = _read_csv(data)
    else:
        raise ImportFileError("file_type", "Upload a .csv or .xlsx file.")
    if not table:
        raise ImportFileError("file_empty", "The file has no rows.")
    header_cells = table[0]
    if len(header_cells) > MAX_COLUMNS:
        raise ImportFileError("too_many_columns", "The file has too many columns.")
    headers = [_normalize_header(cell) for cell in header_cells]
    if not any(headers):
        raise ImportFileError("header_missing", "The first row must contain the column names.")
    body = []
    for number, cells in enumerate(table[1:], start=2):
        values = {}
        for index, header in enumerate(headers):
            if header and index < len(cells):
                value = _clean_cell(cells[index])
                if value:
                    values.setdefault(header, value)
        if values:
            body.append((number, values))
    limit = settings.QUESTION_IMPORT_MAX_ROWS
    if len(body) > limit:
        raise ImportFileError(
            "too_many_rows", f"The file has {len(body)} questions; the limit is {limit} per upload."
        )
    if not body:
        raise ImportFileError("no_rows", "The file has a header but no question rows.")
    return [h for h in headers if h], body


# --------------------------------------------------------------------------------------
# Understanding one row
# --------------------------------------------------------------------------------------
def _language_of(text: str) -> str | None:
    """``bn`` / ``en`` by the letters used; ``None`` when there are none (digits, symbols)."""
    bangla = sum(1 for ch in text if "\u0980" <= ch <= "\u09ff" and ch.isalpha())
    latin = sum(1 for ch in text if ch.isascii() and ch.isalpha())
    if not bangla and not latin:
        return "bn" if any("\u0980" <= ch <= "\u09ff" for ch in text) else None
    return "bn" if bangla and bangla >= latin else "en"


def _bilingual(row: dict, base: str, fallback: tuple[str, ...] = ()) -> dict:
    """``{base}_bn`` / ``{base}_en`` as given; a plain ``{base}`` fills the language its text is
    written in (unless that language column is already filled). Text with no letters at all
    (``3``, ``100%``) takes the language(s) of the question (``fallback``)."""
    out = {"bn": row.get(f"{base}_bn", ""), "en": row.get(f"{base}_en", "")}
    plain = row.get(base, "")
    if plain:
        lang = _language_of(plain)
        for target in (lang,) if lang else (fallback or ("en",)):
            if not out[target]:
                out[target] = plain
    return out


def _answer_index(value: str) -> int | None:
    text = value.strip().rstrip(").:").strip()
    text = text.translate(BANGLA_DIGITS)
    if text in BANGLA_LETTERS:
        return BANGLA_LETTERS[text]
    lowered = text.lower()
    if len(lowered) == 1 and lowered in LETTERS:
        return LETTERS.index(lowered)
    if lowered.isdigit():
        number = int(lowered)
        return number - 1 if 1 <= number <= len(LETTERS) else None
    return None


class _Subjects:
    """Subject lookup by name (Bangla or English) or slug, built once per import."""

    def __init__(self):
        self._by_key: dict[str, list[Subject]] = {}
        for subject in Subject.objects.select_related("category"):
            for value in (subject.name_bn, subject.name_en, subject.slug):
                key = self._key(value)
                if key and subject not in self._by_key.setdefault(key, []):
                    self._by_key[key].append(subject)

    @staticmethod
    def _key(value) -> str:
        return " ".join(unicodedata.normalize("NFC", str(value or "")).split()).casefold()

    def find(self, value: str) -> tuple[Subject | None, str]:
        matches = self._by_key.get(self._key(value), [])
        if not matches:
            return None, "subject_unknown"
        if len(matches) > 1:
            return None, "subject_ambiguous"
        return matches[0], ""


def _validation_errors(row: int, exc: ValidationError) -> list[RowError]:
    errors = []
    items = exc.error_dict.items() if hasattr(exc, "error_dict") else [("question", exc.error_list)]
    for name, error_list in items:
        for error in error_list:
            errors.append(
                RowError(
                    row=row,
                    field=_field_name(name),
                    code=error.code or "invalid",
                    message=" ".join(str(m) for m in error.messages),
                )
            )
    return errors


def _field_name(name: str) -> str:
    if name in ("text_bn", "text_en", "__all__"):
        return "question"
    if name.startswith("explanation"):
        return "explanation"
    return name


def _parse_row(number: int, row: dict, subjects: _Subjects, default: Subject | None):
    """Returns (ParsedRow | None, [RowError])."""
    errors: list[RowError] = []

    def fail(field_name: str, code: str, message: str):
        errors.append(RowError(number, field_name, code, message))

    # subject
    subject = default
    named = row.get("subject", "")
    if named:
        subject, code = subjects.find(named)
        if subject is None:
            fail(
                "subject",
                code,
                f"No single subject matches '{named[:60]}'. Use the exact name or slug of an "
                "existing subject.",
            )
    elif subject is None:
        fail("subject", "subject_required", "Give a subject (or choose a default subject).")

    # question text
    question = _bilingual(row, "question")
    if not (question["bn"] or question["en"]):
        fail("question", "question_required", "The question text is empty.")

    # options
    option_texts: list[dict] = []
    last = -1
    question_languages = tuple(lang for lang in ("bn", "en") if question[lang])
    for index, letter in enumerate(LETTERS):
        pair = _bilingual(row, f"option_{letter}", question_languages)
        if pair["bn"] or pair["en"]:
            last = index
        option_texts.append(pair)
    present = option_texts[: last + 1]
    gaps = [LETTERS[i].upper() for i, pair in enumerate(present) if not (pair["bn"] or pair["en"])]
    if last < 0:
        fail("options", "options_missing", "No options found (columns option_a, option_b, ...).")
    elif gaps:
        fail(
            "options", "option_gap", f"Option {', '.join(gaps)} is empty but a later one is filled."
        )

    # correct answer
    correct_index = None
    given = row.get("correct_answer", "")
    if not given:
        fail("correct_answer", "correct_answer_missing", "Mark the correct answer (A, B, C, ...).")
    else:
        correct_index = _answer_index(given)
        if correct_index is None or (last >= 0 and correct_index > last):
            fail(
                "correct_answer",
                "correct_answer_invalid",
                f"'{given[:20]}' is not one of the options "
                f"(use A..{LETTERS[max(last, 0)].upper()}).",
            )
            correct_index = None

    # optional fields
    explanation = _bilingual(row, "explanation", question_languages)
    chapter = row.get("chapter", "")
    topic = row.get("topic", "")
    for name, value in (("chapter", chapter), ("topic", topic)):
        if len(value) > LABEL_MAX_LENGTH:
            fail(name, "too_long", f"Too long (maximum {LABEL_MAX_LENGTH} characters).")
    difficulty = row.get("difficulty", "").lower()
    if difficulty and difficulty not in Difficulty.values:
        fail("difficulty", "difficulty_invalid", "Use easy, medium or hard (or leave it empty).")
        difficulty = ""

    if errors or subject is None or correct_index is None:
        return None, errors

    fields = {
        "subject": subject,
        "text_bn": question["bn"],
        "text_en": question["en"],
        "explanation_bn": explanation["bn"],
        "explanation_en": explanation["en"],
        "chapter": chapter,
        "topic": topic,
        "difficulty": difficulty,
    }
    options = [
        {
            "text_bn": pair["bn"],
            "text_en": pair["en"],
            "is_correct": index == correct_index,
            "sort_order": index,
        }
        for index, pair in enumerate(present)
    ]
    # The very same checks a hand-made question goes through (no database writes).
    candidate = Question(**fields)
    try:
        candidate.full_clean(exclude=["image", "created_by"], validate_constraints=False)
        services.build_options(candidate, options)
    except ValidationError as exc:
        return None, _validation_errors(number, exc)
    fields.update(
        text_bn=candidate.text_bn,
        text_en=candidate.text_en,
        explanation_bn=candidate.explanation_bn,
        explanation_en=candidate.explanation_en,
        chapter=candidate.chapter,
        topic=candidate.topic,
    )
    return ParsedRow(number, subject, fields, options, correct_index), []


def _preview(item: ParsedRow) -> dict:
    text = item.fields["text_bn"] or item.fields["text_en"]
    return {
        "row": item.row,
        "subject": item.subject.name_en or item.subject.name_bn,
        "question": text[:140],
        "options": len(item.options),
        "correct": LETTERS[item.correct_index].upper(),
        "chapter": item.fields["chapter"],
        "topic": item.fields["topic"],
    }


# --------------------------------------------------------------------------------------
# Checking the whole file
# --------------------------------------------------------------------------------------
KNOWN = {
    "question", "question_bn", "question_en", "correct_answer", "explanation", "explanation_bn",
    "explanation_en", "subject", "chapter", "topic", "difficulty",
} | {f"option_{x}{suffix}" for x in LETTERS for suffix in ("", "_bn", "_en")}  # fmt: skip


def _existing_keys(parsed: list[ParsedRow]) -> set[tuple]:
    """(subject, bn, en) of questions already in the bank that match a row of this file."""
    found: set[tuple] = set()
    keys = [(p.subject.pk, p.fields["text_bn"], p.fields["text_en"]) for p in parsed]
    for start in range(0, len(keys), 400):
        chunk = keys[start : start + 400]
        query = Q()
        for subject_id, bn, en in chunk:
            query |= Q(subject_id=subject_id, text_bn=bn, text_en=en)
        found.update(Question.objects.filter(query).values_list("subject_id", "text_bn", "text_en"))
    return found


def analyse(upload, default_subject_id: int | None = None) -> Report:
    """Check every row. Writes nothing."""
    headers, body = read_table(upload)
    default = None
    if default_subject_id is not None:
        default = Subject.objects.filter(pk=default_subject_id).first()
        if default is None:
            raise ImportFileError("subject_unknown", "The default subject does not exist.")
    report = Report(
        total_rows=len(body),
        columns=headers,
        unknown_columns=sorted({h for h in headers if h not in KNOWN}),
    )
    subjects = _Subjects()
    parsed: list[ParsedRow] = []
    for number, row in body:
        item, errors = _parse_row(number, row, subjects, default)
        if item is None:
            report.errors.extend(errors)
            report.invalid_rows += 1
        else:
            parsed.append(item)

    # The same question twice in the file, or already in the bank: skip (re-uploading a file
    # never doubles the questions).
    existing = _existing_keys(parsed)
    seen: dict[tuple, int] = {}
    for item in parsed:
        key = (item.subject.pk, item.fields["text_bn"], item.fields["text_en"])
        if key in existing:
            report.errors.append(
                RowError(
                    item.row,
                    "question",
                    "already_exists",
                    "This question is already in the bank for this subject.",
                )
            )
            report.invalid_rows += 1
        elif key in seen:
            report.errors.append(
                RowError(
                    item.row,
                    "question",
                    "duplicate_in_file",
                    f"Same question as row {seen[key]} of this file.",
                )
            )
            report.invalid_rows += 1
        else:
            seen[key] = item.row
            report.valid.append(item)
    report.errors.sort(key=lambda error: (error.row, error.field))
    return report


def preview(upload, default_subject_id: int | None = None) -> dict:
    return analyse(upload, default_subject_id).as_dict(committed=False)


def commit(
    upload, default_subject_id: int | None, *, ctx: AuditContext, on_error: str = "skip"
) -> dict:
    """Import the valid rows. ``on_error="abort"`` imports nothing when any row is wrong."""
    report = analyse(upload, default_subject_id)
    if report.invalid_rows and on_error == "abort":
        report.aborted = True
        return report.as_dict(committed=True)
    with transaction.atomic():
        for item in report.valid:
            try:
                with transaction.atomic():
                    services.create_question(Question(**item.fields), item.options, ctx=ctx)
            except ValidationError as exc:  # e.g. the subject was removed meanwhile
                report.errors.extend(_validation_errors(item.row, exc))
                report.invalid_rows += 1
                continue
            report.created += 1
        if report.created:
            audit.record(
                ctx,
                action="question.import",
                entity_type="questions.question",
                entity_id="import",
                summary=f"imported {report.created} question(s), skipped {report.invalid_rows}",
            )
    report.errors.sort(key=lambda error: (error.row, error.field))
    return report.as_dict(committed=True)


# --------------------------------------------------------------------------------------
# Templates
# --------------------------------------------------------------------------------------
TEMPLATE_HEADERS = (
    "question", "option_a", "option_b", "option_c", "option_d", "correct_answer",
    "explanation", "subject", "chapter", "topic", "difficulty",
)  # fmt: skip
TEMPLATE_ROWS = (
    (
        "What is the capital of Bangladesh?", "Dhaka", "Chattogram", "Khulna", "Rajshahi", "A",
        "Dhaka is the capital and largest city.", "General Knowledge", "Bangladesh", "Capital",
        "easy",
    ),
    (
        "বাংলাদেশের জাতীয় ফুল কোনটি?", "গোলাপ", "শাপলা", "রজনীগন্ধা", "জবা", "খ",
        "জাতীয় ফুল শাপলা।", "সাধারণ জ্ঞান", "বাংলাদেশ", "জাতীয় প্রতীক", "easy",
    ),
)  # fmt: skip


def template_csv() -> bytes:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(TEMPLATE_HEADERS)
    writer.writerows(TEMPLATE_ROWS)
    return ("﻿" + out.getvalue()).encode("utf-8")  # BOM: Excel opens Bangla correctly


def template_xlsx() -> bytes:
    from openpyxl import Workbook

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "questions"
    sheet.append(list(TEMPLATE_HEADERS))
    for row in TEMPLATE_ROWS:
        sheet.append(list(row))
    out = io.BytesIO()
    workbook.save(out)
    return out.getvalue()
