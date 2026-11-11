# ruff: noqa: F811 -- imported pytest fixtures are re-named as test arguments
"""Study materials: YouTube videos and PDF handouts by category, subject, exam and teacher."""

from datetime import timedelta

import pytest
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.materials import services
from apps.materials.models import MaterialKind, StudyMaterial, parse_youtube_id
from tests.test_cms import CTX, admin_user, api, public  # noqa: F401
from tests.test_exams import make_category, make_exam, make_subject

pytestmark = pytest.mark.django_db

GOOD_PDF = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"
VIDEO_ID = "dQw4w9WgXcQ"
ADMIN = "/api/v1/admin/materials/"
PUBLIC = "/api/v1/public/materials/"


def video(**fields):
    fields.setdefault("kind", "video")
    fields.setdefault("title_en", "Newton's laws")
    fields.setdefault("youtube_id", VIDEO_ID)
    fields.setdefault("published_at", timezone.now() - timedelta(minutes=1))
    return services.create_material(StudyMaterial(**fields), ctx=CTX)


def handout(**fields):
    fields.setdefault("kind", "pdf")
    fields.setdefault("title_en", "Formula sheet")
    fields.setdefault("published_at", timezone.now() - timedelta(minutes=1))
    return services.create_material(StudyMaterial(**fields), ctx=CTX)


def attach(api, item, data=GOOD_PDF):
    upload = SimpleUploadedFile("sheet.pdf", data, content_type="application/pdf")
    return api.post(f"{ADMIN}{item.pk}/pdf/", {"file": upload}, format="multipart")


def body(response):
    return b"".join(response.streaming_content)


# --------------------------------------------------------------------------------------
# Reading a YouTube link: only the 11-character ID is ever stored
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize(
    "link",
    [
        f"https://www.youtube.com/watch?v={VIDEO_ID}",
        f"https://www.youtube.com/watch?v={VIDEO_ID}&t=42s&list=PL123",
        f"http://youtube.com/watch?v={VIDEO_ID}",
        f"https://m.youtube.com/watch?v={VIDEO_ID}",
        f"https://youtu.be/{VIDEO_ID}",
        f"https://youtu.be/{VIDEO_ID}?si=abc",
        f"https://www.youtube.com/embed/{VIDEO_ID}",
        f"https://www.youtube-nocookie.com/embed/{VIDEO_ID}",
        f"https://www.youtube.com/shorts/{VIDEO_ID}",
        f"https://www.youtube.com/live/{VIDEO_ID}",
        f"youtube.com/watch?v={VIDEO_ID}",
        f"  {VIDEO_ID}  ",
    ],
)
def test_parses_every_normal_youtube_form(link):
    assert parse_youtube_id(link) == VIDEO_ID


@pytest.mark.parametrize(
    "link",
    [
        "",
        "   ",
        "not a link",
        "https://example.com/watch?v=" + VIDEO_ID,
        f"https://youtube.com.evil.example/watch?v={VIDEO_ID}",
        f"https://evil.example/https://www.youtube.com/watch?v={VIDEO_ID}",
        f"https://user:pw@www.youtube.com/watch?v={VIDEO_ID}",
        f"javascript:alert(1)//youtu.be/{VIDEO_ID}",
        f"ftp://youtu.be/{VIDEO_ID}",
        "https://www.youtube.com/watch?v=short",
        "https://www.youtube.com/watch?v=" + "x" * 12,
        "https://www.youtube.com/watch?v=<script>al",
        "https://www.youtube.com/playlist?list=PL12345678901",
        "https://www.youtube.com/",
        "x" * 400,
        f"https://youtu.be/{VIDEO_ID}\n",
    ],
)
def test_refuses_anything_that_is_not_a_youtube_video(link):
    # a trailing newline is stripped, so that last one is the single "valid" lookalike
    expected = VIDEO_ID if link.strip() == f"https://youtu.be/{VIDEO_ID}" else ""
    assert parse_youtube_id(link) == expected


