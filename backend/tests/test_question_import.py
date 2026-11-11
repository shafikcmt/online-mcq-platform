# ruff: noqa: F811 -- imported pytest fixtures are re-named as test arguments
"""Bulk question import (CSV / Excel): reading, checking, importing, limits and safety."""

import io
import json
import zipfile

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.audit.models import AuditLog
from apps.audit.services import AuditContext
from apps.catalog import services as catalog
from apps.catalog.models import Category, Subject
from apps.questions import importer
from apps.questions.models import Question
from tests.test_questions import PW, admin_user, api, make_subject  # noqa: F401

pytestmark = pytest.mark.django_db

URL = "/api/v1/admin/questions/import/"
HEAD = (
    "question,option_a,option_b,option_c,option_d,correct_answer,"
    "explanation,subject,chapter,topic,difficulty"
)


def csv_file(text: str, name="q.csv") -> SimpleUploadedFile:
    return SimpleUploadedFile(name, text.encode("utf-8"), content_type="text/csv")


def xlsx_file(rows, name="q.xlsx") -> SimpleUploadedFile:
    from openpyxl import Workbook

    workbook = Workbook()
    for row in rows:
        workbook.active.append(row)
    out = io.BytesIO()
    workbook.save(out)
    return SimpleUploadedFile(name, out.getvalue())


def good(n=1, subject="Physics"):
    return "\n".join(
        f"What is {i}+{i}?,{i},{i * 2},{i * 3},{i * 4},B,Because maths,{subject},Algebra,Sums,easy"
        for i in range(1, n + 1)
    )


def send(api, upload, **extra):
    return api.post(URL, {"file": upload, **extra}, format="multipart")


@pytest.fixture
def subject():
    return make_subject("physics")


# --------------------------------------------------------------------------------------
# Reading and checking
# --------------------------------------------------------------------------------------
def test_preview_checks_every_row_and_writes_nothing(api, subject):
    text = HEAD + "\n" + good(3)
    response = send(api, csv_file(text))
    assert response.status_code == 200, response.content
    body = response.json()
    assert (body["total_rows"], body["valid_rows"], body["invalid_rows"]) == (3, 3, 0)
    assert body["preview"][0]["correct"] == "B" and body["preview"][0]["options"] == 4
    assert body["errors"] == [] and body["unknown_columns"] == []
    assert Question.objects.count() == 0


def test_import_creates_questions_with_options_chapter_and_topic(api, subject, admin_user):
    response = send(api, csv_file(HEAD + "\n" + good(2)), mode="import")
    assert response.status_code == 200, response.content
    body = response.json()
    assert (body["created"], body["skipped"], body["aborted"]) == (2, 0, False)
    question = Question.objects.get(text_en="What is 1+1?")
    assert question.subject == subject and question.created_by == admin_user
    assert (question.chapter, question.topic, question.difficulty) == ("Algebra", "Sums", "easy")
    assert question.available_languages == "en"
    options = list(question.options.order_by("sort_order"))
    assert [o.text_en for o in options] == ["1", "2", "3", "4"]
    assert [o.is_correct for o in options] == [False, True, False, False]
    assert AuditLog.objects.filter(action="question.create").count() == 2
    assert AuditLog.objects.filter(action="question.import").count() == 1


def test_bangla_text_letters_and_digits(api, subject):
    text = (
        "question,option_a,option_b,option_c,option_d,correct_answer,subject\n"
        "বাংলাদেশের জাতীয় ফুল কোনটি?,গোলাপ,শাপলা,রজনীগন্ধা,জবা,খ,Physics\n"
        "দুই আর দুই কত?,৩,৪,৫,৬,২,Physics\n"
    )
    body = send(api, csv_file(text), mode="import").json()
    assert body["created"] == 2, body
    first = Question.objects.get(text_bn__startswith="বাংলাদেশের")
    assert first.available_languages == "bn"
    assert [o.is_correct for o in first.options.order_by("sort_order")] == [
        False,
        True,
        False,
        False,
    ]
    second = Question.objects.get(text_bn__startswith="দুই")
    assert second.options.get(is_correct=True).text_bn == "৪"


def test_a_bilingual_question_uses_the_language_columns(api, subject):
    text = (
        "question_bn,question_en,option_a_bn,option_a_en,option_b_bn,option_b_en,correct_answer,subject\n"
        "রাজধানী কোনটি?,Which is the capital?,ঢাকা,Dhaka,খুলনা,Khulna,A,Physics\n"
    )
    assert send(api, csv_file(text), mode="import").json()["created"] == 1
    question = Question.objects.get()
    assert question.available_languages == "both"
    assert question.options.get(is_correct=True).text_en == "Dhaka"


