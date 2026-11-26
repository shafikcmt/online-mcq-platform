# ruff: noqa: F811 -- imported pytest fixtures are re-named as test arguments
"""Exam groups: the shelves inside a category ("Subject-wise preparation", "52nd BCS preparation"
with sub-groups). Admin writes them (audited, validated), exams sit in one, and the public
and student exam lists browse by group."""

from datetime import timedelta

import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.catalog import services as catalog
from apps.catalog.exceptions import CatalogInUse
from apps.catalog.models import ExamGroup
from tests.test_exams import (  # noqa: F401
    CTX,
    admin_user,
    api,
    api_payload,
    errors,
    make_category,
    make_exam,
    make_subject,
    subject,
)

pytestmark = pytest.mark.django_db

GROUPS = "/api/v1/admin/groups/"
PUBLIC = "/api/v1/public/groups/"
EXAMS = "/api/v1/public/exams/"


def make_group(category, slug="weekly", parent=None, **fields):
    fields.setdefault("name_en", slug.title())
    return catalog.create_group(
        ExamGroup(category=category, parent=parent, slug=slug, **fields), ctx=CTX
    )


# --------------------------------------------------------------------------------------
# Rules (the model and services)
# --------------------------------------------------------------------------------------
def test_a_group_needs_a_name_in_one_language(subject):
    with pytest.raises(ValidationError):
        catalog.create_group(ExamGroup(category=subject.category, slug="x"), ctx=CTX)


def test_the_slug_is_made_from_the_english_name_and_stays_unique(subject):
    first = catalog.create_group(
        ExamGroup(category=subject.category, name_en="Daily quiz"), ctx=CTX
    )
    second = catalog.create_group(
        ExamGroup(category=subject.category, name_en="Daily quiz"), ctx=CTX
    )
    assert first.slug == "daily-quiz"
    assert second.slug != first.slug


def test_groups_go_two_levels_deep_only(subject):
    top = make_group(subject.category, "bcs")
    child = make_group(subject.category, "bcs-weekly", parent=top)
    with pytest.raises(ValidationError) as caught:
        make_group(subject.category, "too-deep", parent=child)
    assert "parent" in caught.value.error_dict


def test_a_parent_must_be_in_the_same_category(subject):
    other = make_category("medical")
    top = make_group(other, "med-top")
    with pytest.raises(ValidationError) as caught:
        make_group(subject.category, "wrong", parent=top)
    assert "parent" in caught.value.error_dict


def test_a_group_with_sub_groups_cannot_become_a_sub_group(subject):
    one = make_group(subject.category, "one")
    make_group(subject.category, "inside", parent=one)
    two = make_group(subject.category, "two")
    with pytest.raises(ValidationError) as caught:
        catalog.update_group(one.pk, {"parent": two}, ctx=CTX)
    assert "parent" in caught.value.error_dict


def test_creating_updating_and_deleting_are_audited(subject):
    group = make_group(subject.category, "bcs")
    catalog.update_group(group.pk, {"name_en": "BCS prep"}, ctx=CTX)
    catalog.delete_group(group.pk, ctx=CTX)
    actions = set(AuditLog.objects.values_list("action", flat=True))
    assert {"group.create", "group.update", "group.delete"} <= actions


def test_a_group_with_exams_or_sub_groups_cannot_be_deleted(subject):
    group = make_group(subject.category, "bcs")
    make_exam(subject, group=group)
    with pytest.raises(CatalogInUse):
        catalog.delete_group(group.pk, ctx=CTX)
    other = make_group(subject.category, "parent")
    make_group(subject.category, "kid", parent=other)
    with pytest.raises(CatalogInUse):
        catalog.delete_group(other.pk, ctx=CTX)


def test_an_exam_can_only_sit_in_a_group_of_its_own_category(subject):
    foreign = make_group(make_category("medical"), "med")
    with pytest.raises(ValidationError) as caught:
        make_exam(subject, group=foreign)
    assert "group" in caught.value.error_dict


