# ruff: noqa: F811 -- imported pytest fixtures are re-named as test arguments
"""Sample participants: invented, always-labelled entries kept apart from real students."""

from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.audit.models import AuditLog
from apps.results import services as result_services
from apps.results.models import Result
from apps.simulation import services
from apps.simulation.models import SampleEntry, SamplePerson
from tests.test_attempts import make_student
from tests.test_cms import CTX
from tests.test_exams import make_subject
from tests.test_results import _media, admin_client, published, take  # noqa: F401
from tests.test_subscriptions import jwt_client

pytestmark = pytest.mark.django_db

PEOPLE = "/api/v1/admin/sample-participants/"


@pytest.fixture
def subject():
    return make_subject()


def person(name="Sample One", **fields):
    return services.create_person(SamplePerson(name=name, **fields), ctx=CTX)


def exam_url(exam, tail="sample-participants/"):
    return f"/api/v1/admin/exams/{exam.pk}/{tail}"


def board(subject, **extra):
    """A published exam with a generated merit list of three real students (3 marks total)."""
    exam = published(subject, **extra)
    students = [make_student(full_name=f"Real{i} Student") for i in range(3)]
    for i, student in enumerate(students):
        take(student, exam, "c" * (i + 1) + "-" * (2 - i))
    result_services.generate_merit(exam.pk)
    return exam, students


# --------------------------------------------------------------------------------------
# The library of names
# --------------------------------------------------------------------------------------
def test_admin_manages_the_library(admin_client):
    created = admin_client.post(PEOPLE, {"name": "  Nusrat   Jahan "}, format="json")
    assert created.status_code == 201, created.content
    data = created.json()
    assert data["name"] == "Nusrat Jahan" and data["is_active"] is True and data["exam_count"] == 0
    pk = data["id"]
    assert (
        admin_client.patch(f"{PEOPLE}{pk}/", {"is_active": False}, format="json").json()[
            "is_active"
        ]
        is False
    )
    assert AuditLog.objects.filter(action="sample_person.create").count() == 1
    assert AuditLog.objects.filter(action="sample_person.update").count() == 1
    assert admin_client.delete(f"{PEOPLE}{pk}/").status_code == 204
    assert not SamplePerson.objects.exists()


def test_name_is_required_and_bounded(admin_client):
    assert admin_client.post(PEOPLE, {"name": "   "}, format="json").status_code == 400
    assert admin_client.post(PEOPLE, {"name": "x" * 121}, format="json").status_code == 400
    assert admin_client.post(PEOPLE, {}, format="json").status_code == 400


def test_filters_and_search(admin_client):
    a, b = person("Alpha"), person("Beta", is_active=False)
    ids = lambda q: {r["id"] for r in admin_client.get(f"{PEOPLE}{q}").json()["results"]}  # noqa: E731
    assert ids("") == {a.pk, b.pk}
    assert ids("?is_active=false") == {b.pk}
    assert ids("?search=alp") == {a.pk}


def test_only_admins_can_manage(subject):
    anonymous, student = APIClient(), jwt_client(make_student())
    for client in (anonymous, student):
        assert client.get(PEOPLE).status_code in (401, 403)
        assert client.post(PEOPLE, {"name": "x"}, format="json").status_code in (401, 403)


def test_a_participant_in_an_exam_cannot_be_deleted(admin_client, subject):
    exam = published(subject)
    p = person()
    services.set_exam_entries(exam.pk, [{"person": p.pk, "marks": "1"}], ctx=CTX)
    response = admin_client.delete(f"{PEOPLE}{p.pk}/")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "in_use"
    assert SamplePerson.objects.filter(pk=p.pk).exists()


# --------------------------------------------------------------------------------------
# Adding sample participants to an exam
# --------------------------------------------------------------------------------------
def test_put_replaces_the_complete_list_with_marks(admin_client, subject):
    exam = published(subject)  # 3 questions, 1 mark each
    a, b, c = person("A"), person("B"), person("C")
    body = {"entries": [{"person": a.pk, "marks": "2.5"}, {"person": b.pk, "marks": 1}]}
    response = admin_client.put(exam_url(exam), body, format="json")
    assert response.status_code == 200, response.content
    data = response.json()
    assert data["total_marks"] == "3.00"
    assert {(e["name"], e["marks"]) for e in data["entries"]} == {("A", "2.50"), ("B", "1.00")}
    # a second PUT replaces, it does not add
    admin_client.put(exam_url(exam), {"entries": [{"person": c.pk, "marks": "3"}]}, format="json")
    assert list(SampleEntry.objects.values_list("person__name", flat=True)) == ["C"]
    assert [e["name"] for e in admin_client.get(exam_url(exam)).json()["entries"]] == ["C"]
    assert AuditLog.objects.filter(action="exam.sample_participants_update").count() == 2


def test_an_unchanged_put_writes_no_audit(admin_client, subject):
    exam = published(subject)
    p = person()
    body = {"entries": [{"person": p.pk, "marks": "2"}]}
    admin_client.put(exam_url(exam), body, format="json")
    before = AuditLog.objects.count()
    assert admin_client.put(exam_url(exam), body, format="json").status_code == 200
    assert AuditLog.objects.count() == before


@pytest.mark.parametrize("marks", ["-1", "3.01", "abc", "1e9", None])
def test_marks_must_be_within_the_exam_total(admin_client, subject, marks):
    exam = published(subject)
    p = person()
    response = admin_client.put(
        exam_url(exam), {"entries": [{"person": p.pk, "marks": marks}]}, format="json"
    )
    assert response.status_code == 400
    assert not SampleEntry.objects.exists()