def test_headers_are_case_insensitive_with_aliases_and_any_order(api, subject):
    text = "Answer,Option B,Option A,QUESTION,Subject\nA,two,one,Pick one,Physics\n"
    body = send(api, csv_file(text), mode="import").json()
    assert body["created"] == 1, body
    question = Question.objects.get()
    assert question.options.get(is_correct=True).text_en == "one"


def test_semicolon_and_tab_delimiters_and_a_utf8_bom(api, subject):
    for delimiter in (";", "\t"):
        text = (
            "﻿"
            + delimiter.join(["question", "option_a", "option_b", "correct_answer", "subject"])
            + "\n"
        )
        text += f"Q {ord(delimiter)}{delimiter}x{delimiter}y{delimiter}A{delimiter}Physics\n"
        assert send(api, csv_file(text)).json()["valid_rows"] == 1


def test_an_excel_file_works_like_a_csv(api, subject):
    rows = [
        ["question", "option_a", "option_b", "correct_answer", "subject", "chapter"],
        ["Two plus two?", 3, 4, "B", "Physics", "Maths"],
        ["বাংলা প্রশ্ন?", "ক", "খ", "ক", "Physics", None],
    ]
    body = send(api, xlsx_file(rows), mode="import").json()
    assert body["created"] == 2, body
    assert Question.objects.get(text_en="Two plus two?").options.get(is_correct=True).text_en == "4"


def test_the_default_subject_fills_a_missing_subject_column(api, subject):
    text = "question,option_a,option_b,correct_answer\nQ1,a,b,A\n"
    assert send(api, csv_file(text)).json()["errors"][0]["code"] == "subject_required"
    body = send(api, csv_file(text), subject=subject.pk, mode="import").json()
    assert body["created"] == 1 and Question.objects.get().subject == subject


def test_a_subject_is_found_by_name_or_slug_and_never_created(api, subject):
    text = (
        "question,option_a,option_b,correct_answer,subject\n"
        "Q1,a,b,A,PHYSICS\nQ2,a,b,A,physics\nQ3,a,b,A,Chemistry\n"
    )
    body = send(api, csv_file(text)).json()
    assert body["valid_rows"] == 2
    assert [e["code"] for e in body["errors"]] == ["subject_unknown"]
    assert Subject.objects.count() == 1


def test_a_name_shared_by_two_subjects_is_ambiguous(api, subject):
    other = Category.objects.create(name_en="Other", slug="other")
    Subject.objects.create(category=other, name_en="Physics", slug="physics-2")
    text = "question,option_a,option_b,correct_answer,subject\nQ1,a,b,A,Physics\n"
    assert send(api, csv_file(text)).json()["errors"][0]["code"] == "subject_ambiguous"


# --------------------------------------------------------------------------------------
# What is refused, and why
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("row", "field", "code"),
    [
        (",a,b,c,d,A,Physics", "question", "question_required"),
        ("Q,a,b,c,d,,Physics", "correct_answer", "correct_answer_missing"),
        ("Q,a,b,c,d,E,Physics", "correct_answer", "correct_answer_invalid"),
        ("Q,a,b,c,d,Z,Physics", "correct_answer", "correct_answer_invalid"),
        ("Q,a,b,c,d,0,Physics", "correct_answer", "correct_answer_invalid"),
        ("Q,a,,c,d,A,Physics", "options", "option_gap"),
        ("Q,a,,,,A,Physics", "options", "option_count"),
        ("Q,a,a,c,d,A,Physics", "options", "duplicate_option"),
        ("Q,,,,,A,Physics", "options", "options_missing"),
    ],
)
def test_each_kind_of_wrong_row_is_named(api, subject, row, field, code):
    header = "question,option_a,option_b,option_c,option_d,correct_answer,subject"
    body = send(api, csv_file(f"{header}\n{row}\n")).json()
    assert body["valid_rows"] == 0 and body["invalid_rows"] == 1
    assert (body["errors"][0]["field"], body["errors"][0]["code"]) == (field, code), body


def test_bad_difficulty_and_long_labels(api, subject):
    text = (
        "question,option_a,option_b,correct_answer,subject,difficulty,chapter\n"
        f"Q1,a,b,A,Physics,impossible,\nQ2,a,b,A,Physics,,{'x' * 200}\n"
    )
    codes = {e["code"] for e in send(api, csv_file(text)).json()["errors"]}
    assert codes == {"difficulty_invalid", "too_long"}