# --------------------------------------------------------------------------------------
# Admin API
# --------------------------------------------------------------------------------------
def test_admin_api_creates_lists_filters_and_changes_groups(api, subject):
    category = subject.category
    response = api.post(
        GROUPS, {"category": category.pk, "name_bn": "বিসিএস", "name_en": "BCS prep"}, format="json"
    )
    assert response.status_code == 201, response.content
    top = response.json()
    child = api.post(
        GROUPS,
        {"category": category.pk, "parent": top["id"], "name_en": "Weekly"},
        format="json",
    ).json()
    assert child["parent"] == top["id"]
    roots = api.get(GROUPS, {"category": category.pk, "top_level": "true"}).json()["results"]
    assert [row["id"] for row in roots] == [top["id"]]
    assert roots[0]["child_count"] == 1
    kids = api.get(GROUPS, {"parent": top["id"]}).json()["results"]
    assert [row["id"] for row in kids] == [child["id"]]
    patched = api.patch(f"{GROUPS}{child['id']}/", {"sort_order": 3}, format="json")
    assert patched.status_code == 200 and patched.json()["sort_order"] == 3
    assert api.delete(f"{GROUPS}{top['id']}/").status_code == 409  # still has a sub-group
    assert api.delete(f"{GROUPS}{child['id']}/").status_code == 204


def test_admin_api_rejects_a_bad_parent(api, subject):
    top = make_group(subject.category, "top")
    kid = make_group(subject.category, "kid", parent=top)
    response = api.post(
        GROUPS,
        {"category": subject.category.pk, "parent": kid.pk, "name_en": "Deep"},
        format="json",
    )
    assert response.status_code == 400
    assert "parent" in errors(response)


def test_students_cannot_use_the_admin_group_api(subject):
    from apps.accounts.models import Role, User

    user = User.objects.create_user(
        "01712345678", password="Strong-Pass-2026", full_name="Student", role=Role.STUDENT
    )
    client = APIClient()
    client.force_login(user)
    assert client.get(GROUPS).status_code in (401, 403)
    assert client.post(GROUPS, {"name_en": "x"}, format="json").status_code in (401, 403)


def test_an_exam_is_put_in_a_group_through_the_exam_api(api, subject):
    group = make_group(subject.category, "bcs")
    data = api_payload(subject, group=group.pk)
    response = api.post("/api/v1/admin/exams/", data, format="json")
    assert response.status_code == 201, response.content
    assert response.json()["group"] == group.pk
    other = make_group(make_category("medical"), "med")
    bad = api.post("/api/v1/admin/exams/", api_payload(subject, group=other.pk), format="json")
    assert bad.status_code == 400 and "group" in errors(bad)


# --------------------------------------------------------------------------------------
# Public browsing
# --------------------------------------------------------------------------------------
def names(response):
    assert response.status_code == 200, response.content
    return [row["slug"] for row in response.json()["results"]]


def test_the_public_lists_groups_with_exam_counts(subject):
    category = subject.category
    top = make_group(category, "bcs")
    kid = make_group(category, "bcs-weekly", parent=top)
    make_exam(subject, publish=True, group=top)
    make_exam(subject, publish=True, group=kid)
    make_exam(subject, group=kid)  # a draft is not counted
    client = APIClient()
    rows = client.get(PUBLIC, {"category": category.slug}).json()["results"]
    assert [row["slug"] for row in rows] == ["bcs"]
    assert rows[0]["exam_count"] == 2 and rows[0]["child_count"] == 1
    assert names(client.get(PUBLIC, {"parent": "bcs"})) == ["bcs-weekly"]
    detail = client.get(f"{PUBLIC}bcs-weekly/").json()
    assert detail["parent"]["slug"] == "bcs" and detail["category"]["slug"] == category.slug
    assert detail["exam_count"] == 1


def test_a_running_scheduled_exam_makes_the_group_live(subject):
    group = make_group(subject.category, "bcs")
    now = timezone.now()
    make_exam(
        subject,
        publish=True,
        group=group,
        start_at=now - timedelta(hours=1),
        end_at=now + timedelta(hours=2),
    )
    make_exam(subject, publish=True, group=group)  # "any time": never counts as live
    row = APIClient().get(PUBLIC, {"category": subject.category.slug}).json()["results"][0]
    assert row["live_count"] == 1 and row["exam_count"] == 2