# --------------------------------------------------------------------------------------
# Admin: create, edit, delete
# --------------------------------------------------------------------------------------
def test_admin_creates_a_video_from_a_pasted_link(api):
    category = make_category()
    response = api.post(
        ADMIN,
        {
            "kind": "video",
            "title_en": "Motion",
            "youtube_url": f"https://youtu.be/{VIDEO_ID}?t=9",
            "category": category.pk,
            "teacher": "  Rahim Sir ",
            "publish_now": True,
        },
        format="json",
    )
    assert response.status_code == 201, response.content
    data = response.json()
    assert data["youtube_id"] == VIDEO_ID
    assert data["watch_url"] == f"https://www.youtube.com/watch?v={VIDEO_ID}"
    assert data["state"] == "live"
    assert data["teacher"] == "Rahim Sir"
    assert data["category_label"] == "Science"
    assert "youtube_url" not in data  # write-only
    assert AuditLog.objects.filter(action="material.create").count() == 1


def test_a_bad_link_is_a_field_error_and_nothing_is_saved(api):
    response = api.post(
        ADMIN,
        {"kind": "video", "title_en": "x", "youtube_url": "https://example.com/v"},
        format="json",
    )
    assert response.status_code == 400
    assert "youtube_url" in str(response.json())
    assert StudyMaterial.objects.count() == 0


def test_a_video_needs_a_link_and_a_title(api):
    assert api.post(ADMIN, {"kind": "video", "title_en": "x"}, format="json").status_code == 400
    assert (
        api.post(ADMIN, {"kind": "video", "youtube_url": VIDEO_ID}, format="json").status_code
        == 400
    )
    assert StudyMaterial.objects.count() == 0


def test_a_pdf_material_never_keeps_a_video_id(api):
    response = api.post(
        ADMIN,
        {"kind": "pdf", "title_en": "Sheet", "youtube_url": f"https://youtu.be/{VIDEO_ID}"},
        format="json",
    )
    assert response.status_code == 201
    assert response.json()["youtube_id"] == ""


def test_a_subject_must_belong_to_the_chosen_category(api):
    science = make_category("science")
    arts = make_category("arts")
    physics = make_subject("physics", science)
    bad = api.post(
        ADMIN,
        {"kind": "pdf", "title_en": "x", "category": arts.pk, "subject": physics.pk},
        format="json",
    )
    assert bad.status_code == 400
    ok = api.post(
        ADMIN,
        {"kind": "pdf", "title_en": "x", "category": science.pk, "subject": physics.pk},
        format="json",
    )
    assert ok.status_code == 201


def test_edit_changes_the_video_and_a_no_op_writes_no_audit(api):
    item = video()
    before = AuditLog.objects.count()
    same = api.patch(f"{ADMIN}{item.pk}/", {"title_en": item.title_en}, format="json")
    assert same.status_code == 200
    assert AuditLog.objects.count() == before
    other = api.patch(
        f"{ADMIN}{item.pk}/", {"youtube_url": "https://youtu.be/aaaaaaaaaaa"}, format="json"
    )
    assert other.status_code == 200
    item.refresh_from_db()
    assert item.youtube_id == "aaaaaaaaaaa"
    entry = AuditLog.objects.get(action="material.update")
    assert entry.metadata["changed_fields"] == ["youtube_id"]


def test_drafts_are_not_published_and_can_be_scheduled(api):
    draft = api.post(ADMIN, {"kind": "pdf", "title_en": "Later"}, format="json").json()
    assert draft["state"] == "draft" and draft["published_at"] is None
    future = (timezone.now() + timedelta(days=2)).isoformat()
    scheduled = api.patch(f"{ADMIN}{draft['id']}/", {"published_at": future}, format="json").json()
    assert scheduled["state"] == "scheduled"


def test_admin_deletes_and_the_file_goes_with_it(api, django_capture_on_commit_callbacks):
    item = handout()
    assert attach(api, item).status_code == 200
    item.refresh_from_db()
    name = item.pdf.name
    assert default_storage.exists(name)
    with django_capture_on_commit_callbacks(execute=True):
        assert api.delete(f"{ADMIN}{item.pk}/").status_code == 204
    assert not StudyMaterial.objects.exists()
    assert not default_storage.exists(name)
    assert AuditLog.objects.filter(action="material.delete").count() == 1