def test_good_rows_survive_beside_bad_ones_and_import_only_the_good(api, subject):
    text = HEAD + "\n" + good(2) + "\nNo answer,a,b,c,d,,Physics,,,\n"
    body = send(api, csv_file(text), mode="import").json()
    assert (body["created"], body["skipped"]) == (2, 1)
    assert body["errors"][0]["row"] == 4  # header = row 1
    assert Question.objects.count() == 2


def test_abort_mode_imports_nothing_when_any_row_is_wrong(api, subject):
    text = HEAD + "\n" + good(2) + "\nNo answer,a,b,c,d,,Physics,,,\n"
    body = send(api, csv_file(text), mode="import", on_error="abort").json()
    assert body["aborted"] is True and body["created"] == 0
    assert Question.objects.count() == 0


def test_the_same_question_twice_in_a_file_is_skipped(api, subject):
    text = HEAD + "\n" + good(1) + "\n" + good(1) + "\n"
    body = send(api, csv_file(text), mode="import").json()
    assert (body["created"], body["skipped"]) == (1, 1)
    assert body["errors"][0]["code"] == "duplicate_in_file"


def test_uploading_the_same_file_again_does_not_double_the_questions(api, subject):
    text = HEAD + "\n" + good(3)
    assert send(api, csv_file(text), mode="import").json()["created"] == 3
    again = send(api, csv_file(text), mode="import").json()
    assert (again["created"], again["skipped"]) == (0, 3)
    assert {e["code"] for e in again["errors"]} == {"already_exists"}
    assert Question.objects.count() == 3


def test_unknown_columns_are_reported_not_silently_dropped(api, subject):
    text = "question,option_a,option_b,correct_answer,subject,colour\nQ,a,b,A,Physics,red\n"
    assert send(api, csv_file(text)).json()["unknown_columns"] == ["colour"]


# --------------------------------------------------------------------------------------
# The file itself
# --------------------------------------------------------------------------------------
def code_of(response):
    assert response.status_code == 400, response.content
    return response.json()["error"]["code"]


def test_file_level_refusals(api, subject, settings):
    assert code_of(send(api, SimpleUploadedFile("q.txt", b"question\nx"))) == "file_type"
    assert code_of(send(api, SimpleUploadedFile("q.csv", b""))) in {
        "file_empty",
        "validation_error",
    }
    assert code_of(send(api, csv_file("question,option_a\n"))) == "no_rows"
    assert code_of(send(api, csv_file("\n\n"))) in {"header_missing", "file_empty"}
    assert code_of(send(api, SimpleUploadedFile("q.csv", "ভুল".encode("utf-16")))) in {
        "csv_encoding",
        "file_invalid",
    }
    assert code_of(send(api, SimpleUploadedFile("q.xlsx", b"not a workbook"))) == "file_invalid"
    assert code_of(send(api, SimpleUploadedFile("q.xlsx", b"PKnope"))) == "file_invalid"
    assert api.post(URL, {}, format="multipart").status_code == 400


def test_size_and_row_limits(api, subject, settings):
    settings.QUESTION_IMPORT_MAX_ROWS = 3
    assert code_of(send(api, csv_file(HEAD + "\n" + good(4)))) == "too_many_rows"
    assert send(api, csv_file(HEAD + "\n" + good(3))).status_code == 200
    settings.QUESTION_IMPORT_MAX_BYTES = 100
    assert code_of(send(api, csv_file(HEAD + "\n" + good(3)))) == "file_too_large"


def test_a_workbook_that_unpacks_huge_is_refused(api, subject, monkeypatch):
    monkeypatch.setattr(importer, "MAX_WORKBOOK_UNCOMPRESSED_BYTES", 1000)
    rows = [
        ["question", "option_a", "option_b", "correct_answer", "subject"],
        ["Q" * 5000, "a", "b", "A", "Physics"],
    ]
    assert code_of(send(api, xlsx_file(rows))) == "file_invalid"


def test_a_workbook_formula_is_never_evaluated(api, subject):
    """A formula cell has no stored text value here: it reads as empty and the row is refused,
    instead of anything being calculated or run."""
    rows = [
        ["question", "option_a", "option_b", "correct_answer", "subject"],
        ["=1+1", "a", "b", "A", "Physics"],
        ['=HYPERLINK("http://evil.example")', "a", "b", "A", "Physics"],
    ]
    body = send(api, xlsx_file(rows), mode="import").json()
    assert body["created"] == 0
    assert {e["code"] for e in body["errors"]} == {"question_required"}
    assert Question.objects.count() == 0