def test_inactive_groups_and_their_children_are_hidden(subject):
    top = make_group(subject.category, "bcs")
    make_group(subject.category, "kid", parent=top)
    catalog.update_group(top.pk, {"is_active": False}, ctx=CTX)
    client = APIClient()
    assert names(client.get(PUBLIC, {"category": subject.category.slug})) == []
    assert client.get(f"{PUBLIC}bcs/").status_code == 404
    assert client.get(f"{PUBLIC}kid/").status_code == 404


def test_exam_lists_filter_by_group_and_by_ungrouped(subject):
    group = make_group(subject.category, "bcs")
    inside = make_exam(subject, publish=True, group=group, title_en="Inside")
    outside = make_exam(subject, publish=True, title_en="Outside")
    client = APIClient()
    listed = lambda **q: [r["slug"] for r in client.get(EXAMS, q).json()["results"]]  # noqa: E731
    assert listed(group="bcs") == [inside.slug]
    assert listed(ungrouped="true", category=subject.category.slug) == [outside.slug]
    assert inside.slug in listed() and outside.slug in listed()
    catalog.update_group(group.pk, {"is_active": False}, ctx=CTX)
    # a switched-off group does not make its exams vanish from the category
    assert set(listed(ungrouped="true")) == {inside.slug, outside.slug}
    assert listed(group="bcs") == []


def test_the_public_exam_carries_its_group(subject):
    group = make_group(subject.category, "bcs", name_en="BCS prep")
    exam = make_exam(subject, publish=True, group=group)
    row = APIClient().get(f"{EXAMS}{exam.slug}/").json()
    assert row["group"] == {"slug": "bcs", "name": "BCS prep"}


def test_an_empty_group_is_not_offered_and_sub_group_counts_skip_empty_ones(subject):
    top = make_group(subject.category, "bcs")
    full = make_group(subject.category, "bcs-full", parent=top)
    make_group(subject.category, "bcs-empty", parent=top)  # nothing published in it
    make_group(subject.category, "lonely")  # a top-level group with nothing at all
    make_exam(subject, publish=True, group=full)
    client = APIClient()
    assert names(client.get(PUBLIC, {"category": subject.category.slug})) == ["bcs"]
    row = client.get(PUBLIC, {"category": subject.category.slug}).json()["results"][0]
    assert row["child_count"] == 1 and row["exam_count"] == 1
    assert [child["slug"] for child in client.get(f"{PUBLIC}bcs/").json()["children"]] == [
        "bcs-full"
    ]


# --------------------------------------------------------------------------------------
# What an exam row carries (the card: syllabus and study materials)
# --------------------------------------------------------------------------------------
def test_exam_list_rows_carry_the_syllabus_and_the_study_material_count(subject):
    from apps.exams import services as exam_services
    from apps.materials import services as material_services
    from apps.materials.models import StudyMaterial

    exam = make_exam(subject, publish=True)
    exam_services.set_syllabus(
        exam.pk, [{"subject": "Math", "chapter": "Algebra", "topic": "Equations"}], ctx=CTX
    )
    for n in range(2):
        material_services.create_material(
            StudyMaterial(
                kind="video",
                title_en=f"Video {n}",
                youtube_id="dQw4w9WgXcQ",
                exam=exam,
                published_at=timezone.now() - timedelta(minutes=1),
            ),
            ctx=CTX,
        )
    other = make_exam(subject, publish=True, title_en="No extras")
    rows = {row["slug"]: row for row in APIClient().get(EXAMS).json()["results"]}
    assert rows[exam.slug]["material_count"] == 2
    assert rows[exam.slug]["syllabus"] == [
        {"subject": "Math", "chapter": "Algebra", "topic": "Equations"}
    ]
    assert rows[other.slug]["material_count"] == 0 and rows[other.slug]["syllabus"] == []


def test_the_student_exam_list_carries_them_too(subject):
    from apps.exams import services as exam_services
    from tests.test_subscriptions import jwt_client, make_student

    exam = make_exam(subject, publish=True)
    exam_services.set_syllabus(
        exam.pk, [{"subject": "Physics", "chapter": "", "topic": ""}], ctx=CTX
    )
    client = jwt_client(make_student())
    row = client.get("/api/v1/exams/").json()["results"][0]
    assert row["syllabus"][0]["subject"] == "Physics" and row["material_count"] == 0