def test_admin_list_filters(api):
    science = make_category("science")
    arts = make_category("arts")
    one = video(title_en="Alpha", category=science, teacher="Karim")
    two = handout(title_en="Beta", category=arts, published_at=None)
    ids = lambda query: {row["id"] for row in api.get(f"{ADMIN}{query}").json()["results"]}  # noqa: E731
    assert ids("") == {one.pk, two.pk}
    assert ids("?kind=video") == {one.pk}
    assert ids(f"?category={arts.pk}") == {two.pk}
    assert ids("?published=false") == {two.pk}
    assert ids("?search=karim") == {one.pk}
    assert ids("?category=abc") == {one.pk, two.pk}  # a non-number is ignored, not an error


def test_only_an_admin_can_manage_materials(public):
    assert public.get(ADMIN).status_code in (401, 403)
    assert public.post(ADMIN, {"kind": "pdf", "title_en": "x"}, format="json").status_code in (
        401,
        403,
    )


# --------------------------------------------------------------------------------------
# Admin: the PDF of a PDF material
# --------------------------------------------------------------------------------------
def test_attach_replace_and_remove_a_pdf(api, django_capture_on_commit_callbacks):
    item = handout()
    first = attach(api, item)
    assert first.status_code == 200
    assert first.json()["pdf"] == {
        "available": True,
        "name": "sheet.pdf",
        "size_bytes": len(GOOD_PDF),
    }
    item.refresh_from_db()
    old = item.pdf.name
    assert old.startswith("documents/") and "sheet" not in old  # random stored name
    with django_capture_on_commit_callbacks(execute=True):
        second = attach(api, item, GOOD_PDF + b"% more\n%%EOF\n")
    assert second.status_code == 200
    assert not default_storage.exists(old)  # replaced file is deleted
    removed = api.delete(f"{ADMIN}{item.pk}/pdf/")
    assert removed.json()["pdf"]["available"] is False
    item.refresh_from_db()
    assert not item.pdf


def test_bad_files_are_refused_with_a_code(api):
    item = handout()
    for data, code in [
        (b"hello", "file_not_pdf"),
        (b"%PDF-1.4\n/JavaScript (app.alert(1))\n%%EOF\n", "pdf_active_content"),
    ]:
        response = attach(api, item, data)
        assert response.status_code == 400
        assert response.json()["error"]["code"] == code
    item.refresh_from_db()
    assert not item.pdf


def test_a_video_cannot_have_a_file(api):
    response = attach(api, video())
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "not_a_pdf_material"


def test_turning_a_pdf_material_into_a_video_drops_its_file(
    api, django_capture_on_commit_callbacks
):
    item = handout()
    attach(api, item)
    item.refresh_from_db()
    name = item.pdf.name
    with django_capture_on_commit_callbacks(execute=True):
        response = api.patch(
            f"{ADMIN}{item.pk}/", {"kind": "video", "youtube_url": VIDEO_ID}, format="json"
        )
    assert response.status_code == 200, response.content
    item.refresh_from_db()
    assert item.kind == MaterialKind.VIDEO and not item.pdf
    assert not default_storage.exists(name)


# --------------------------------------------------------------------------------------
# Public
# --------------------------------------------------------------------------------------
def test_public_sees_only_published_materials_with_safe_fields(public):
    live = video(title_bn="বাংলা শিরোনাম", title_en="Title", teacher="Karim")
    video(title_en="Draft", published_at=None)
    video(title_en="Later", published_at=timezone.now() + timedelta(days=1))
    response = public.get(PUBLIC, HTTP_ACCEPT_LANGUAGE="en")
    assert response.status_code == 200
    rows = response.json()["results"]
    assert [row["id"] for row in rows] == [live.pk]
    row = rows[0]
    assert row["title"] == "Title" and row["youtube_id"] == VIDEO_ID and row["teacher"] == "Karim"
    assert set(row) == {
        "id",
        "kind",
        "title",
        "description",
        "teacher",
        "youtube_id",
        "pdf",
        "category",
        "subject",
        "exam",
        "published_at",
    }
    bn = public.get(PUBLIC, HTTP_ACCEPT_LANGUAGE="bn").json()["results"][0]
    assert bn["title"] == "বাংলা শিরোনাম"


