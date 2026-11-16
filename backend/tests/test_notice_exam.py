# ruff: noqa: F811 -- imported pytest fixtures are re-named as test arguments
"""A notice about one exam: the admin links it, and that exam's page (website and app) lists it."""

import pytest
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.cms.models import Announcement
from tests.test_cms import admin_user, api  # noqa: F401
from tests.test_exams import make_exam, subject  # noqa: F401
from tests.test_notice_pdf import ADMIN, PUBLIC, STUDENT, live
from tests.test_subscriptions import jwt_client, make_student

pytestmark = pytest.mark.django_db


def rows(response):
    assert response.status_code == 200, response.content
    return response.json()["results"]


def test_admin_links_a_notice_to_an_exam_and_can_unlink_it(api, subject):
    exam = make_exam(subject, publish=True)
    created = api.post(
        ADMIN,
        {"title_en": "Room change", "body_en": "New time.", "publish_now": True, "exam": exam.pk},
        format="json",
    )
    assert created.status_code == 201, created.content
    data = created.json()
    assert data["exam"] == exam.pk and data["exam_label"]
    assert AuditLog.objects.filter(action="announcement.create").exists()
    assert [row["id"] for row in rows(api.get(f"{ADMIN}?exam={exam.pk}"))] == [data["id"]]
    cleared = api.patch(f"{ADMIN}{data['id']}/", {"exam": None}, format="json")
    assert cleared.status_code == 200 and cleared.json()["exam"] is None
    assert rows(api.get(f"{ADMIN}?exam={exam.pk}")) == []


def test_an_unknown_exam_id_is_refused(api):
    response = api.post(
        ADMIN, {"title_en": "x", "body_en": "y", "publish_now": True, "exam": 999999}, format="json"
    )
    assert response.status_code == 400


def test_the_exam_page_lists_only_its_own_notices(subject):
    exam = make_exam(subject, publish=True)
    other = make_exam(subject, publish=True)
    mine = live(title_en="About this exam", exam=exam)
    live(title_en="About the other exam", exam=other)
    live(title_en="General")
    public = APIClient()
    listed = rows(public.get(f"{PUBLIC}?exam={exam.slug}"))
    assert [row["id"] for row in listed] == [mine.pk]
    assert listed[0]["exam"] == {"slug": exam.slug, "title": listed[0]["exam"]["title"]}
    assert len(rows(public.get(PUBLIC))) == 3  # the general list still has everything
    student = jwt_client(make_student())
    assert [row["id"] for row in rows(student.get(f"{STUDENT}?exam={exam.slug}"))] == [mine.pk]


def test_audience_and_drafts_still_apply(subject):
    exam = make_exam(subject, publish=True)
    live("students", title_en="Students only", exam=exam)
    Announcement.objects.create(title_en="Draft", body_en="x", exam=exam)  # not published
    assert rows(APIClient().get(f"{PUBLIC}?exam={exam.slug}")) == []


def test_an_unpublished_exam_is_never_named(subject):
    draft = make_exam(subject)  # not published
    notice = live(title_en="Hidden exam", exam=draft)
    public = APIClient()
    assert rows(public.get(f"{PUBLIC}?exam={draft.slug}")) == []
    row = next(row for row in rows(public.get(PUBLIC)) if row["id"] == notice.pk)
    assert row["exam"] is None  # the notice shows, the exam link does not


@pytest.mark.parametrize("slug", ["", "UPPER", "a b", "x" * 141, "' or 1=1 --"])
def test_a_malformed_exam_slug_matches_nothing(slug, subject):
    live(title_en="General")
    assert rows(APIClient().get(PUBLIC, {"exam": slug})) == []


def test_deleting_the_exam_keeps_the_notice(subject):
    exam = make_exam(subject)
    notice = live(title_en="Stays", exam=exam)
    exam.delete()
    notice.refresh_from_db()
    assert notice.exam_id is None


def test_listing_notices_costs_no_query_per_row(subject, django_assert_max_num_queries):
    exam = make_exam(subject, publish=True)
    for index in range(6):
        live(title_en=f"Notice {index}", exam=exam)
    with django_assert_max_num_queries(4):
        assert len(rows(APIClient().get(PUBLIC))) == 6
