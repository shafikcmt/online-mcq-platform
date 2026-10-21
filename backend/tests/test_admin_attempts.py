"""Milestone 7F: read-only Admin Attempts API (list + detail).

Operational monitoring only: status, server timing and the stored result summary —
never answers, options, question content, device info or idempotency keys."""

import json
from contextlib import contextmanager
from datetime import timedelta
from types import SimpleNamespace
from unittest import mock

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.attempts import services as attempts
from apps.attempts.models import ExamAttempt
from apps.results.models import Result
from tests.test_attempts import (
    SECRET,
    answers_of,
    at,
    correct_option_id,
    item,
    make_student,
    published,
    start,
    walk,
)
from tests.test_exams import make_subject
from tests.test_subscriptions import jwt_client

pytestmark = pytest.mark.django_db

PW = "Strong-Pass-2026"  # test-only value
ATTEMPTS = "/api/v1/admin/attempts/"
GRACE = 30

LIST_FIELDS = {
    "attempt_id",
    "exam_id",
    "exam_title_bn",
    "exam_title_en",
    "user_id",
    "user_full_name",
    "attempt_no",
    "status",
    "started_at",
    "deadline_at",
    "submitted_at",
    "submit_source",
    "content_language",
    "is_overdue",
    "has_result",
    "obtained_marks",
    "total_marks",
    "percentage",
    "is_passed",
}
DETAIL_FIELDS = LIST_FIELDS | {
    "created_at",
    "server_time",
    "remaining_seconds",
    "can_submit_until",
    "time_used_seconds",
    "merit_position",
    "is_merit_counted",
}
# Never in any admin attempt payload, at any depth.
NEVER = {
    "id",
    "public_id",
    "client_info",
    "idempotency_key",
    "answers",
    "questions",
    "options",
    "selected_option",
    "selected_option_id",
    "option_order",
    "display_order",
    "marks",
    "negative_marks",
    "is_correct",
    "awarded_marks",
    "answered_at",
    "client_saved_at",
    "is_marked_for_review",
    "explanation",
    "explanation_en",
    "explanation_bn",
    "correct_option_id",
    "text",
    "text_en",
    "text_bn",
}


@pytest.fixture(autouse=True)
def _settings(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "media")
    settings.ATTEMPT_SUBMIT_GRACE_SECONDS = GRACE


@pytest.fixture
def admin():
    return User.objects.create_user(
        "01612345678", password=PW, full_name="Ops", role=Role.ADMIN, preferred_language="en"
    )


@pytest.fixture
def client(admin):
    api = APIClient()
    api.force_login(admin)
    return api


@contextmanager
def admin_clock(moment):
    """Freeze the admin API's server clock (the engine's clock is frozen with ``at``)."""
    with mock.patch("apps.attempts.api.admin_views.timezone", SimpleNamespace(now=lambda: moment)):
        yield


def submit(user, attempt, *, correct=0):
    rows = answers_of(attempt)[:correct]
    items = [item(row.question_id, correct_option_id(row.question_id)) for row in rows]
    if items:
        attempts.save_answers(user, attempt.public_id, items)
    attempt, _ = attempts.submit_attempt(user, attempt.public_id, source="manual")
    attempt.refresh_from_db()
    return attempt


@pytest.fixture
def subject():
    return make_subject()


@pytest.fixture
def world(subject):
    """Two exams, three students: finished attempts (with results) and open ones."""
    physics = published(subject, title_en="Physics", title_bn="পদার্থবিজ্ঞান", pass_marks=2)
    chemistry = published(subject, title_en="Chemistry", title_bn="রসায়ন")
    rahim = make_student(full_name="Rahim Uddin")
    karima = make_student(full_name="করিমা খাতুন")
    nadia = make_student(full_name="Nadia Islam")
    base = timezone.now() - timedelta(minutes=10)
    with at(base):
        r1, _ = start(rahim, physics)
    with at(base + timedelta(seconds=10)):
        r1 = submit(rahim, r1, correct=3)
    with at(base + timedelta(minutes=1)):
        k1, _ = start(karima, physics)
    with at(base + timedelta(minutes=1, seconds=20)):
        k1 = submit(karima, k1, correct=1)
    with at(base + timedelta(minutes=2)):
        n1, _ = start(nadia, physics)  # open
    with at(base + timedelta(minutes=3)):
        r2, _ = start(rahim, chemistry)  # open
    return SimpleNamespace(
        physics=physics,
        chemistry=chemistry,
        rahim=rahim,
        karima=karima,
        nadia=nadia,
        finished=[r1, k1],
        open=[n1, r2],
        r1=r1,
        k1=k1,
        n1=n1,
        r2=r2,
    )