def test_a_person_can_be_added_only_once_and_must_exist(admin_client, subject):
    exam = published(subject)
    p = person()
    dup = {"entries": [{"person": p.pk, "marks": 1}, {"person": p.pk, "marks": 2}]}
    assert admin_client.put(exam_url(exam), dup, format="json").status_code == 400
    ghost = {"entries": [{"person": 999999, "marks": 1}]}
    assert admin_client.put(exam_url(exam), ghost, format="json").status_code == 400
    assert not SampleEntry.objects.exists()


def test_the_same_person_can_join_different_exams(admin_client, subject):
    one, two = published(subject), published(subject)
    p = person()
    for exam, marks in ((one, 1), (two, 3)):
        assert (
            admin_client.put(
                exam_url(exam), {"entries": [{"person": p.pk, "marks": marks}]}, format="json"
            ).status_code
            == 200
        )
    assert admin_client.get(f"{PEOPLE}{p.pk}/").json()["exam_count"] == 2


def test_an_exam_that_does_not_exist_is_404(admin_client):
    assert admin_client.get("/api/v1/admin/exams/999999/sample-participants/").status_code == 404
    assert (
        admin_client.put(
            "/api/v1/admin/exams/999999/sample-participants/", {"entries": []}, format="json"
        ).status_code
        == 404
    )


def test_the_per_exam_limit(admin_client, subject):
    exam = published(subject)
    people = [SamplePerson(name=f"P{i}") for i in range(501)]
    SamplePerson.objects.bulk_create(people)
    entries = [{"person": p.pk, "marks": 0} for p in SamplePerson.objects.all()]
    assert admin_client.put(exam_url(exam), {"entries": entries}, format="json").status_code == 400


# --------------------------------------------------------------------------------------
# Public: counted apart, labelled, never mixed into real results
# --------------------------------------------------------------------------------------
def test_participation_counts_real_and_sample_separately(subject):
    exam, students = board(subject)
    people = [person(f"S{i}") for i in range(4)]
    services.set_exam_entries(exam.pk, [{"person": p.pk, "marks": 1} for p in people], ctx=CTX)
    person_off = person("Off", is_active=False)
    services.set_exam_entries(
        exam.pk, [{"person": p.pk, "marks": 1} for p in (*people, person_off)], ctx=CTX
    )
    response = APIClient().get(f"/api/v1/public/exams/{exam.slug}/participation/")
    assert response.status_code == 200
    assert response.json() == {
        "real_count": 3,
        "sample_count": 4,
        "total_count": 7,
    }  # inactive not counted


def test_participation_for_an_unpublished_or_unknown_exam_is_404(subject):
    from tests.test_exams import make_exam

    draft = make_exam(subject)
    assert APIClient().get(f"/api/v1/public/exams/{draft.slug}/participation/").status_code == 404
    assert APIClient().get("/api/v1/public/exams/nope/participation/").status_code == 404


def test_the_sample_list_is_labelled_unranked_and_free_of_ids(subject):
    exam, _students = board(subject)
    a, b = person("Mina"), person("Zafar")
    services.set_exam_entries(
        exam.pk, [{"person": a.pk, "marks": "1"}, {"person": b.pk, "marks": "2.5"}], ctx=CTX
    )
    response = APIClient().get(f"/api/v1/public/exams/{exam.slug}/sample-participants/")
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 2 and body["total_marks"] == "3.00"
    assert [row["name"] for row in body["results"]] == ["Zafar", "Mina"]  # best marks first
    row = body["results"][0]
    assert row == {"name": "Zafar", "marks": "2.50", "percentage": "83.33", "is_sample": True}
    assert "id" not in str(body) and "position" not in str(body)


def test_the_sample_list_is_hidden_while_the_merit_list_is_hidden(subject):
    exam = published(subject, result_visibility="manual")
    p = person()
    services.set_exam_entries(exam.pk, [{"person": p.pk, "marks": 1}], ctx=CTX)
    assert (
        APIClient().get(f"/api/v1/public/exams/{exam.slug}/sample-participants/").status_code == 404
    )


def test_sample_participants_never_touch_the_real_leaderboard_results_or_users(subject):
    exam, students = board(subject)
    real_board = APIClient().get(f"/api/v1/public/exams/{exam.slug}/leaderboard/").json()
    real_results = list(
        Result.objects.order_by("id").values_list("id", "merit_position", "obtained_marks")
    )
    users_before = User.objects.count()
    people = [person(f"S{i}") for i in range(5)]
    services.set_exam_entries(exam.pk, [{"person": p.pk, "marks": 3} for p in people], ctx=CTX)
    # the merit lists, every real result and the number of accounts are exactly as before
    assert APIClient().get(f"/api/v1/public/exams/{exam.slug}/leaderboard/").json() == real_board
    app = jwt_client(students[0]).get(f"/api/v1/exams/{exam.slug}/leaderboard/").json()
    assert app["count"] == 3 and app["my_position"] == 3
    assert (
        list(Result.objects.order_by("id").values_list("id", "merit_position", "obtained_marks"))
        == real_results
    )
    assert User.objects.count() == users_before
    assert "S0" not in str(real_board) and "S0" not in str(app)


def test_marks_are_stored_as_exact_decimals(subject):
    exam = published(subject)
    p = person()
    services.set_exam_entries(exam.pk, [{"person": p.pk, "marks": "2.345"}], ctx=CTX)
    assert SampleEntry.objects.get().marks == Decimal("2.35")
