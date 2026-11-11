# ruff: noqa: F811 -- imported pytest fixtures are re-named as test arguments
"""A PDF attached to a notice: the admin attaches it, the website opens it for a public notice,
the app gets a short-lived signed address for a students' notice. Same checks as the routine PDF."""

import json
from datetime import timedelta

import pytest
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.audit.models import AuditLog
from apps.cms import services
from apps.cms.models import Announcement
from tests.test_cms import CTX, admin_user, announcement, api  # noqa: F401
from tests.test_subscriptions import jwt_client, make_student

pytestmark = pytest.mark.django_db

GOOD_PDF = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"
ADMIN = "/api/v1/admin/announcements/"
PUBLIC = "/api/v1/public/announcements/"
STUDENT = "/api/v1/announcements/"
FILES = "/api/v1/public/notice-files/"


def live(audience="all", **fields):
    fields.setdefault("title_en", "Result notice")
    fields.setdefault("body_en", "See the attached PDF.")
    return announcement(
        audience=audience, published_at=timezone.now() - timedelta(hours=1), **fields
    )


def attach(api, notice, data=GOOD_PDF, name="notice.pdf"):
    upload = SimpleUploadedFile(name, data, content_type="application/pdf")
    return api.post(f"{ADMIN}{notice.pk}/pdf/", {"file": upload}, format="multipart")


def body(response):
    return b"".join(response.streaming_content)


# --------------------------------------------------------------------------------------
# The admin attaches and removes
# --------------------------------------------------------------------------------------
def test_attaching_a_pdf_shows_it_on_the_notice(api):
    notice = live()
    assert api.get(f"{ADMIN}{notice.pk}/").json()["pdf"]["available"] is False
    response = attach(api, notice, name="exam-result.pdf")
    assert response.status_code == 200, response.content
    info = response.json()["pdf"]
    assert info == {"available": True, "name": "exam-result.pdf", "size_bytes": len(GOOD_PDF)}
    assert api.get(f"{ADMIN}{notice.pk}/").json()["pdf"]["available"] is True


def test_replacing_removes_the_old_file_and_removing_clears_it(
    api, django_capture_on_commit_callbacks
):
    notice = live()
    with django_capture_on_commit_callbacks(execute=True):
        attach(api, notice)
    first = Announcement.objects.get(pk=notice.pk).pdf.name
    with django_capture_on_commit_callbacks(execute=True):
        attach(api, notice, GOOD_PDF + b"\n% second\n%%EOF\n")
    second = Announcement.objects.get(pk=notice.pk).pdf.name
    assert second != first and default_storage.exists(second) and not default_storage.exists(first)
    with django_capture_on_commit_callbacks(execute=True):
        response = api.delete(f"{ADMIN}{notice.pk}/pdf/")
    assert response.json()["pdf"]["available"] is False
    assert not default_storage.exists(second)


def test_editing_the_notice_keeps_its_pdf(api):
    notice = live()
    attach(api, notice)
    api.patch(f"{ADMIN}{notice.pk}/", {"title_en": "New title"}, format="json")
    assert api.get(f"{ADMIN}{notice.pk}/").json()["pdf"]["available"] is True


def test_deleting_the_notice_deletes_its_file(api, django_capture_on_commit_callbacks):
    notice = live()
    attach(api, notice)
    name = Announcement.objects.get(pk=notice.pk).pdf.name
    with django_capture_on_commit_callbacks(execute=True):
        assert api.delete(f"{ADMIN}{notice.pk}/").status_code == 204
    assert not default_storage.exists(name)


@pytest.mark.parametrize(
    ("data", "code"),
    [
        (b"<html></html>", "file_not_pdf"),
        (b"%PDF-1.4\nno end marker", "file_not_pdf"),
        (b"%PDF-1.4\n<< /S /JavaScript /JS (x) >>\n%%EOF", "pdf_active_content"),
        (b"%PDF-1.4\n<< /S /Launch >>\n%%EOF", "pdf_active_content"),
    ],
)
def test_a_file_that_is_not_a_plain_pdf_is_refused(api, data, code):
    notice = live()
    response = attach(api, notice, data)
    assert response.status_code == 400 and response.json()["error"]["code"] == code
    assert not Announcement.objects.get(pk=notice.pk).pdf


def test_missing_notice_and_missing_file_are_clean_errors(api):
    assert attach(api, type("N", (), {"pk": 999999})()).status_code == 404
    notice = live()
    assert api.post(f"{ADMIN}{notice.pk}/pdf/", {}, format="multipart").status_code == 400
    assert api.delete(f"{ADMIN}999999/pdf/").status_code == 404


def test_the_stored_name_is_random_not_the_uploads(api):
    notice = live()
    attach(api, notice, name="../../secret.pdf")
    stored = Announcement.objects.get(pk=notice.pk).pdf.name
    assert stored.startswith("documents/") and "secret" not in stored and ".." not in stored


def test_each_change_is_audited_without_the_file(api):
    notice = live()
    attach(api, notice, name="private-notice-name.pdf")
    api.delete(f"{ADMIN}{notice.pk}/pdf/")
    actions = set(
        AuditLog.objects.filter(entity_type="cms.announcement").values_list("action", flat=True)
    )
    assert {"announcement.pdf_set", "announcement.pdf_remove"} <= actions
    blob = json.dumps(list(AuditLog.objects.values()), default=str)
    assert "%PDF" not in blob and "private-notice-name" not in blob