def ids(response):
    assert response.status_code == 200, response.content
    return [row["attempt_id"] for row in response.json()["results"]]


def uid(attempt):
    return str(attempt.public_id)


# ======================================================================================
# Security
# ======================================================================================
class TestSecurity:
    def test_anonymous_401(self, world):
        assert APIClient().get(ATTEMPTS).status_code == 401
        assert APIClient().get(f"{ATTEMPTS}{uid(world.r1)}/").status_code == 401

    def test_student_jwt_401_and_student_session_403(self, world):
        assert jwt_client(world.rahim).get(ATTEMPTS).status_code == 401
        session = APIClient()
        session.force_login(world.rahim)
        assert session.get(ATTEMPTS).status_code == 403
        assert session.get(f"{ATTEMPTS}{uid(world.r1)}/").status_code == 403

    def test_admin_200(self, client, world):
        assert client.get(ATTEMPTS).status_code == 200
        assert client.get(f"{ATTEMPTS}{uid(world.r1)}/").status_code == 200

    @pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
    def test_read_only(self, client, world, method):
        for path in (ATTEMPTS, f"{ATTEMPTS}{uid(world.n1)}/"):
            assert getattr(client, method)(path, {}, format="json").status_code == 405
        world.n1.refresh_from_db()
        assert world.n1.status == "in_progress"  # nothing changed

    def test_unknown_and_malformed_ids_404(self, client, world):
        assert client.get(f"{ATTEMPTS}00000000-0000-4000-8000-000000000000/").status_code == 404
        assert client.get(f"{ATTEMPTS}not-a-uuid/").status_code == 404
        assert client.get(f"{ATTEMPTS}{world.r1.pk}/").status_code == 404  # numeric id


# ======================================================================================
# Fields: exact sets, nothing about answers
# ======================================================================================
class TestFields:
    def test_list_fields(self, client, world):
        rows = client.get(ATTEMPTS).json()["results"]
        assert len(rows) == 4
        for row in rows:
            assert set(row) == LIST_FIELDS

    def test_detail_fields(self, client, world):
        for attempt in (world.r1, world.n1):
            body = client.get(f"{ATTEMPTS}{uid(attempt)}/").json()
            assert set(body) == DETAIL_FIELDS

    def test_no_answer_content_anywhere(self, client, world):
        ExamAttempt.objects.filter(pk=world.r1.pk).update(
            client_info={"app": "secret-device"}, idempotency_key="secret-key-123"
        )
        payloads = [client.get(ATTEMPTS).json()]
        payloads += [client.get(f"{ATTEMPTS}{uid(a)}/").json() for a in (world.r1, world.n1)]
        for payload in payloads:
            assert not set(walk(payload)) & NEVER
            text = json.dumps(payload, ensure_ascii=False)
            for secret in (SECRET, "secret-device", "secret-key-123", "Option"):
                assert secret not in text

    def test_row_values(self, client, world):
        row = next(
            r for r in client.get(ATTEMPTS).json()["results"] if r["attempt_id"] == uid(world.r1)
        )
        result = Result.objects.get(attempt=world.r1)
        assert row["exam_id"] == world.physics.pk
        assert (row["exam_title_en"], row["exam_title_bn"]) == ("Physics", "পদার্থবিজ্ঞান")
        assert (row["user_id"], row["user_full_name"]) == (world.rahim.pk, "Rahim Uddin")
        assert row["attempt_no"] == 1
        assert row["status"] == "submitted"
        assert row["submit_source"] == "manual"
        assert row["content_language"] in ("bn", "en")
        assert row["has_result"] is True
        assert row["obtained_marks"] == str(result.obtained_marks)
        assert row["total_marks"] == str(result.total_marks)
        assert row["percentage"] == str(result.percentage)
        assert row["is_passed"] is True
        open_row = next(
            r for r in client.get(ATTEMPTS).json()["results"] if r["attempt_id"] == uid(world.n1)
        )
        assert open_row["status"] == "in_progress"
        assert open_row["submitted_at"] is None and open_row["submit_source"] is None
        assert open_row["has_result"] is False
        for field in ("obtained_marks", "total_marks", "percentage", "is_passed"):
            assert open_row[field] is None


