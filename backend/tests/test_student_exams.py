"""Milestone 8C: student exam list and details (``GET /exams/``, ``GET /exams/{slug}/``) —
public exam fields plus the student's start state, by the exam engine's own rules."""

from datetime import timedelta

import pytest
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.catalog.models import Category
from apps.exams.models import Exam
from tests.test_attempts import start, start_url, walk
from tests.test_dashboard import exam, make_admin
from tests.test_results import take
from tests.test_subscriptions import all_paid, grant, jwt_client, make_package, make_student

pytestmark = pytest.mark.django_db

LIST = "/api/v1/exams/"


@pytest.fixture(autouse=True)
def _settings(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "media")
    settings.ATTEMPT_SUBMIT_GRACE_SECONDS = 30
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def student():
    return make_student(full_name="Rahim Hossain")


def listing(user, query="", **headers):
    response = jwt_client(user).get(LIST + query, **headers)
    assert response.status_code == 200, response.content
    return response.json()


def by_slug(body):
    return {row["slug"]: row for row in body["results"]}


def detail(user, row, **headers):
    response = jwt_client(user).get(f"{LIST}{row.slug}/", **headers)
    assert response.status_code == 200, response.content
    return response.json()


class TestAccess:
    def test_requires_student_jwt(self, student):
        free = exam()
        for target in (LIST, f"{LIST}{free.slug}/"):
            assert APIClient().get(target).status_code == 401
            session = APIClient()
            session.force_login(make_admin())
            assert session.get(target).status_code == 401
            assert jwt_client(student).get(target).status_code == 200

    def test_read_only(self, student):
        free = exam()
        client = jwt_client(student)
        for method in ("post", "put", "patch", "delete"):
            assert getattr(client, method)(LIST).status_code == 405
            assert getattr(client, method)(f"{LIST}{free.slug}/").status_code == 405

    def test_only_listable_exams_and_no_question_content(self, student):
        shown = exam(instructions_en="Read carefully.")
        draft = exam()
        Exam.objects.filter(pk=draft.pk).update(status="draft")
        hidden = exam()
        Category.objects.filter(pk=hidden.category_id).update(is_active=False)
        body = listing(student)
        assert set(by_slug(body)) == {shown.slug}
        assert {"count", "next", "previous", "results", "server_time"} <= set(body)
        keys = set(walk(body)) | set(walk(detail(student, shown)))
        assert not keys & {"id", "questions", "options", "is_correct", "explanation"}
        assert jwt_client(student).get(f"{LIST}{draft.slug}/").status_code == 404
        assert jwt_client(student).get(f"{LIST}{hidden.slug}/").status_code == 404
        assert jwt_client(student).get(f"{LIST}no-such-exam/").status_code == 404