def test_text_that_only_looks_like_a_formula_is_kept_as_plain_text(api, subject):
    text = "question,option_a,option_b,correct_answer,subject\n'=1+1 equals?,2,3,A,Physics\n"
    assert send(api, csv_file(text), mode="import").json()["created"] == 1
    assert Question.objects.get().text_en == "'=1+1 equals?"


def test_the_templates_download_and_pass_their_own_checks(api, subject):
    csv_response = api.get(URL + "template/", {"file_format": "csv"})
    assert csv_response.status_code == 200
    assert "attachment" in csv_response["Content-Disposition"]
    assert csv_response["Content-Type"].startswith("text/csv")
    xlsx_response = api.get(URL + "template/", {"file_format": "xlsx"})
    assert xlsx_response.status_code == 200 and xlsx_response.content.startswith(b"PK")
    assert zipfile.is_zipfile(io.BytesIO(xlsx_response.content))
    assert api.get(URL + "template/", {"file_format": "exe"}).status_code == 400
    # A template filled with real subject names is accepted as it is.
    catalog.create_subject(
        Subject(
            category=Category.objects.get(slug="science"), name_en="General Knowledge", slug="gk"
        ),
        ctx=AuditContext(),
    )
    catalog.create_subject(
        Subject(category=Category.objects.get(slug="science"), name_bn="সাধারণ জ্ঞান", slug="gk-bn"),
        ctx=AuditContext(),
    )
    for kind, response in (("csv", csv_response), ("xlsx", xlsx_response)):
        upload = SimpleUploadedFile(f"t.{kind}", response.content)
        body = send(api, upload).json()
        assert (body["total_rows"], body["valid_rows"]) == (2, 2), (kind, body)


# --------------------------------------------------------------------------------------
# Who may use it, and abuse
# --------------------------------------------------------------------------------------
def test_only_an_admin_can_import_or_download_templates(subject):
    student = User.objects.create_user("01712340000", password=PW, full_name="S", role=Role.STUDENT)
    for client in (APIClient(), _login(student)):
        assert client.post(
            URL, {"file": csv_file(HEAD + "\n" + good(1))}, format="multipart"
        ).status_code in (401, 403)
        assert client.get(URL + "template/").status_code in (401, 403)
    assert Question.objects.count() == 0


def _login(user):
    client = APIClient()
    client.force_login(user)
    return client


def test_a_cross_site_request_without_the_csrf_token_is_refused(admin_user, subject):
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(admin_user)
    response = client.post(
        URL, {"file": csv_file(HEAD + "\n" + good(1)), "mode": "import"}, format="multipart"
    )
    assert response.status_code == 403
    assert Question.objects.count() == 0


def test_imports_are_limited_per_admin(api, subject, settings):
    settings.AUTH_THROTTLE_RATES = {**settings.AUTH_THROTTLE_RATES, "question_import": "2/hour"}
    text = HEAD + "\n" + good(1)
    codes = [send(api, csv_file(text)).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_the_import_log_carries_no_question_text(api, subject):
    send(api, csv_file(HEAD + "\n" + good(2)), mode="import")
    blob = json.dumps(list(AuditLog.objects.filter(action="question.import").values()), default=str)
    assert "What is" not in blob and "Because maths" not in blob


def test_one_bad_row_never_leaves_a_half_written_question(api, subject, monkeypatch):
    """If creating a row fails midway, that question leaves nothing behind (its options too)."""
    from apps.questions import services as question_services

    real = question_services.build_options
    calls = {"n": 0}

    def flaky(question, options):
        calls["n"] += 1
        if calls["n"] == 4:  # the second row, at commit time (preview used calls 1-2... )
            from django.core.exceptions import ValidationError

            raise ValidationError({"options": "boom"}, code="boom")
        return real(question, options)

    monkeypatch.setattr(question_services, "build_options", flaky)
    body = send(api, csv_file(HEAD + "\n" + good(2)), mode="import").json()
    assert body["created"] + body["skipped"] == 2
    from apps.questions.models import QuestionOption

    assert QuestionOption.objects.filter(question__isnull=True).count() == 0
    for question in Question.objects.all():
        assert question.options.count() == 4
