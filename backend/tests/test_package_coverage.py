"""What a package unlocks, shown on pricing cards: scope, exam count and categories with counts.
Counts only paid exams students can open now (published, active category)."""

import pytest
from rest_framework.test import APIClient

from tests.test_exams import make_category, make_subject
from tests.test_subscriptions import jwt_client, make_package, make_student, paid_exam

pytestmark = pytest.mark.django_db

PUBLIC = "/api/v1/public/packages/"
STUDENT = "/api/v1/packages/"


@pytest.fixture
def world():
    medical, engineering, jobs = (
        make_category("medical", name_en="Medical", name_bn="মেডিকেল", sort_order=1),
        make_category("engineering", name_en="Engineering", name_bn="ইঞ্জিনিয়ারিং", sort_order=2),
        make_category("jobs", name_en="Job prep", name_bn="চাকরি", sort_order=3),
    )
    exams = {}
    for category in (medical, engineering, jobs):
        subject = make_subject(f"{category.slug}-sub", category)
        exams[category.slug] = [
            paid_exam(subject, publish=True, title_en=f"{category.slug} {i}") for i in range(2)
        ]
    return {"categories": (medical, engineering, jobs), "exams": exams}


def rows(client=None, path=PUBLIC, language="en"):
    client = client or APIClient()
    response = client.get(path, HTTP_ACCEPT_LANGUAGE=language)
    assert response.status_code == 200, response.content
    return {row["slug"]: row for row in response.json()["results"]}


def test_a_category_package_lists_its_category_and_exam_count(world):
    medical, *_ = world["categories"]
    make_package("med", rules=[{"rule_type": "category", "category": medical.pk}])
    access = rows()["med"]["access"]
    assert access == {
        "scope": "selected",
        "exam_count": 2,
        "categories": [{"slug": "medical", "name": "Medical", "exam_count": 2}],
    }


def test_several_categories_keep_the_admins_category_order(world):
    medical, engineering, jobs = world["categories"]
    make_package(
        "mix",
        rules=[
            {"rule_type": "category", "category": jobs.pk},
            {"rule_type": "category", "category": medical.pk},
        ],
    )
    access = rows()["mix"]["access"]
    assert [c["slug"] for c in access["categories"]] == ["medical", "jobs"]
    assert access["exam_count"] == 4


def test_an_all_paid_package_covers_every_category_with_paid_exams(world):
    make_package("gold", rules=[{"rule_type": "all_paid_exams"}])
    access = rows()["gold"]["access"]
    assert access["scope"] == "all"
    assert access["exam_count"] == 6
    assert [c["slug"] for c in access["categories"]] == ["medical", "engineering", "jobs"]


def test_single_exam_rules_count_once_and_merge_with_a_category_rule(world):
    medical, engineering, _jobs = world["categories"]
    first_med, second_med = world["exams"]["medical"]
    eng = world["exams"]["engineering"][0]
    make_package(
        "picks",
        rules=[
            {"rule_type": "category", "category": medical.pk},
            {"rule_type": "exam", "exam": second_med.pk},  # already inside the whole category
            {"rule_type": "exam", "exam": eng.pk},
        ],
    )
    access = rows()["picks"]["access"]
    assert access["exam_count"] == 3  # 2 medical + 1 engineering, medical not double-counted
    assert {c["slug"]: c["exam_count"] for c in access["categories"]} == {
        "medical": 2,
        "engineering": 1,
    }
    assert first_med.pk


def test_draft_free_and_inactive_category_exams_are_not_counted(world):
    medical, engineering, _jobs = world["categories"]
    subject = make_subject("extra", medical)
    paid_exam(subject)  # a draft: students cannot open it
    from tests.test_exams import make_exam

    make_exam(subject, publish=True)  # a free exam: no package needed
    engineering.is_active = False
    engineering.save()
    make_package(
        "med-eng",
        rules=[
            {"rule_type": "category", "category": medical.pk},
            {"rule_type": "category", "category": engineering.pk},
        ],
    )
    access = rows()["med-eng"]["access"]
    assert access["exam_count"] == 2
    assert [c["slug"] for c in access["categories"]] == ["medical"]


def test_a_package_with_no_rules_unlocks_nothing(world):
    make_package("empty", rules=[])
    assert rows()["empty"]["access"] == {"scope": "selected", "exam_count": 0, "categories": []}


def test_names_follow_the_request_language(world):
    medical, *_ = world["categories"]
    make_package("med", rules=[{"rule_type": "category", "category": medical.pk}])
    assert rows(language="bn")["med"]["access"]["categories"][0]["name"] == "মেডিকেল"


def test_the_student_list_carries_the_same_access_block(world):
    medical, *_ = world["categories"]
    make_package("med", rules=[{"rule_type": "category", "category": medical.pk}])
    row = rows(jwt_client(make_student()), STUDENT)["med"]
    assert row["access"]["exam_count"] == 2 and "id" in row


def test_the_coverage_uses_a_fixed_number_of_queries(world, django_assert_max_num_queries):
    medical, engineering, jobs = world["categories"]
    for i, category in enumerate((medical, engineering, jobs, medical, engineering)):
        make_package(f"p{i}", rules=[{"rule_type": "category", "category": category.pk}])
    with django_assert_max_num_queries(10):
        assert len(rows()) == 5