class TestStatus:
    def test_free_open_exam_can_start_with_full_time(self, student):
        free = exam(duration_minutes=45)
        row = by_slug(listing(student))[free.slug]
        assert row["has_access"] and row["can_start"] and not row["can_resume"]
        assert row["locked_reason"] is None
        assert row["attempt_state"] is None
        assert row["attempts_used"] == 0
        assert row["attempts_allowed"] == 1  # no retake by default
        assert row["seconds_if_started_now"] == 45 * 60

    def test_late_joiner_gets_only_the_time_left(self, student):
        now = timezone.now()
        closing = exam(
            duration_minutes=30,
            start_at=now - timedelta(hours=1),
            end_at=now + timedelta(minutes=10),
        )
        seconds = by_slug(listing(student))[closing.slug]["seconds_if_started_now"]
        assert 9 * 60 < seconds <= 10 * 60

    def test_paid_exam_needs_a_subscription(self, student):
        paid = exam(access_type="paid")
        row = by_slug(listing(student))[paid.slug]
        assert not row["has_access"] and not row["can_start"]
        assert row["locked_reason"] == "needs_subscription"
        assert row["seconds_if_started_now"] is None
        grant(student, make_package(rules=all_paid()))
        row = by_slug(listing(student))[paid.slug]
        assert row["has_access"] and row["can_start"] and row["locked_reason"] is None

    def test_schedule_reasons(self, student):
        now = timezone.now()
        later = exam(start_at=now + timedelta(hours=2), end_at=now + timedelta(hours=3))
        over = exam(start_at=now - timedelta(hours=3), end_at=now - timedelta(hours=1))
        rows = by_slug(listing(student))
        assert rows[later.slug]["locked_reason"] == "exam_not_started"
        assert rows[over.slug]["locked_reason"] == "exam_ended"

    def test_in_progress_then_finished_then_retake_rules(self, student):
        once = exam()
        twice = exam(allow_retake=True, max_attempts=2)
        start(student, once)
        row = by_slug(listing(student))[once.slug]
        assert row["can_resume"] and not row["can_start"] and row["locked_reason"] is None
        assert row["attempt_state"] == "in_progress" and row["attempts_used"] == 1

        take(student, Exam.objects.get(pk=once.pk), "c")
        row = by_slug(listing(student))[once.slug]
        assert row["attempt_state"] == "finished"
        assert row["locked_reason"] == "retake_not_allowed"

        take(student, twice, "c")
        row = by_slug(listing(student))[twice.slug]
        assert row["can_start"] and row["attempts_used"] == 1 and row["attempts_allowed"] == 2
        take(student, twice, "c")
        assert by_slug(listing(student))[twice.slug]["locked_reason"] == "attempt_limit_reached"

    def test_unlimited_retakes(self, student):
        practice = exam(exam_type="practice", allow_retake=True, max_attempts=None)
        assert by_slug(listing(student))[practice.slug]["attempts_allowed"] is None

    def test_every_locked_reason_is_what_start_would_answer(self, student):
        """The list and the start endpoint use the same rules: for each locked exam, a
        start request fails with exactly that code; for each startable one it succeeds."""
        now = timezone.now()
        exams = [
            exam(access_type="paid"),
            exam(start_at=now + timedelta(hours=2), end_at=now + timedelta(hours=3)),
            exam(start_at=now - timedelta(hours=3), end_at=now - timedelta(hours=1)),
            exam(),
            exam(allow_retake=True, max_attempts=2),
        ]
        take(student, exams[3], "c")
        take(student, exams[4], "c")
        take(student, exams[4], "c")
        rows = by_slug(listing(student))
        client = jwt_client(student)
        for row in exams:
            listed = rows[row.slug]
            response = client.post(start_url(row), {}, format="json")
            if listed["locked_reason"]:
                assert response.json()["error"]["code"] == listed["locked_reason"], row.slug
            else:
                assert response.status_code in (200, 201), row.slug


class TestFiltersAndDetail:
    def test_when_filters_and_order(self, student):
        now = timezone.now()
        soon_end = exam(start_at=now - timedelta(hours=1), end_at=now + timedelta(minutes=30))
        late_end = exam(start_at=now - timedelta(hours=1), end_at=now + timedelta(hours=5))
        open_ended = exam()
        first_up = exam(start_at=now + timedelta(hours=1), end_at=now + timedelta(hours=2))
        second_up = exam(start_at=now + timedelta(days=1), end_at=now + timedelta(days=1, hours=1))
        old = exam(
            start_at=now - timedelta(days=2), end_at=now - timedelta(days=2) + timedelta(hours=1)
        )
        recent = exam(start_at=now - timedelta(hours=3), end_at=now - timedelta(hours=2))

        def order(when):
            return [row["slug"] for row in listing(student, f"?when={when}")["results"]]

        assert order("open") == [soon_end.slug, late_end.slug, open_ended.slug]
        assert order("upcoming") == [first_up.slug, second_up.slug]
        assert order("ended") == [recent.slug, old.slug]
        response = jwt_client(student).get(LIST + "?when=tomorrow")
        assert response.status_code == 400

    def test_type_access_category_and_search(self, student):
        practice = exam(exam_type="practice", title_en="Algebra drill")
        paid = exam(access_type="paid", title_en="Physics paid", title_bn="তড়িৎ পেইড")
        assert [r["slug"] for r in listing(student, "?type=practice")["results"]] == [practice.slug]
        assert [r["slug"] for r in listing(student, "?access=paid")["results"]] == [paid.slug]
        category = Category.objects.get(pk=paid.category_id).slug
        assert [r["slug"] for r in listing(student, f"?category={category}")["results"]] == [
            paid.slug
        ]
        assert [r["slug"] for r in listing(student, "?search=algebra")["results"]] == [
            practice.slug
        ]
        assert [r["slug"] for r in listing(student, "?search=তড়িৎ")["results"]] == [paid.slug]

    def test_detail_has_instructions_server_time_and_language(self, student):
        row = exam(
            title_en="Weekly test",
            title_bn="সাপ্তাহিক পরীক্ষা",
            instructions_en="No calculators.",
            instructions_bn="ক্যালকুলেটর নয়।",
        )
        body = detail(student, row, HTTP_ACCEPT_LANGUAGE="en")
        assert body["title"] == "Weekly test" and body["instructions"] == "No calculators."
        assert body["server_time"] and body["can_start"] and body["total_questions"] == 3
        bangla = detail(student, row, HTTP_ACCEPT_LANGUAGE="bn")
        assert bangla["title"] == "সাপ্তাহিক পরীক্ষা" and bangla["instructions"] == "ক্যালকুলেটর নয়।"

    def test_query_count_does_not_grow_with_exams(self, student):
        grant(student, make_package(rules=all_paid()))
        for _ in range(2):
            take(student, exam(), "c")

        def count():
            with CaptureQueriesContext(connection) as ctx:
                listing(student)
            return len(ctx.captured_queries)

        count()  # warm-up: first-request lookups are not per-exam
        few = count()
        for _ in range(6):
            take(student, exam(access_type="paid"), "c")
        assert count() == few


