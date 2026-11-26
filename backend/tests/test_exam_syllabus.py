# ruff: noqa: F811 -- imported pytest fixtures are re-named as test arguments
"""An exam's syllabus: admin API (replace the complete list), public/student display, audit."""

import json

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.audit.models import AuditLog
from apps.audit.services import AuditContext
from apps.exams import services
from apps.exams.models import ExamSyllabusItem
from tests.test_exams import PUBLIC, admin_user, api, make_exam, subject  # noqa: F401

pytestmark = pytest.mark.django_db

ADMIN = "/api/v1/admin/exams/"


def put(api, exam, lines):
    return api.put(f"{ADMIN}{exam.pk}/syllabus/", {"syllabus": lines}, format="json")


def lines_of(response):
    return response.json()["syllabus"]


@pytest.fixture
def exam(subject):
    return make_exam(subject)


def test_a_new_exam_has_an_empty_syllabus(api, exam):
    response = api.get(f"{ADMIN}{exam.pk}/syllabus/")
    assert response.status_code == 200 and lines_of(response) == []


def test_the_complete_list_is_saved_in_order_and_normalized(api, exam):
    lines = [
        {"subject": "  Physics ", "chapter": "Motion", "topic": "Velocity   and speed"},
        {"chapter": "পদার্থ পরিচিতি", "topic": "পরিমাপ"},
        {"topic": "Only a topic"},
    ]
    response = put(api, exam, lines)
    assert response.status_code == 200, response.content
    assert lines_of(response) == [
        {"subject": "Physics", "chapter": "Motion", "topic": "Velocity and speed"},
        {"subject": "", "chapter": "পদার্থ পরিচিতি", "topic": "পরিমাপ"},
        {"subject": "", "chapter": "", "topic": "Only a topic"},
    ]
    assert lines_of(api.get(f"{ADMIN}{exam.pk}/syllabus/")) == lines_of(response)


def test_a_new_list_replaces_the_old_one_and_can_be_emptied(api, exam):
    put(api, exam, [{"topic": "One"}, {"topic": "Two"}])
    assert [row["topic"] for row in lines_of(put(api, exam, [{"topic": "Two"}]))] == ["Two"]
    assert lines_of(put(api, exam, [])) == []
    assert ExamSyllabusItem.objects.filter(exam=exam).count() == 0


@pytest.mark.parametrize(
    ("lines", "code"),
    [
        ([{}], "empty_line"),
        ([{"subject": "  ", "chapter": "", "topic": ""}], "empty_line"),
        ([{"topic": "ok"}, {"topic": "   "}], "empty_line"),
        ([{"topic": "x" * 151}], "too_long"),
        ([{"topic": "ok"}] * 201, "too_many"),
    ],
)
def test_wrong_lines_are_refused_and_nothing_changes(api, exam, lines, code):
    put(api, exam, [{"topic": "kept"}])
    response = put(api, exam, lines)
    assert response.status_code == 400
    assert (
        code in json.dumps(response.json())
        or response.json()["error"]["code"] == "validation_error"
    )
    assert [row["topic"] for row in lines_of(api.get(f"{ADMIN}{exam.pk}/syllabus/"))] == ["kept"]


def test_wrong_types_never_cause_a_server_error(api, exam):
    for body in (
        None,
        [],
        "x",
        {"syllabus": "x"},
        {"syllabus": [1, "a", None]},
        {"syllabus": [{"topic": 5}]},
    ):
        response = api.put(f"{ADMIN}{exam.pk}/syllabus/", body, format="json")
        assert response.status_code < 500, (body, response.status_code)
    assert api.put(f"{ADMIN}999999/syllabus/", {"syllabus": []}, format="json").status_code == 404


def test_it_is_editable_on_a_published_exam(api, subject):
    published = make_exam(subject, publish=True)
    assert put(api, published, [{"chapter": "Late change"}]).status_code == 200
    published.refresh_from_db()
    assert published.status == "published"