def test_only_an_admin_can_attach_or_remove(api):
    notice = live()
    student = User.objects.create_user(
        "01712349999", password="Strong-Pass-2026", full_name="S", role=Role.STUDENT
    )
    for client in (APIClient(), jwt_client(student)):
        upload = SimpleUploadedFile("a.pdf", GOOD_PDF)
        assert client.post(
            f"{ADMIN}{notice.pk}/pdf/", {"file": upload}, format="multipart"
        ).status_code in (401, 403)
        assert client.delete(f"{ADMIN}{notice.pk}/pdf/").status_code in (401, 403)
    assert not Announcement.objects.get(pk=notice.pk).pdf


def test_a_cross_site_attach_without_the_csrf_token_is_refused(admin_user):
    notice = live()
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(admin_user)
    upload = SimpleUploadedFile("a.pdf", GOOD_PDF)
    assert (
        client.post(f"{ADMIN}{notice.pk}/pdf/", {"file": upload}, format="multipart").status_code
        == 403
    )


# --------------------------------------------------------------------------------------
# The website
# --------------------------------------------------------------------------------------
def test_a_public_notice_lists_its_pdf_and_anyone_can_open_it(api):
    notice = live(audience="public")
    attach(api, notice)
    item = APIClient().get(PUBLIC).json()["results"][0]
    assert item["id"] == notice.pk and item["pdf"]["available"] is True
    served = APIClient().get(f"{PUBLIC}{notice.pk}/pdf/")
    assert served.status_code == 200 and body(served) == GOOD_PDF
    assert (
        served["Content-Type"] == "application/pdf"
        and served["X-Content-Type-Options"] == "nosniff"
    )
    assert served["Content-Security-Policy"] == "default-src 'none'"
    assert (
        APIClient().get(f"{PUBLIC}{notice.pk}/pdf/", HTTP_IF_NONE_MATCH=served["ETag"]).status_code
        == 304
    )


def test_a_notice_without_a_pdf_says_so_and_has_no_download(api):
    notice = live(audience="public")
    assert APIClient().get(PUBLIC).json()["results"][0]["pdf"]["available"] is False
    assert APIClient().get(f"{PUBLIC}{notice.pk}/pdf/").status_code == 404


def test_the_website_never_serves_a_draft_expired_or_students_only_pdf(api):
    drafts = announcement(audience="public", title_en="Draft", body_en="x", published_at=None)
    expired = live(
        audience="public", title_en="Old", expires_at=timezone.now() - timedelta(minutes=1)
    )
    expired.published_at = timezone.now() - timedelta(days=2)
    expired.save()
    students_only = live(audience="students", title_en="Students")
    for notice in (drafts, expired, students_only):
        attach(api, notice)
        assert APIClient().get(f"{PUBLIC}{notice.pk}/pdf/").status_code == 404, notice.title_en


# --------------------------------------------------------------------------------------
# The app: a short-lived signed address
# --------------------------------------------------------------------------------------
def test_a_student_gets_a_signed_address_that_opens_the_pdf_without_a_token(api):
    notice = live(audience="students")
    attach(api, notice)
    student = jwt_client(make_student())
    listed = student.get(STUDENT).json()["results"][0]
    assert listed["id"] == notice.pk and listed["pdf"]["available"] is True
    link = student.get(f"{STUDENT}{notice.pk}/pdf-link/")
    assert link.status_code == 200 and link.json()["expires_in"] == 600
    opened = APIClient().get(f"/api/v1{link.json()['path']}")  # no login at all, like a browser
    assert opened.status_code == 200 and body(opened) == GOOD_PDF


def test_the_link_needs_a_student_and_a_notice_that_students_may_see(api):
    students = live(audience="students")
    public_only = live(audience="public", title_en="Public only")
    drafts = announcement(audience="students", title_en="Draft", body_en="x", published_at=None)
    for notice in (students, public_only, drafts):
        attach(api, notice)
    assert APIClient().get(f"{STUDENT}{students.pk}/pdf-link/").status_code in (401, 403)
    client = jwt_client(make_student())
    assert client.get(f"{STUDENT}{students.pk}/pdf-link/").status_code == 200
    assert client.get(f"{STUDENT}{public_only.pk}/pdf-link/").status_code == 404
    assert client.get(f"{STUDENT}{drafts.pk}/pdf-link/").status_code == 404
    assert client.get(f"{STUDENT}999999/pdf-link/").status_code == 404


def test_a_forged_or_altered_address_opens_nothing(api):
    notice = live(audience="students")
    attach(api, notice)
    client = jwt_client(make_student())
    good = client.get(f"{STUDENT}{notice.pk}/pdf-link/").json()["path"]
    for bad in (
        good[:-3] + "xx/",
        good.replace("notice-files/", "notice-files/A"),
        "/public/notice-files/not-a-token/",
        "/public/notice-files/12/",
    ):
        assert APIClient().get(f"/api/v1{bad}").status_code == 404, bad


def test_an_address_expires(api, monkeypatch):
    from apps.cms.api import views

    notice = live(audience="students")
    attach(api, notice)
    path = jwt_client(make_student()).get(f"{STUDENT}{notice.pk}/pdf-link/").json()["path"]
    monkeypatch.setattr(views, "NOTICE_LINK_SECONDS", -1)
    assert APIClient().get(f"/api/v1{path}").status_code == 404


def test_an_address_stops_working_when_the_notice_is_no_longer_visible(api):
    notice = live(audience="students")
    attach(api, notice)
    path = jwt_client(make_student()).get(f"{STUDENT}{notice.pk}/pdf-link/").json()["path"]
    assert APIClient().get(f"/api/v1{path}").status_code == 200
    services.update_content(
        Announcement, notice.pk, {"published_at": None}, ctx=CTX
    )  # back to draft
    assert APIClient().get(f"/api/v1{path}").status_code == 404