# --------------------------------------------------------------------------------------
# The archive: the question paper of an exam that is over
# --------------------------------------------------------------------------------------
def ended(**fields):
    """A published exam whose window closed an hour ago."""
    now = timezone.now()
    fields.setdefault("start_at", now - timedelta(days=2))
    fields.setdefault("end_at", now - timedelta(hours=1))
    return exam(**fields)


def paper(user, row, **headers):
    return jwt_client(user).get(f"{LIST}{row.slug}/questions/", **headers)


class TestQuestionPaper:
    def test_a_student_who_never_took_the_exam_reads_its_paper_with_the_answers(self, student):
        past = ended()
        assert detail(student, past)["questions_available"] is True
        response = paper(student, past, HTTP_ACCEPT_LANGUAGE="en")
        assert response.status_code == 200, response.content
        body = response.json()
        assert body["slug"] == past.slug and body["total_questions"] == len(body["questions"]) > 0
        first = body["questions"][0]
        assert set(first) >= {
            "number",
            "text",
            "options",
            "correct_option_id",
            "marks",
            "explanation",
        }
        assert "selected_option_id" not in first  # the paper only, nobody's answers
        correct = [option for option in first["options"] if option["is_correct"]]
        assert len(correct) == 1 and correct[0]["id"] == first["correct_option_id"]
        assert [question["number"] for question in body["questions"]] == list(
            range(1, body["total_questions"] + 1)
        )

    def test_an_exam_that_can_still_be_taken_never_shows_its_answers(self, student):
        now = timezone.now()
        open_now = exam(start_at=now - timedelta(hours=1), end_at=now + timedelta(hours=1))
        any_time = exam()  # no window at all: it can always be taken
        upcoming = exam(start_at=now + timedelta(days=1), end_at=now + timedelta(days=2))
        for row in (open_now, any_time, upcoming):
            assert detail(student, row)["questions_available"] is False
            response = paper(student, row)
            assert response.status_code == 403
            assert response.json()["error"]["code"] == "questions_not_available"
            assert "is_correct" not in response.content.decode()

    def test_the_admin_can_keep_the_paper_closed(self, student):
        no_review = ended(allow_answer_review=False)
        hidden = ended(result_visibility="manual")  # results not published by the admin
        for row in (no_review, hidden):
            assert detail(student, row)["questions_available"] is False
            assert paper(student, row).status_code == 403
        Exam.objects.filter(pk=hidden.pk).update(result_published_at=timezone.now())
        assert paper(student, hidden).status_code == 200

    def test_a_paid_exam_needs_a_subscription_that_covers_it(self, student):
        paid = ended(access_type="paid")
        assert detail(student, paid)["questions_available"] is False
        assert paper(student, paid).status_code == 403
        grant(student, make_package(rules=all_paid()))
        assert paper(student, paid).status_code == 200

    def test_needs_a_student_and_a_real_published_exam(self, student):
        past = ended()
        assert APIClient().get(f"{LIST}{past.slug}/questions/").status_code == 401
        assert jwt_client(student).get(f"{LIST}no-such-exam/questions/").status_code == 404
        Exam.objects.filter(pk=past.pk).update(status="unpublished")
        assert paper(student, past).status_code == 404

    def test_the_list_never_carries_the_flag_or_answers(self, student):
        past = ended()
        row = by_slug(listing(student, "?when=ended"))[past.slug]
        assert "questions_available" not in row and "questions" not in row

    def test_the_paper_costs_a_fixed_number_of_queries(self, student):
        past = ended()
        client = jwt_client(student)
        with CaptureQueriesContext(connection) as queries:
            assert client.get(f"{LIST}{past.slug}/questions/").status_code == 200
        assert len(queries) <= 10, len(queries)