def test_the_syllabus_is_on_the_public_exam_page_and_in_list_rows(api, subject):
    published = make_exam(subject, publish=True)
    put(api, published, [{"subject": "Physics", "chapter": "Motion", "topic": "Speed"}])
    anonymous = APIClient()
    detail = anonymous.get(f"{PUBLIC}{published.slug}/").json()
    assert detail["syllabus"] == [{"subject": "Physics", "chapter": "Motion", "topic": "Speed"}]
    # List rows carry it too (the exam card shows it); it is prefetched, so cost stays flat.
    row = anonymous.get(PUBLIC).json()["results"][0]
    assert row["syllabus"] == [{"subject": "Physics", "chapter": "Motion", "topic": "Speed"}]


def test_listing_exams_costs_the_same_however_many_have_a_syllabus(
    api, subject, django_assert_max_num_queries
):
    for index in range(5):
        exam = make_exam(subject, publish=True, title_en=f"Exam {index}", title_bn=f"পরীক্ষা {index}")
        put(api, exam, [{"topic": f"T{index}"}])
    anonymous = APIClient()
    anonymous.get(PUBLIC)  # warm caches (settings, content types)
    with django_assert_max_num_queries(6):
        body = anonymous.get(PUBLIC).json()
    assert len(body["results"]) == 5


def test_a_student_sees_the_syllabus_on_the_exam_detail_and_in_the_list(api, subject):
    from tests.test_subscriptions import jwt_client, make_student

    published = make_exam(subject, publish=True)
    put(api, published, [{"chapter": "Waves", "topic": "Sound"}])
    student = make_student()
    client = jwt_client(student)
    detail = client.get(f"/api/v1/exams/{published.slug}/").json()
    assert detail["syllabus"] == [{"subject": "", "chapter": "Waves", "topic": "Sound"}]
    listed = client.get("/api/v1/exams/").json()["results"][0]
    assert listed["syllabus"] == [{"subject": "", "chapter": "Waves", "topic": "Sound"}]


def test_an_unpublished_exams_syllabus_is_not_public(api, exam):
    put(api, exam, [{"topic": "Secret"}])
    assert APIClient().get(f"{PUBLIC}{exam.slug}/").status_code == 404


def test_each_change_is_audited_without_the_text(api, exam):
    put(api, exam, [{"topic": "Quantum entanglement"}])
    put(api, exam, [{"topic": "Quantum entanglement"}])  # no change: no second entry
    entries = AuditLog.objects.filter(action="exam.syllabus_update")
    assert entries.count() == 1
    assert "entanglement" not in json.dumps(list(entries.values()), default=str)


def test_only_an_admin_can_read_or_change_it(exam):
    student = User.objects.create_user(
        "01712340099", password="Strong-Pass-2026", full_name="S", role=Role.STUDENT
    )
    for client in (APIClient(), _login(student)):
        assert client.get(f"{ADMIN}{exam.pk}/syllabus/").status_code in (401, 403)
        assert client.put(
            f"{ADMIN}{exam.pk}/syllabus/", {"syllabus": [{"topic": "x"}]}, format="json"
        ).status_code in (401, 403)
    assert ExamSyllabusItem.objects.count() == 0


def _login(user):
    client = APIClient()
    client.force_login(user)
    return client


def test_a_cross_site_write_without_the_csrf_token_is_refused(admin_user, exam):
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(admin_user)
    response = client.put(
        f"{ADMIN}{exam.pk}/syllabus/",
        json.dumps({"syllabus": [{"topic": "x"}]}),
        content_type="application/json",
    )
    assert response.status_code == 403


def test_deleting_the_exam_removes_its_syllabus(api, exam):
    put(api, exam, [{"topic": "x"}])
    services.delete_exam(exam.pk, ctx=AuditContext())
    assert ExamSyllabusItem.objects.count() == 0


def test_the_database_refuses_an_empty_line_and_a_repeated_position(exam):
    from django.db import IntegrityError, transaction

    with pytest.raises(IntegrityError), transaction.atomic():
        ExamSyllabusItem.objects.create(exam=exam, sort_order=0)
    ExamSyllabusItem.objects.create(exam=exam, sort_order=0, topic="a")
    with pytest.raises(IntegrityError), transaction.atomic():
        ExamSyllabusItem.objects.create(exam=exam, sort_order=0, topic="b")