# ======================================================================================
# Filters
# ======================================================================================
class TestFilters:
    def test_exam_and_user(self, client, world):
        assert set(ids(client.get(f"{ATTEMPTS}?exam={world.chemistry.pk}"))) == {uid(world.r2)}
        assert set(ids(client.get(f"{ATTEMPTS}?user={world.rahim.pk}"))) == {
            uid(world.r1),
            uid(world.r2),
        }
        both = client.get(f"{ATTEMPTS}?user={world.rahim.pk}&exam={world.physics.pk}")
        assert ids(both) == [uid(world.r1)]
        assert ids(client.get(f"{ATTEMPTS}?user=999999")) == []

    @pytest.mark.parametrize("value", ["abc", "0", "-3", "1.5"])
    def test_invalid_ids_400(self, client, world, value):
        for name in ("exam", "user"):
            response = client.get(f"{ATTEMPTS}?{name}={value}")
            assert response.status_code == 400
            assert name in response.json()["error"]["field_errors"]

    def test_status(self, client, world):
        open_ids = {uid(a) for a in world.open}
        assert set(ids(client.get(f"{ATTEMPTS}?status=in_progress"))) == open_ids
        finished = {uid(a) for a in world.finished}
        assert set(ids(client.get(f"{ATTEMPTS}?status=submitted"))) == finished
        assert ids(client.get(f"{ATTEMPTS}?status=auto_submitted")) == []
        response = client.get(f"{ATTEMPTS}?status=finished")
        assert response.status_code == 400
        assert "status" in response.json()["error"]["field_errors"]

    def test_has_result(self, client, world):
        assert set(ids(client.get(f"{ATTEMPTS}?has_result=true"))) == {
            uid(a) for a in world.finished
        }
        assert set(ids(client.get(f"{ATTEMPTS}?has_result=false"))) == {uid(a) for a in world.open}
        response = client.get(f"{ATTEMPTS}?has_result=maybe")
        assert response.status_code == 400
        assert "has_result" in response.json()["error"]["field_errors"]

    def test_overdue(self, client, world):
        # n1's deadline passes first (started 1 min before r2; same duration).
        moment = world.n1.deadline_at + timedelta(seconds=GRACE + 1)
        with admin_clock(moment):
            assert ids(client.get(f"{ATTEMPTS}?overdue=true")) == [uid(world.n1)]
            not_overdue = set(ids(client.get(f"{ATTEMPTS}?overdue=false")))
        assert not_overdue == {uid(world.r1), uid(world.k1), uid(world.r2)}
        response = client.get(f"{ATTEMPTS}?overdue=yes")
        assert response.status_code == 400
        assert "overdue" in response.json()["error"]["field_errors"]


# ======================================================================================
# Overdue, grace and timing (frozen clock)
# ======================================================================================
class TestTiming:
    def detail(self, client, attempt, moment):
        with admin_clock(moment):
            return client.get(f"{ATTEMPTS}{uid(attempt)}/").json()

    def row(self, client, attempt, moment):
        with admin_clock(moment):
            rows = client.get(ATTEMPTS).json()["results"]
        return next(r for r in rows if r["attempt_id"] == uid(attempt))

    def test_overdue_boundaries(self, client, world):
        attempt = world.n1
        deadline = attempt.deadline_at
        cases = [
            (deadline - timedelta(seconds=1), False),  # still editable
            (deadline, False),  # deadline reached, inside grace
            (deadline + timedelta(seconds=GRACE), False),  # last second a submit is accepted
            (deadline + timedelta(seconds=GRACE, microseconds=1), True),  # past grace
            (deadline + timedelta(hours=2), True),
        ]
        for moment, expected in cases:
            assert self.detail(client, attempt, moment)["is_overdue"] is expected, moment
            assert self.row(client, attempt, moment)["is_overdue"] is expected, moment
            with admin_clock(moment):
                listed = uid(attempt) in ids(client.get(f"{ATTEMPTS}?overdue=true"))
            assert listed is expected, moment

    def test_finished_never_overdue(self, client, world):
        later = world.r1.deadline_at + timedelta(days=1)
        assert self.detail(client, world.r1, later)["is_overdue"] is False

    def test_remaining_seconds_server_time_and_cutoff(self, client, world):
        attempt = world.n1
        moment = attempt.deadline_at - timedelta(seconds=125, microseconds=500)
        body = self.detail(client, attempt, moment)
        assert body["remaining_seconds"] == 125
        assert body["server_time"].startswith(moment.strftime("%Y-%m-%dT%H:%M:%S"))
        cutoff = attempt.deadline_at + timedelta(seconds=GRACE)
        assert body["can_submit_until"].startswith(cutoff.strftime("%Y-%m-%dT%H:%M:%S"))
        assert (
            self.detail(client, attempt, attempt.deadline_at + timedelta(seconds=5))[
                "remaining_seconds"
            ]
            == 0
        )
        assert self.detail(client, world.r1, moment)["remaining_seconds"] == 0  # finished

    def test_auto_finalized_attempt(self, client, world):
        """After the server finalizes it, the attempt is finished, scored, not overdue."""
        moment = world.n1.deadline_at + timedelta(seconds=GRACE + 5)
        with at(moment):
            attempts.finalize_overdue_attempts()
        body = self.detail(client, world.n1, moment)
        assert body["status"] == "auto_submitted"
        assert body["submit_source"] == "server_auto"
        assert body["is_overdue"] is False
        assert body["has_result"] is True