def test_public_filters_by_category_subject_exam_kind_teacher_and_search(public):
    science = make_category("science")
    arts = make_category("arts")
    physics = make_subject("physics", science)
    exam = make_exam(physics, publish=True)
    a = video(title_en="Alpha", category=science, subject=physics, exam=exam, teacher="Karim")
    b = handout(title_en="Beta", category=arts, teacher="Rahim")

    def ids(query):
        return {row["id"] for row in public.get(f"{PUBLIC}{query}").json()["results"]}

    assert ids("") == {a.pk, b.pk}
    assert ids("?category=science") == {a.pk}
    assert ids("?category=arts") == {b.pk}
    assert ids("?subject=physics") == {a.pk}
    assert ids(f"?exam={exam.slug}") == {a.pk}
    assert ids("?kind=pdf") == {b.pk}
    assert ids("?teacher=Karim") == {a.pk}
    assert ids("?search=bet") == {b.pk}
    assert ids("?category=nope") == set()
    assert public.get(f"{PUBLIC}?kind=bogus").status_code == 400  # an unknown choice is refused


def test_a_material_in_an_inactive_category_is_hidden_and_an_unpublished_exam_is_not_linked(public):
    science = make_category("science")
    physics = make_subject("physics", science)
    exam = make_exam(physics)  # a draft exam
    item = video(category=science, exam=exam)
    row = public.get(PUBLIC).json()["results"][0]
    assert row["exam"] is None  # no link to an exam students cannot see
    assert row["category"] == {"slug": "science", "name": "Science"}
    science.is_active = False
    science.save()
    assert public.get(PUBLIC).json()["results"] == []
    assert item.pk  # (still exists, just not shown)


def test_public_pdf_is_served_by_the_api_only_for_published_materials(api, public):
    item = handout()
    assert public.get(f"{PUBLIC}{item.pk}/pdf/").status_code == 404  # no file yet
    attach(api, item)
    response = public.get(f"{PUBLIC}{item.pk}/pdf/")
    assert response.status_code == 200
    assert response["Content-Type"] == "application/pdf"
    assert response["X-Content-Type-Options"] == "nosniff"
    assert "default-src 'none'" in response["Content-Security-Policy"]
    assert body(response) == GOOD_PDF
    # cached copy is revalidated by ETag
    again = public.get(f"{PUBLIC}{item.pk}/pdf/", HTTP_IF_NONE_MATCH=response["ETag"])
    assert again.status_code == 304
    # the public list never exposes a stored path or file name
    row = public.get(PUBLIC).json()["results"][0]
    assert row["pdf"] == {"available": True, "name": "", "size_bytes": len(GOOD_PDF)}
    assert "documents/" not in str(row)


def test_a_draft_or_scheduled_materials_file_is_not_reachable(api, public):
    item = handout(published_at=None)
    attach(api, item)
    assert public.get(f"{PUBLIC}{item.pk}/pdf/").status_code == 404
    item.published_at = timezone.now() + timedelta(days=1)
    item.save()
    assert public.get(f"{PUBLIC}{item.pk}/pdf/").status_code == 404
    assert public.get(f"{PUBLIC}999999/pdf/").status_code == 404


def test_the_public_list_uses_a_fixed_number_of_queries(public, django_assert_max_num_queries):
    science = make_category("science")
    for i in range(6):
        video(title_en=f"V{i}", category=science, youtube_id=f"abcdefghij{i}")
    with django_assert_max_num_queries(8):
        assert len(public.get(PUBLIC).json()["results"]) == 6