# ======================================================================================
# Result relationship
# ======================================================================================
class TestResult:
    def test_detail_summary_matches_stored_result(self, client, world):
        result = Result.objects.get(attempt=world.k1)
        body = client.get(f"{ATTEMPTS}{uid(world.k1)}/").json()
        assert body["has_result"] is True
        assert body["obtained_marks"] == str(result.obtained_marks)
        assert body["total_marks"] == str(result.total_marks)
        assert body["percentage"] == str(result.percentage)
        assert body["is_passed"] is result.is_passed is False
        assert body["time_used_seconds"] == result.time_used_seconds
        assert body["merit_position"] == result.merit_position
        assert body["is_merit_counted"] is result.is_merit_counted

    def test_stored_values_are_returned_not_recalculated(self, client, world):
        Result.objects.filter(attempt=world.r1).update(percentage="12.34", merit_position=7)
        body = client.get(f"{ATTEMPTS}{uid(world.r1)}/").json()
        assert (body["percentage"], body["merit_position"]) == ("12.34", 7)

    def test_open_attempt_has_no_result(self, client, world):
        body = client.get(f"{ATTEMPTS}{uid(world.n1)}/").json()
        assert body["has_result"] is False
        for field in (
            "obtained_marks",
            "total_marks",
            "percentage",
            "is_passed",
            "time_used_seconds",
            "merit_position",
            "is_merit_counted",
        ):
            assert body[field] is None


# ======================================================================================
# Ordering
# ======================================================================================
class TestOrdering:
    def test_default_newest_start_first(self, client, world):
        assert ids(client.get(ATTEMPTS)) == [
            uid(a) for a in (world.r2, world.n1, world.k1, world.r1)
        ]

    @pytest.mark.parametrize("field", ["started_at", "deadline_at"])
    def test_started_and_deadline(self, client, world, field):
        oldest_first = [uid(a) for a in (world.r1, world.k1, world.n1, world.r2)]
        assert ids(client.get(f"{ATTEMPTS}?ordering={field}")) == oldest_first
        assert ids(client.get(f"{ATTEMPTS}?ordering=-{field}")) == oldest_first[::-1]

    def test_submitted_at_open_attempts_last_both_ways(self, client, world):
        asc = ids(client.get(f"{ATTEMPTS}?ordering=submitted_at"))
        desc = ids(client.get(f"{ATTEMPTS}?ordering=-submitted_at"))
        assert asc[:2] == [uid(world.r1), uid(world.k1)]
        assert desc[:2] == [uid(world.k1), uid(world.r1)]
        open_ids = {uid(a) for a in world.open}
        assert set(asc[2:]) == open_ids and set(desc[2:]) == open_ids

    @pytest.mark.parametrize("value", ["id", "-id", "client_info", "idempotency_key", "user", "x"])
    def test_unknown_ordering_400(self, client, world, value):
        response = client.get(f"{ATTEMPTS}?ordering={value}")
        assert response.status_code == 400
        assert response.json()["error"]["field_errors"] == {"ordering": ["Unknown ordering field."]}


# ======================================================================================
# Pagination and performance
# ======================================================================================
class TestPaginationAndQueries:
    def test_pagination(self, client, world):
        body = client.get(f"{ATTEMPTS}?page_size=3").json()
        assert body["count"] == 4 and len(body["results"]) == 3
        assert len(client.get(f"{ATTEMPTS}?page_size=3&page=2").json()["results"]) == 1

    def test_query_count_does_not_grow_with_rows(self, client, world, subject):
        def count():
            with CaptureQueriesContext(connection) as queries:
                assert client.get(ATTEMPTS).status_code == 200
            return len(queries)

        before = count()
        exam = published(subject, title_en="Biology", title_bn="জীববিজ্ঞান")
        for n in range(4):
            student = make_student(full_name=f"Extra {n}")
            attempt, _ = start(student, exam)
            if n % 2:
                submit(student, attempt, correct=1)
        assert count() == before

    def test_detail_query_count(self, client, world):
        with CaptureQueriesContext(connection) as finished:
            client.get(f"{ATTEMPTS}{uid(world.r1)}/")
        with CaptureQueriesContext(connection) as open_:
            client.get(f"{ATTEMPTS}{uid(world.n1)}/")
        assert len(finished) == len(open_)
