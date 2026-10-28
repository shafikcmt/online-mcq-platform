"""Milestone 4C: scoring, results, visibility, answer review, merit and leaderboards."""

from datetime import timedelta
from decimal import Decimal
from unittest import mock

import pytest
from django.db import IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Role, StudentProfile, User
from apps.attempts import services as attempts
from apps.attempts.models import AttemptAnswer, ExamAttempt
from apps.audit.models import AuditLog
from apps.exams import services as exam_services
from apps.exams.models import Exam, ExamQuestion
from apps.results import selectors, services
from apps.results.exceptions import ResultError
from apps.results.models import Result
from apps.results.tasks import generate_due_merit_task
from tests.test_attempts import (
    GRACE,
    SECRET,
    _fresh,
    _run_concurrently,
    answers_of,
    at,
    correct_option_id,
    exam_services_ctx,
    item,
    make_student,
    published,
    questions,
    start,
    walk,
    wrong_option_id,
)
from tests.test_exams import make_category, make_exam, make_subject
from tests.test_subscriptions import jwt_client

pytestmark = pytest.mark.django_db

PW = "Strong-Pass-2026"  # test-only value
RESULTS = "/api/v1/results/"


@pytest.fixture(autouse=True)
def _media(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "media")
    settings.ATTEMPT_SUBMIT_GRACE_SECONDS = 30
    settings.LEADERBOARD_PUBLIC_NAME_MODE = "masked"
    settings.LEADERBOARD_APP_NAME_MODE = "masked"


@pytest.fixture
def subject():
    return make_subject()


@pytest.fixture
def student():
    return make_student(full_name="Rahim Hossain")


@pytest.fixture
def admin_client():
    admin = User.objects.create_user(
        "01612345678", password=PW, full_name="Ops", role=Role.ADMIN, preferred_language="en"
    )
    client = APIClient()
    client.force_login(admin)
    return client


def take(user, exam, pattern, *, at_time=None, submit=True, source="manual"):
    """Start an attempt and answer by pattern ('c' correct, 'w' wrong, '-' blank), in
    display order; then submit. Returns the finished attempt."""
    attempt, _ = start(user, exam)
    rows = answers_of(attempt)
    items = []
    for row, mark in zip(rows, pattern, strict=False):
        if mark == "c":
            items.append(item(row.question_id, correct_option_id(row.question_id)))
        elif mark == "w":
            items.append(item(row.question_id, wrong_option_id(row.question_id)))
    if items:
        attempts.save_answers(user, attempt.public_id, items)
    if submit:
        if at_time is not None:
            with at(at_time):
                attempt, _ = attempts.submit_attempt(user, attempt.public_id, source=source)
        else:
            attempt, _ = attempts.submit_attempt(user, attempt.public_id, source=source)
    attempt.refresh_from_db()
    return attempt


def result_of(attempt):
    return Result.objects.get(attempt=attempt)


def scored_exam(subject, marks=(None, None, None), /, **extra):
    """Published exam whose questions can carry per-question marks overrides."""
    qs = questions(subject, len(marks))
    exam = make_exam(subject, questions=qs, total_questions=len(marks), **extra)
    for question, value in zip(qs, marks, strict=True):
        if value is not None:
            ExamQuestion.objects.filter(exam=exam, question=question).update(marks=Decimal(value))
    exam_services.publish_exam(exam.pk, ctx=exam_services_ctx())
    exam.refresh_from_db()
    return exam


def code(response):
    return response.json()["error"]["code"]


# ======================================================================================
# Scoring
# ======================================================================================
class TestScoring:
    def test_all_correct(self, student, subject):
        r = result_of(take(student, published(subject), "ccc"))
        assert (r.correct_count, r.wrong_count, r.unanswered_count) == (3, 0, 0)
        assert r.obtained_marks == r.total_marks == Decimal("3.00")
        assert r.percentage == Decimal("100.00") and r.is_passed is None

    def test_all_wrong_with_negative_marking_goes_below_zero(self, student, subject):
        exam = published(subject, negative_marks=Decimal("0.25"), pass_marks=Decimal("0"))
        r = result_of(take(student, exam, "www"))
        assert (r.correct_count, r.wrong_count, r.unanswered_count) == (0, 3, 0)
        assert r.positive_marks == 0 and r.negative_marks_total == Decimal("0.75")
        assert r.obtained_marks == Decimal("-0.75")  # no floor at zero
        assert r.percentage == Decimal("-25.00") and r.is_passed is False

    def test_all_unanswered(self, student, subject):
        exam = published(subject, negative_marks=Decimal("1"))
        r = result_of(take(student, exam, "---"))
        assert (r.unanswered_count, r.obtained_marks, r.percentage) == (3, 0, Decimal("0.00"))

    def test_mixed_decimal_marks_and_penalty(self, student, subject):
        exam = scored_exam(subject, ("2.50", "1.25", None, "0.75"), negative_marks=Decimal("0.33"))
        attempt = take(student, exam, "cw-c")
        rows = answers_of(attempt)
        marks = [r.marks for r in rows]
        assert marks == [Decimal("2.50"), Decimal("1.25"), Decimal("1.00"), Decimal("0.75")]
        assert [r.awarded_marks for r in rows] == [
            Decimal("2.50"),
            Decimal("-0.33"),
            Decimal("0.00"),
            Decimal("0.75"),
        ]
        assert [r.is_correct for r in rows] == [True, False, None, True]
        r = result_of(attempt)
        assert r.positive_marks == Decimal("3.25") and r.negative_marks_total == Decimal("0.33")
        assert r.obtained_marks == Decimal("2.92") and r.total_marks == Decimal("5.50")
        assert r.percentage == Decimal("53.09")  # 2.92 / 5.5 × 100 = 53.0909… → half-up

    def test_zero_negative_marking(self, student, subject):
        r = result_of(take(student, published(subject), "ww-"))
        assert (r.wrong_count, r.negative_marks_total, r.obtained_marks) == (2, 0, 0)

    @pytest.mark.parametrize(("pattern", "expected"), [("c--", "33.33"), ("cc-", "66.67")])
    def test_repeating_decimals_round_half_up(self, student, subject, pattern, expected):
        assert result_of(take(student, published(subject), pattern)).percentage == Decimal(expected)

    @pytest.mark.parametrize(
        ("pass_marks", "passed"), [("2.00", True), ("1.99", True), ("2.01", False)]
    )
    def test_pass_threshold(self, student, subject, pass_marks, passed):
        exam = published(subject, pass_marks=Decimal(pass_marks))
        assert result_of(take(student, exam, "cc-")).is_passed is passed  # obtained 2.00

    def test_review_mark_and_cleared_answer_do_not_score(self, student, subject):
        exam = published(subject)
        attempt, _ = start(student, exam)
        rows = answers_of(attempt)
        q0, q1 = rows[0].question_id, rows[1].question_id
        attempts.save_answers(
            student,
            attempt.public_id,
            [
                item(q0, correct_option_id(q0), is_marked_for_review=True),
                item(q1, correct_option_id(q1)),
            ],
        )
        attempts.save_answers(
            student, attempt.public_id, [item(q1, None, when=timezone.now() + timedelta(seconds=1))]
        )
        attempts.submit_attempt(student, attempt.public_id)
        r = result_of(attempt)
        assert (r.correct_count, r.unanswered_count, r.obtained_marks) == (1, 2, Decimal("1.00"))

    def test_foreign_option_is_never_scored(self, student, subject):
        exam = published(subject)
        attempt, _ = start(student, exam)
        rows = answers_of(attempt)
        # Corrupt the data directly (impossible through the API).
        AttemptAnswer.objects.filter(pk=rows[0].pk).update(
            selected_option_id=correct_option_id(rows[1].question_id)
        )
        attempts.submit_attempt(student, attempt.public_id)
        r = result_of(attempt)
        assert (r.correct_count, r.unanswered_count) == (0, 3)

    def test_time_used(self, student, subject):
        exam = published(subject)
        attempt, _ = start(student, exam)
        done = take_after(student, attempt, attempt.started_at + timedelta(minutes=10))
        assert result_of(done).time_used_seconds == 600

    def test_time_used_capped_at_deadline_in_grace(self, student, subject):
        attempt, _ = start(student, published(subject))
        done = take_after(student, attempt, attempt.deadline_at + timedelta(seconds=20))
        assert result_of(done).time_used_seconds == 30 * 60

    def test_auto_finalized_attempt_is_scored_the_same_way(self, student, subject):
        exam = published(subject, negative_marks=Decimal("0.5"))
        attempt = take(student, exam, "cw-", submit=False)
        with at(attempt.deadline_at + GRACE + timedelta(seconds=5)):
            assert attempts.finalize_overdue_attempts() == 1
        r = result_of(attempt)
        attempt.refresh_from_db()
        assert attempt.status == "auto_submitted"
        assert (r.correct_count, r.wrong_count, r.obtained_marks) == (1, 1, Decimal("0.50"))
        assert r.time_used_seconds == 30 * 60

    def test_live_late_join_time_is_capped_at_exam_end(self, student, subject):
        now = timezone.now()
        exam = published(
            subject,
            exam_type="live",
            start_at=now - timedelta(minutes=50),
            end_at=now + timedelta(minutes=10),
            duration_minutes=45,
        )
        attempt, _ = start(student, exam)
        assert attempt.deadline_at == exam.end_at
        with at(exam.end_at + timedelta(seconds=10)):
            attempts.submit_attempt(student, attempt.public_id)
        assert result_of(attempt).time_used_seconds == int(
            (exam.end_at - attempt.started_at).total_seconds()
        )

    @pytest.mark.parametrize(
        "sql",
        [
            "UPDATE results_result SET correct_count = correct_count + 1",
            "UPDATE results_result SET obtained_marks = obtained_marks + 1",
            "UPDATE results_result SET total_marks = 0",
            "UPDATE results_result SET negative_marks_total = -1,"
            " obtained_marks = positive_marks + 1",
            "UPDATE results_result SET merit_position = 1, is_merit_counted = false",
        ],
    )
    def test_database_constraints(self, student, subject, sql):
        take(student, published(subject), "c--")
        with pytest.raises(IntegrityError), transaction.atomic(), connection.cursor() as cur:
            cur.execute(sql)

    def test_one_result_per_attempt_in_database(self, student, subject):
        r = result_of(take(student, published(subject), "c--"))
        fields = {f.name: getattr(r, f.name) for f in Result._meta.fields if f.name not in ("id",)}
        fields["attempt"] = r.attempt
        fields["is_merit_counted"] = False
        with pytest.raises(IntegrityError), transaction.atomic():
            Result.objects.create(
                **{k: v for k, v in fields.items() if k not in ("created_at", "updated_at")}
            )

    def test_rescoring_returns_the_existing_result(self, student, subject):
        attempt = take(student, published(subject), "c--")
        first = result_of(attempt)
        with transaction.atomic():
            again = services.record_result(
                ExamAttempt.objects.select_for_update().get(pk=attempt.pk)
            )
        assert again.pk == first.pk and Result.objects.count() == 1
        attempts.submit_attempt(student, attempt.public_id)  # retried submit
        assert Result.objects.count() == 1


def take_after(user, attempt, moment):
    with at(moment):
        done, _ = attempts.submit_attempt(user, attempt.public_id)
    return done


# ======================================================================================
# Visibility and endpoints
# ======================================================================================
class TestVisibility:
    def test_immediate(self, student, subject):
        attempt = take(student, published(subject), "c--")
        client = jwt_client(student)
        body = client.get(f"{RESULTS}{attempt.public_id}/").json()
        assert body["obtained_marks"] == "1.00" and body["review_available"] is True
        assert [r["attempt_id"] for r in client.get(RESULTS).json()["results"]] == [
            str(attempt.public_id)
        ]

    def test_after_exam_end_boundaries(self, student, subject):
        now = timezone.now()
        exam = published(
            subject, result_visibility="after_exam_end", end_at=now + timedelta(hours=1)
        )
        attempt = take(student, exam, "c--")
        tick = timedelta(microseconds=1)
        assert not selectors.results_visible(exam, exam.end_at - tick)
        assert selectors.results_visible(exam, exam.end_at)
        client = jwt_client(student)
        response = client.get(f"{RESULTS}{attempt.public_id}/")
        assert response.status_code == 403 and code(response) == "result_not_visible"
        assert "obtained_marks" not in response.content.decode()
        assert client.get(RESULTS).json()["results"] == []
        with mock.patch("apps.results.api.views.timezone.now", return_value=exam.end_at):
            assert client.get(f"{RESULTS}{attempt.public_id}/").status_code == 200

    def test_after_exam_end_requires_an_end_time(self, subject, admin_client):
        from django.core.exceptions import ValidationError

        with pytest.raises(ValidationError) as exc:
            make_exam(subject, result_visibility="after_exam_end")
        assert [e.code for e in exc.value.error_dict["end_at"]] == ["end_required_for_results"]
        # Valid combinations.
        make_exam(
            subject, result_visibility="after_exam_end", end_at=timezone.now() + timedelta(days=1)
        )
        make_exam(subject, result_visibility="immediate")
        draft = make_exam(subject, result_visibility="manual")
        # Switching to after_exam_end without an end time is rejected (API: 400).
        response = admin_client.patch(
            f"/api/v1/admin/exams/{draft.pk}/",
            {"result_visibility": "after_exam_end"},
            format="json",
        )
        assert response.status_code == 400
        assert "end_at" in response.json()["error"]["field_errors"]
        draft.refresh_from_db()
        assert draft.result_visibility == "manual"
        # Removing the end of an after_exam_end exam is rejected too.
        ended = make_exam(
            subject, result_visibility="after_exam_end", end_at=timezone.now() + timedelta(days=1)
        )
        response = admin_client.patch(
            f"/api/v1/admin/exams/{ended.pk}/", {"end_at": None}, format="json"
        )
        assert response.status_code == 400

    def test_after_exam_end_without_end_cannot_be_published_or_stored(self, subject):
        exam = make_exam(subject, result_visibility="manual")
        exam.result_visibility = "after_exam_end"  # bypass the service in memory only
        with transaction.atomic():
            problems = exam_services.publish_errors(exam)
        assert [e.code for e in problems["end_at"]] == ["end_required_for_results"]
        with pytest.raises(IntegrityError), transaction.atomic(), connection.cursor() as cur:
            cur.execute("UPDATE exams_exam SET result_visibility = 'after_exam_end', end_at = NULL")

    def test_result_becomes_visible_exactly_at_end(self, student, subject):
        end = timezone.now() + timedelta(hours=1)
        exam = published(subject, result_visibility="after_exam_end", end_at=end)
        attempt = take(student, exam, "c--")
        client = jwt_client(student)
        tick = timedelta(microseconds=1)
        with mock.patch("apps.results.api.views.timezone.now", return_value=end - tick):
            assert client.get(f"{RESULTS}{attempt.public_id}/").status_code == 403
        with mock.patch("apps.results.api.views.timezone.now", return_value=end):
            assert client.get(f"{RESULTS}{attempt.public_id}/").status_code == 200

    def test_manual_publish_and_hide(self, student, subject, admin_client):
        exam = published(subject, result_visibility="manual")
        attempt = take(student, exam, "c--")
        client = jwt_client(student)
        detail = f"{RESULTS}{attempt.public_id}/"
        assert client.get(detail).status_code == 403
        response = admin_client.post(f"/api/v1/admin/exams/{exam.pk}/results/publish/")
        assert response.status_code == 200 and response.json()["result_published_at"]
        admin_client.post(f"/api/v1/admin/exams/{exam.pk}/results/publish/")  # no-op
        assert AuditLog.objects.filter(action="exam.results_publish").count() == 1
        assert client.get(detail).status_code == 200
        admin_client.post(f"/api/v1/admin/exams/{exam.pk}/results/hide/")
        assert client.get(detail).status_code == 403
        assert AuditLog.objects.filter(action="exam.results_hide").count() == 1

    def test_hide_keeps_immediate_results_visible(self, student, subject):
        exam = published(subject)
        attempt = take(student, exam, "c--")
        exam_services.publish_results(exam.pk, ctx=exam_services_ctx())
        exam_services.hide_results(exam.pk, ctx=exam_services_ctx())
        assert jwt_client(student).get(f"{RESULTS}{attempt.public_id}/").status_code == 200

    def test_submit_response_respects_visibility(self, student, subject):
        hidden = published(subject, result_visibility="manual")
        attempt, _ = start(student, hidden)
        body = (
            jwt_client(student)
            .post(f"/api/v1/attempts/{attempt.public_id}/submit/", {}, format="json")
            .json()
        )
        assert body["result_available"] is False and body["result"] is None
        assert Result.objects.filter(attempt=attempt).exists()  # stored, just not shown

    def test_unfinished_or_foreign_results_are_not_found(self, student, subject):
        exam = published(subject, exam_type="practice")
        mine = take(student, exam, "c--")
        open_attempt, _ = start(student, exam)
        other = take(make_student(), exam, "ccc")
        client = jwt_client(student)
        for attempt in (open_attempt, other):
            assert client.get(f"{RESULTS}{attempt.public_id}/").status_code == 404
            assert client.get(f"{RESULTS}{attempt.public_id}/review/").status_code == 404
        assert client.get(f"{RESULTS}{result_of(mine).pk}/").status_code == 404
        assert client.get(f"{RESULTS}{mine.pk}/").status_code == 404
        assert APIClient().get(f"{RESULTS}{mine.public_id}/").status_code == 401


# ======================================================================================
# Answer review
# ======================================================================================
REVIEW_ONLY = {
    "is_correct",
    "correct_option_id",
    "explanation",
    "explanation_bn",
    "explanation_en",
    "awarded_marks",
}


class TestReview:
    def test_review_contents(self, student, subject):
        exam = published(subject, negative_marks=Decimal("0.5"))
        attempt = take(student, exam, "cw-")
        body = jwt_client(student).get(f"{RESULTS}{attempt.public_id}/review/").json()
        rows = answers_of(attempt)
        assert body["result"]["obtained_marks"] == "0.50"
        for question, row in zip(body["questions"], rows, strict=True):
            assert question["question_id"] == row.question_id
            assert question["correct_option_id"] == correct_option_id(row.question_id)
            assert question["selected_option_id"] == row.selected_option_id
            assert question["is_correct"] == row.is_correct
            assert Decimal(question["awarded_marks"]) == row.awarded_marks
            assert question["explanation"] == SECRET
            assert [o["id"] for o in question["options"]] == row.option_order
            assert sum(o["is_correct"] for o in question["options"]) == 1

    def test_review_needs_permission_and_visibility(self, student, subject):
        no_review = published(subject, allow_answer_review=False)
        attempt = take(student, no_review, "c--")
        response = jwt_client(student).get(f"{RESULTS}{attempt.public_id}/review/")
        assert response.status_code == 403 and code(response) == "review_not_allowed"
        assert SECRET not in response.content.decode()
        hidden = published(subject, result_visibility="manual")
        attempt = take(student, hidden, "c--")
        response = jwt_client(student).get(f"{RESULTS}{attempt.public_id}/review/")
        assert response.status_code == 403 and code(response) == "result_not_visible"

    def test_nothing_before_review_leaks_answers(self, student, subject):
        exam = published(subject, content_language="both")
        client = jwt_client(student)
        start_body = client.post(f"/api/v1/exams/{exam.slug}/attempts/", {}, format="json")
        attempt = ExamAttempt.objects.get()
        q = answers_of(attempt)[0].question_id
        responses = [
            start_body,
            client.put(
                f"/api/v1/attempts/{attempt.public_id}/answers/{q}/",
                {
                    "selected_option_id": wrong_option_id(q),
                    "client_saved_at": timezone.now().isoformat(),
                },
                format="json",
            ),
            client.post(f"/api/v1/attempts/{attempt.public_id}/submit/", {}, format="json"),
            client.get(f"/api/v1/attempts/{attempt.public_id}/"),  # exam room after submit
            client.get(RESULTS),
            client.get(f"{RESULTS}{attempt.public_id}/"),
        ]
        for response in responses:
            assert response.status_code in (200, 201)
            keys = set(walk(response.json()))
            assert not keys & REVIEW_ONLY, (response.request["PATH_INFO"], keys & REVIEW_ONLY)
            assert SECRET not in response.content.decode()

    def test_review_queries_do_not_grow(self, subject):
        counts = []
        for n in (2, 8):
            user = make_student()
            attempt = take(user, published(subject, n=n), "c" * n)
            client = jwt_client(user)
            with CaptureQueriesContext(connection) as queries:
                assert client.get(f"{RESULTS}{attempt.public_id}/review/").status_code == 200
            counts.append(len(queries))
        assert counts[0] == counts[1]


# ======================================================================================
# Merit selection and ranking
# ======================================================================================
class TestMerit:
    def _scores(self, user, exam, patterns, step=timedelta(minutes=1)):
        attempts_done = []
        base = timezone.now()
        for i, pattern in enumerate(patterns):
            attempt, _ = start(user, exam)
            attempt = take_after_answers(user, attempt, pattern, base + step * (i + 1))
            attempts_done.append(attempt)
        return attempts_done

    @pytest.mark.parametrize(
        ("strategy", "chosen"),
        [("first_attempt", 0), ("best_attempt", 1), ("latest_attempt", 2)],
    )
    def test_strategies(self, student, subject, strategy, chosen):
        exam = published(subject, exam_type="practice", merit_enabled=True, merit_strategy=strategy)
        done = self._scores(student, exam, ["c--", "ccc", "cc-"])
        counted = Result.objects.get(exam=exam, user=student, is_merit_counted=True)
        assert counted.attempt_id == done[chosen].pk
        assert Result.objects.filter(exam=exam, user=student).count() == 3

    def test_best_attempt_tie_prefers_less_time_then_earlier(self, student, subject):
        exam = published(
            subject, exam_type="practice", merit_enabled=True, merit_strategy="best_attempt"
        )
        a, _ = start(student, exam)
        a = take_after_answers(student, a, "cc-", a.started_at + timedelta(minutes=9))
        b, _ = start(student, exam)
        b = take_after_answers(student, b, "cc-", b.started_at + timedelta(minutes=5))
        assert Result.objects.get(is_merit_counted=True).attempt_id == b.pk

    def test_live_counts_the_single_attempt(self, student, subject):
        now = timezone.now()
        exam = published(
            subject,
            exam_type="live",
            start_at=now - timedelta(minutes=1),
            end_at=now + timedelta(hours=1),
        )
        attempt = take(student, exam, "c--")
        assert result_of(attempt).is_merit_counted

    def test_merit_disabled(self, student, subject):
        exam = published(subject, exam_type="practice")  # practice default: merit off
        attempt = take(student, exam, "ccc")
        assert not result_of(attempt).is_merit_counted
        with pytest.raises(ResultError) as exc:
            services.generate_merit(exam.pk)
        assert exc.value.code == "merit_disabled"
        response = jwt_client(student).get(f"/api/v1/exams/{exam.slug}/leaderboard/")
        assert response.status_code == 404 and code(response) == "merit_disabled"

    def test_generate_orders_by_marks_then_time_then_submit(self, subject):
        exam = published(subject, n=3)
        users = [make_student(full_name=f"Student {i}") for i in range(5)]
        base = timezone.now()
        plan = [  # (pattern, minutes used)
            ("cc-", 10),  # 2 marks, slower
            ("ccc", 20),  # 3 marks → 1st
            ("cc-", 5),  # 2 marks, faster → 2nd
            ("c--", 1),
            ("cc-", 10),  # same marks + time as user 0, submitted later → after user 0
        ]
        for offset, (user, (pattern, minutes)) in enumerate(zip(users, plan, strict=True)):
            moment = base + timedelta(seconds=offset)
            with at(moment):
                attempt, _ = start(user, exam)
            take_after_answers(user, attempt, pattern, moment + timedelta(minutes=minutes))
        assert services.generate_merit(exam.pk) == 5
        order = list(selectors.ranked_results(exam).values_list("user__full_name", flat=True))
        assert order == ["Student 1", "Student 2", "Student 0", "Student 4", "Student 3"]
        assert list(selectors.ranked_results(exam).values_list("merit_position", flat=True)) == [
            1,
            2,
            3,
            4,
            5,
        ]
        services.generate_merit(exam.pk)  # re-run: same positions
        assert (
            list(selectors.ranked_results(exam).values_list("user__full_name", flat=True)) == order
        )

    def test_complete_tie_is_deterministic(self, subject):
        exam = published(subject)
        moment = timezone.now()
        users = [make_student() for _ in range(3)]
        done = []
        for user in users:
            with at(moment):
                attempt, _ = start(user, exam)
            done.append(take_after_answers(user, attempt, "c--", moment + timedelta(minutes=3)))
        services.generate_merit(exam.pk)
        ranked = list(selectors.ranked_results(exam).values_list("attempt_id", "merit_position"))
        # Same marks, time and submit instant: sequential ranks by the stable final key.
        assert ranked == [(a.pk, i) for i, a in enumerate(sorted(done, key=lambda a: a.pk), 1)]
        keys = set(
            Result.objects.filter(exam=exam).values_list(
                "obtained_marks", "time_used_seconds", "submitted_at"
            )
        )
        assert len(keys) == 1  # a genuine complete tie
        services.generate_merit(exam.pk)
        assert (
            list(selectors.ranked_results(exam).values_list("attempt_id", "merit_position"))
            == ranked
        )

    def test_moved_flag_is_re_ranked(self, student, subject):
        exam = published(
            subject, exam_type="practice", merit_enabled=True, merit_strategy="latest_attempt"
        )
        first = take(student, exam, "c--")
        services.generate_merit(exam.pk)
        assert result_of(first).merit_position == 1
        second = take(student, exam, "cc-")
        assert result_of(first).merit_position is None and not result_of(first).is_merit_counted
        assert result_of(second).is_merit_counted and result_of(second).merit_position is None
        assert services.generate_due_merit() == 1
        assert result_of(second).merit_position == 1

    def test_due_merit_waits_for_the_exam_end(self, subject):
        now = timezone.now()
        running = published(
            subject,
            exam_type="live",
            start_at=now - timedelta(minutes=5),
            end_at=now + timedelta(hours=1),
        )
        open_ended = published(subject)
        take(make_student(), running, "c--")
        take(make_student(), open_ended, "c--")
        assert generate_due_merit_task() == 1  # only the exam without an end
        assert not Result.objects.filter(exam=running, merit_position__isnull=False).exists()
        with mock.patch(
            "apps.results.services.timezone.now", return_value=running.end_at + timedelta(seconds=1)
        ):
            assert services.generate_due_merit() == 1
        assert Result.objects.get(exam=running).merit_position == 1
        assert services.generate_due_merit() == 0  # nothing new


def take_after_answers(user, attempt, pattern, moment):
    rows = answers_of(attempt)
    items = []
    for row, mark in zip(rows, pattern, strict=False):
        if mark == "c":
            items.append(item(row.question_id, correct_option_id(row.question_id)))
        elif mark == "w":
            items.append(item(row.question_id, wrong_option_id(row.question_id)))
    if items:
        attempts.save_answers(user, attempt.public_id, items)
    return take_after(user, attempt, moment)


# ======================================================================================
# Leaderboards and names
# ======================================================================================
class TestLeaderboard:
    def _board(self, subject, n_students=3, **extra):
        exam = published(subject, **extra)
        users = [make_student(full_name=f"Karim{i} Uddin") for i in range(n_students)]
        for i, user in enumerate(users):
            take(user, exam, "c" * (i + 1) + "-" * (3 - i - 1))
        services.generate_merit(exam.pk)
        return exam, users

    def test_app_leaderboard(self, subject, settings):
        exam, users = self._board(subject)
        me = users[0]
        response = jwt_client(me).get(f"/api/v1/exams/{exam.slug}/leaderboard/?page_size=2")
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 3 and body["my_position"] == 3 and body["next"]
        rows = body["results"]
        assert [r["position"] for r in rows] == [1, 2]
        assert rows[0]["name"] == "Kar*** U." and rows[0]["is_me"] is False
        page2 = jwt_client(me).get(f"/api/v1/exams/{exam.slug}/leaderboard/?page=2&page_size=2")
        own = page2.json()["results"][0]
        assert own["is_me"] is True and own["name"] == "Karim0 Uddin"  # own full name
        text = response.content.decode() + page2.content.decode()
        for user in users:
            assert user.mobile_number not in text
        assert "mobile" not in text and "email" not in text and "user_id" not in text

    def test_public_leaderboard(self, subject, settings):
        settings.LEADERBOARD_PUBLIC_SIZE = 2
        exam, users = self._board(subject)
        response = APIClient().get(f"/api/v1/public/exams/{exam.slug}/leaderboard/")
        assert response.status_code == 200
        rows = response.json()
        assert len(rows) == 2 and set(rows[0]) == {
            "position",
            "name",
            "obtained_marks",
            "total_marks",
            "percentage",
            "time_used_seconds",
        }
        assert all("***" in r["name"] for r in rows)
        # SECURITY_PLAN §4: masked mode never shows a full name, a phone number or an email.
        for index, user in enumerate(users):
            User.objects.filter(pk=user.pk).update(email=f"student{index}@example.org")
        text = APIClient().get(f"/api/v1/public/exams/{exam.slug}/leaderboard/").content.decode()
        for user in users:
            assert user.full_name not in text and user.mobile_number not in text
            assert user.mobile_number[-10:] not in text  # nor the local form
        assert "@" not in text and "example.org" not in text
        broken = APIClient()
        broken.credentials(HTTP_AUTHORIZATION="Bearer broken")
        assert broken.get(f"/api/v1/public/exams/{exam.slug}/leaderboard/").json() == rows

    def test_public_leaderboard_list(self, subject):
        LIST = "/api/v1/public/leaderboards/"
        board, _users = self._board(subject)
        published(subject)  # no results yet: no merit list
        not_generated = published(subject)
        take(make_student(), not_generated, "ccc")  # results, but merit not generated
        hidden, _ = self._board(subject, result_visibility="manual")
        response = APIClient().get(LIST)
        assert response.status_code == 200
        rows = response.json()["results"]
        assert [r["slug"] for r in rows] == [board.slug]
        assert rows[0]["ranked_count"] == 3 and rows[0]["title"]
        assert "id" not in rows[0] and "merit_enabled" not in rows[0]
        # Publishing the hidden exam's results lists it; unpublishing an exam removes it.
        exam_services.publish_results(hidden.pk, ctx=exam_services_ctx())
        assert {r["slug"] for r in APIClient().get(LIST).json()["results"]} == {
            board.slug,
            hidden.slug,
        }
        exam_services.unpublish_exam(board.pk, ctx=exam_services_ctx())
        assert [r["slug"] for r in APIClient().get(LIST).json()["results"]] == [hidden.slug]

    def test_public_leaderboard_list_merit_disabled(self, subject):
        exam, _users = self._board(subject)
        Exam.objects.filter(pk=exam.pk).update(merit_enabled=False)
        assert APIClient().get("/api/v1/public/leaderboards/").json()["results"] == []

    @pytest.mark.parametrize(
        ("mode", "expected"),
        [
            ("masked", "Kar*** U."),
            ("initials", "K. U."),
            ("full_name", "Karim2 Uddin"),
            ("display_name", "TopScorer"),
            ("bogus", "Kar*** U."),
        ],
    )
    def test_name_modes(self, subject, settings, mode, expected):
        settings.LEADERBOARD_PUBLIC_NAME_MODE = mode
        exam, users = self._board(subject)
        StudentProfile.objects.update_or_create(
            user=users[2], defaults={"display_name": "TopScorer"}
        )
        rows = APIClient().get(f"/api/v1/public/exams/{exam.slug}/leaderboard/").json()
        assert rows[0]["name"] == expected

    def test_hidden_results_hide_the_leaderboard(self, subject, student):
        exam, users = self._board(subject, result_visibility="manual")
        assert APIClient().get(f"/api/v1/public/exams/{exam.slug}/leaderboard/").status_code == 404
        response = jwt_client(users[0]).get(f"/api/v1/exams/{exam.slug}/leaderboard/")
        assert response.status_code == 403 and code(response) == "result_not_visible"
        exam_services.publish_results(exam.pk, ctx=exam_services_ctx())
        assert APIClient().get(f"/api/v1/public/exams/{exam.slug}/leaderboard/").status_code == 200

    def test_unpublished_exam(self, subject):
        exam, users = self._board(subject)
        exam_services.unpublish_exam(exam.pk, ctx=exam_services_ctx())
        assert APIClient().get(f"/api/v1/public/exams/{exam.slug}/leaderboard/").status_code == 404
        # A participant can still see the merit list of an exam they took.
        assert (
            jwt_client(users[0]).get(f"/api/v1/exams/{exam.slug}/leaderboard/").status_code == 200
        )
        assert (
            jwt_client(make_student()).get(f"/api/v1/exams/{exam.slug}/leaderboard/").status_code
            == 404
        )

    def test_leaderboard_queries_do_not_grow(self, subject):
        counts = []
        for n in (2, 6):
            exam, users = self._board(make_subject(f"s{n}", category=make_category(f"c{n}")), n)
            client = jwt_client(users[0])
            with CaptureQueriesContext(connection) as queries:
                assert client.get(f"/api/v1/exams/{exam.slug}/leaderboard/").status_code == 200
            counts.append(len(queries))
        assert counts[0] == counts[1]

    @pytest.mark.parametrize(
        ("name", "masked"),
        [
            ("Rahim Hossain", "Rah*** H."),
            ("Ali", "Al***"),
            ("A", "A***"),
            ("", "***"),
            ("রহিম হোসেন", "রহি*** হো."),
            ("Md Rahim Uddin", "M*** U."),
        ],
    )
    def test_masking(self, name, masked):
        assert selectors.masked_name(name) == masked


# ======================================================================================
# Admin
# ======================================================================================
class TestAdmin:
    def test_permissions(self, student, subject):
        exam = published(subject)
        take(student, exam, "c--")
        session_student = APIClient()
        session_student.force_login(student)
        csrf = APIClient(enforce_csrf_checks=True)
        admin = User.objects.create_user(
            "01612345679", password=PW, full_name="Ops", role=Role.ADMIN
        )
        csrf.force_login(admin)
        for method, path in [
            ("post", f"/api/v1/admin/exams/{exam.pk}/results/publish/"),
            ("post", f"/api/v1/admin/exams/{exam.pk}/results/hide/"),
            ("post", f"/api/v1/admin/exams/{exam.pk}/merit/generate/"),
            ("get", "/api/v1/admin/results/"),
        ]:
            assert getattr(APIClient(), method)(path).status_code == 401
            assert getattr(jwt_client(student), method)(path).status_code == 401
            assert getattr(session_student, method)(path).status_code == 403
            if method == "post":
                assert getattr(csrf, method)(path).status_code == 403
        assert not AuditLog.objects.filter(action__startswith="exam.results").exists()

    def test_merit_generate_and_results_list(self, admin_client, subject):
        exam = published(subject)
        users = [make_student() for _ in range(2)]
        take(users[0], exam, "c--")
        take(users[1], exam, "ccc")
        response = admin_client.post(f"/api/v1/admin/exams/{exam.pk}/merit/generate/")
        assert response.status_code == 200 and response.json() == {"ranked_count": 2}
        entry = AuditLog.objects.get(action="exam.merit_generate")
        assert entry.metadata == {"values": {"ranked_count": 2}}
        rows = admin_client.get(f"/api/v1/admin/results/?exam={exam.pk}").json()["results"]
        assert [r["merit_position"] for r in rows] == [1, 2]
        assert rows[0]["user_id"] == users[1].pk
        assert admin_client.get("/api/v1/admin/results/?exam=x").status_code == 400
        assert admin_client.post("/api/v1/admin/exams/999999/merit/generate/").status_code == 404

    def test_no_score_editing_endpoint(self, admin_client, student, subject):
        attempt = take(student, published(subject), "c--")
        for method in ("patch", "put", "delete"):
            response = getattr(admin_client, method)(
                f"/api/v1/admin/results/{attempt.public_id}/",
                {"obtained_marks": "99"},
                format="json",
            )
            assert response.status_code == 404
        assert result_of(attempt).obtained_marks == Decimal("1.00")

    def test_published_flag_is_not_editable_through_exam_update(self, admin_client, subject):
        exam = published(subject)
        exam_services.unpublish_exam(exam.pk, ctx=exam_services_ctx())
        admin_client.patch(
            f"/api/v1/admin/exams/{exam.pk}/",
            {"result_published_at": timezone.now().isoformat()},
            format="json",
        )
        exam.refresh_from_db()
        assert exam.result_published_at is None

    def test_results_can_be_published_on_exams_with_attempts(self, student, subject):
        exam = published(subject, result_visibility="manual")
        take(student, exam, "c--")
        exam_services.unpublish_exam(exam.pk, ctx=exam_services_ctx())
        exam_services.archive_exam(exam.pk, ctx=exam_services_ctx())
        assert exam_services.publish_results(exam.pk, ctx=exam_services_ctx()).result_published_at


# ======================================================================================
# Concurrency
# ======================================================================================
@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_double_submit_creates_one_result(run):
    exam = _fresh(f"rd{run}")
    student = make_student()
    attempt, _ = start(student, exam)
    results = _run_concurrently(*[lambda: attempts.submit_attempt(student, attempt.public_id)] * 3)
    assert all(isinstance(r, tuple) for r in results), results
    assert Result.objects.filter(attempt=attempt).count() == 1


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_submit_vs_finalizer_creates_one_result(run):
    exam = _fresh(f"rf{run}")
    student = make_student()
    attempt, _ = start(student, exam)
    with at(attempt.deadline_at + GRACE + timedelta(seconds=1)):
        _run_concurrently(
            lambda: attempts.submit_attempt(student, attempt.public_id),
            lambda: attempts.finalize_overdue_attempts(),
        )
    assert Result.objects.filter(attempt=attempt).count() == 1


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_two_finalizers_create_one_result_each(run):
    exam = _fresh(f"rw{run}", exam_type="practice")
    users = [make_student() for _ in range(6)]
    opened = [start(user, exam)[0] for user in users]
    late = opened[-1].deadline_at + GRACE + timedelta(seconds=1)
    with at(late):
        counts = _run_concurrently(
            lambda: attempts.finalize_overdue_attempts(batch_size=2),
            lambda: attempts.finalize_overdue_attempts(batch_size=2),
        )
    assert sum(counts) == 6
    assert Result.objects.filter(exam=exam).count() == 6
    assert set(Result.objects.values_list("attempt_id", flat=True)) == {a.pk for a in opened}


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_merit_generation_racing_scoring(run):
    exam = _fresh(f"rm{run}")
    users = [make_student() for _ in range(4)]
    for user in users[:3]:
        take(user, exam, "c--")
    last, _ = start(users[3], exam)
    _run_concurrently(
        lambda: services.generate_merit(exam.pk),
        lambda: attempts.submit_attempt(users[3], last.public_id),
    )
    services.generate_merit(exam.pk)
    positions = list(selectors.ranked_results(exam).values_list("merit_position", flat=True))
    assert positions == [1, 2, 3, 4]
    assert Result.objects.filter(exam=exam, is_merit_counted=True).count() == 4


def test_error_message_in_bangla(student, subject):
    attempt = take(student, published(subject, result_visibility="manual"), "c--")
    response = jwt_client(student).get(f"{RESULTS}{attempt.public_id}/", HTTP_ACCEPT_LANGUAGE="bn")
    assert response.json()["error"]["message"] == "এই পরীক্ষার ফলাফল এখনও পাওয়া যাচ্ছে না।"


# ======================================================================================
# Percentage / numeric range
# ======================================================================================
class TestPercentageRange:
    def test_beyond_the_old_numeric_7_2_range(self, student, subject):
        # 1 mark, 2 000 penalty, all wrong: −200 000 % (old column max: ±99 999.99).
        exam = published(subject, negative_marks=Decimal("2000"))
        r = result_of(take(student, exam, "www"))
        assert r.obtained_marks == Decimal("-6000.00")
        assert r.percentage == Decimal("-200000.00")

    def test_maximum_valid_configuration(self, student, subject):
        # The most extreme valid ratio: 0.01 marks, 99 999.99 penalty.
        exam = published(subject, default_marks=Decimal("0.01"), negative_marks=Decimal("99999.99"))
        r = result_of(take(student, exam, "www"))
        assert r.obtained_marks == Decimal("-299999.97") and r.total_marks == Decimal("0.03")
        assert r.percentage == Decimal("-999999900.00")
        from apps.results.models import RESULT_VALUE_BOUND

        assert abs(r.percentage) <= RESULT_VALUE_BOUND
        mixed = make_student()
        r2 = result_of(take(mixed, exam, "cw-"))
        assert r2.percentage == Decimal("-333333266.67")  # (0.01 − 99 999.99) / 0.03 × 100

    def test_largest_totals_fit(self):
        from apps.results.models import COLUMN_LIMIT, RESULT_VALUE_BOUND

        largest = 10_000 * Decimal("99999.99")  # 10 000 questions at the maximum mark
        assert largest == RESULT_VALUE_BOUND <= COLUMN_LIMIT
        assert services.percentage_of(-largest, Decimal("0.01") * 10_000) == Decimal(
            "-999999900.00"
        )
        services.ensure_storable({"obtained_marks": -largest, "percentage": -largest})

    def test_out_of_range_is_a_controlled_error_not_a_500_crash(self, student, subject):
        from apps.results.models import COLUMN_LIMIT

        with pytest.raises(ResultError) as exc:
            services.ensure_storable({"percentage": COLUMN_LIMIT + Decimal("0.01")})
        assert exc.value.code == "result_out_of_range"
        attempt, _ = start(student, published(subject))
        huge = COLUMN_LIMIT * 10
        with mock.patch("apps.results.services.percentage_of", return_value=huge):
            response = jwt_client(student).post(
                f"/api/v1/attempts/{attempt.public_id}/submit/", {}, format="json"
            )
        assert response.status_code == 500
        assert response.json()["error"]["code"] == "result_out_of_range"
        attempt.refresh_from_db()
        assert attempt.status == "in_progress"  # nothing half-saved
        assert not Result.objects.exists()
        assert not AttemptAnswer.objects.filter(awarded_marks__isnull=False).exists()


# ======================================================================================
# Same student, concurrent merit selection
# ======================================================================================
@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("strategy", ["best_attempt", "latest_attempt", "first_attempt"])
@pytest.mark.parametrize("run", range(2))
def test_same_student_concurrent_scoring_keeps_one_counted_result(strategy, run):
    exam = _fresh(
        f"ms{strategy[:2]}{run}", exam_type="practice", merit_enabled=True, merit_strategy=strategy
    )
    student = make_student()
    first = take(student, exam, "c--")
    second = take(student, exam, "ccc")
    # Re-score both attempts at the same time (as two workers would).
    Result.objects.filter(exam=exam).delete()

    def score(attempt):
        with transaction.atomic():
            locked = ExamAttempt.objects.select_for_update().get(pk=attempt.pk)
            return services.record_result(locked)

    outcomes = _run_concurrently(lambda: score(first), lambda: score(second))
    assert all(isinstance(o, Result) for o in outcomes), outcomes
    counted = list(Result.objects.filter(exam=exam, user=student, is_merit_counted=True))
    assert len(counted) == 1
    expected = {"best_attempt": second, "latest_attempt": second, "first_attempt": first}
    assert counted[0].attempt_id == expected[strategy].pk


def test_after_exam_end_message_in_bangla(subject, admin_client):
    exam = make_exam(subject, result_visibility="manual")
    response = admin_client.patch(
        f"/api/v1/admin/exams/{exam.pk}/",
        {"result_visibility": "after_exam_end"},
        format="json",
        HTTP_ACCEPT_LANGUAGE="bn",
    )
    assert response.json()["error"]["field_errors"]["end_at"] == [
        "পরীক্ষা শেষ হওয়ার পর ফলাফল দেখাতে হলে শেষ সময় দিতে হবে। শেষ সময় দিন অথবা অন্য "
        "ফলাফল প্রদর্শনের নিয়ম বেছে নিন।"
    ]


# ======================================================================================
# Admin results list — Milestone 7D contract extension
# ======================================================================================
ADMIN_RESULTS = "/api/v1/admin/results/"
ADMIN_RESULT_FIELDS = {
    "attempt_id",
    "attempt_no",
    "exam_id",
    "exam_title_bn",
    "exam_title_en",
    "user_id",
    "user_full_name",
    "status",
    "submit_source",
    "submitted_at",
    "correct_count",
    "wrong_count",
    "unanswered_count",
    "obtained_marks",
    "total_marks",
    "percentage",
    "is_passed",
    "time_used_seconds",
    "is_merit_counted",
    "merit_position",
}


class TestAdminResultList:
    @pytest.fixture
    def board(self, subject):
        """Exam A (pass mark 2): Karim 3/3, Rahima 1/3, Jamal 2/3, submitted in that order,
        merit generated. Exam B (no pass mark, no merit): one result."""
        exam_a = published(
            subject, title_en="Physics Final", title_bn="পদার্থবিজ্ঞান ফাইনাল", pass_marks=Decimal("2")
        )
        exam_b = published(subject, title_en="Chemistry Quiz", title_bn="রসায়ন কুইজ")
        karim = make_student(full_name="Karim Uddin")
        rahima = make_student(full_name="Rahima Begum")
        jamal = make_student(full_name="Jamal Khan")
        attempts_by_name = {
            "karim": take(karim, exam_a, "ccc"),
            "rahima": take(rahima, exam_a, "c--"),
            "jamal": take(jamal, exam_a, "cc-"),
            "other": take(karim, exam_b, "c--"),
        }
        services.generate_merit(exam_a.pk)
        return exam_a, exam_b, attempts_by_name

    def names(self, response):
        assert response.status_code == 200, response.content
        return [row["user_full_name"] for row in response.json()["results"]]

    def test_rows_carry_bilingual_exam_titles_and_nothing_else(self, admin_client, board):
        exam_a, exam_b, _ = board
        body = admin_client.get(ADMIN_RESULTS).json()
        assert body["count"] == 4
        for row in body["results"]:
            assert set(row) == ADMIN_RESULT_FIELDS
        titles = {(r["exam_id"], r["exam_title_en"], r["exam_title_bn"]) for r in body["results"]}
        assert titles == {
            (exam_a.pk, "Physics Final", "পদার্থবিজ্ঞান ফাইনাল"),
            (exam_b.pk, "Chemistry Quiz", "রসায়ন কুইজ"),
        }
        text = json_text(body)
        for leak in ("is_correct", "options", "explanation", "selected_option", "answers"):
            assert leak not in text

    def test_attempt_filter_returns_exactly_that_result(self, admin_client, board):
        _, _, by_name = board
        rows = admin_client.get(f"{ADMIN_RESULTS}?attempt={by_name['jamal'].public_id}").json()
        assert rows["count"] == 1
        assert rows["results"][0]["attempt_id"] == str(by_name["jamal"].public_id)
        assert rows["results"][0]["user_full_name"] == "Jamal Khan"
        unknown = admin_client.get(f"{ADMIN_RESULTS}?attempt=00000000-0000-4000-8000-000000000000")
        assert unknown.status_code == 200 and unknown.json()["count"] == 0
        invalid = admin_client.get(f"{ADMIN_RESULTS}?attempt=not-a-uuid")
        assert invalid.status_code == 400
        assert invalid.json()["error"]["field_errors"] == {"attempt": ["Enter a valid ID."]}

    def test_pass_fail_filter(self, admin_client, board):
        exam_a, _, _ = board
        base = f"{ADMIN_RESULTS}?exam={exam_a.pk}&ordering=submitted_at"
        assert self.names(admin_client.get(f"{base}&is_passed=true")) == [
            "Karim Uddin",
            "Jamal Khan",
        ]
        assert self.names(admin_client.get(f"{base}&is_passed=false")) == ["Rahima Begum"]
        # No pass mark → is_passed is null: neither passed nor failed.
        assert admin_client.get(f"{ADMIN_RESULTS}?is_passed=true").json()["count"] == 2
        assert admin_client.get(f"{ADMIN_RESULTS}?is_passed=false").json()["count"] == 1
        assert admin_client.get(f"{ADMIN_RESULTS}?is_passed=maybe").status_code == 400

    def test_student_name_search(self, admin_client, board):
        assert self.names(admin_client.get(f"{ADMIN_RESULTS}?search=rahima")) == ["Rahima Begum"]
        assert sorted(self.names(admin_client.get(f"{ADMIN_RESULTS}?search=  KARIM "))) == [
            "Karim Uddin",
            "Karim Uddin",
        ]
        assert admin_client.get(f"{ADMIN_RESULTS}?search=nobody").json()["count"] == 0
        assert admin_client.get(f"{ADMIN_RESULTS}?search={'x' * 101}").status_code == 400

    def test_ordering(self, admin_client, board):
        exam_a, _, _ = board
        base = f"{ADMIN_RESULTS}?exam={exam_a.pk}&ordering="
        submitted = ["Karim Uddin", "Rahima Begum", "Jamal Khan"]
        assert self.names(admin_client.get(base + "submitted_at")) == submitted
        assert self.names(admin_client.get(base + "-submitted_at")) == submitted[::-1]
        by_score = ["Rahima Begum", "Jamal Khan", "Karim Uddin"]
        assert self.names(admin_client.get(base + "percentage")) == by_score
        assert self.names(admin_client.get(base + "-percentage")) == by_score[::-1]
        ranked = ["Karim Uddin", "Jamal Khan", "Rahima Begum"]
        assert self.names(admin_client.get(base + "merit_position")) == ranked
        assert self.names(admin_client.get(base + "-merit_position")) == ranked[::-1]

    def test_unranked_results_sort_after_ranked_ones(self, admin_client, board):
        _, exam_b, _ = board
        rows = admin_client.get(f"{ADMIN_RESULTS}?ordering=merit_position").json()["results"]
        assert [r["merit_position"] for r in rows] == [1, 2, 3, None]
        assert rows[-1]["exam_id"] == exam_b.pk

    def test_unknown_ordering_is_rejected(self, admin_client, board):
        for value in ("obtained_marks", "user__password", "-id,percentage"):
            response = admin_client.get(f"{ADMIN_RESULTS}?ordering={value}")
            assert response.status_code == 400
            assert response.json()["error"]["field_errors"] == {
                "ordering": ["Unknown ordering field."]
            }

    def test_default_order_and_existing_filters_unchanged(self, admin_client, board):
        exam_a, exam_b, by_name = board
        rows = admin_client.get(ADMIN_RESULTS).json()["results"]
        assert [(r["exam_id"], r["merit_position"]) for r in rows] == sorted(
            [(r["exam_id"], r["merit_position"]) for r in rows],
            key=lambda pair: (pair[0], pair[1] is None, pair[1] or 0),
        )
        assert self.names(admin_client.get(f"{ADMIN_RESULTS}?exam={exam_b.pk}")) == ["Karim Uddin"]
        karim_id = by_name["karim"].user_id
        assert admin_client.get(f"{ADMIN_RESULTS}?user={karim_id}").json()["count"] == 2
        for flag in (True, False):
            rows = admin_client.get(f"{ADMIN_RESULTS}?merit_counted={str(flag).lower()}").json()
            assert rows["count"] == Result.objects.filter(is_merit_counted=flag).count()
            assert all(row["is_merit_counted"] is flag for row in rows["results"])
        both = admin_client.get(f"{ADMIN_RESULTS}?exam={exam_a.pk}&search=khan&is_passed=true")
        assert self.names(both) == ["Jamal Khan"]

    def test_pagination(self, admin_client, board):
        first = admin_client.get(f"{ADMIN_RESULTS}?page_size=3&ordering=submitted_at").json()
        assert first["count"] == 4 and len(first["results"]) == 3 and first["next"]
        second = admin_client.get(f"{ADMIN_RESULTS}?page_size=3&ordering=submitted_at&page=2")
        assert len(second.json()["results"]) == 1

    def test_query_count_does_not_grow_with_rows(self, admin_client, board):
        with CaptureQueriesContext(connection) as one:
            assert admin_client.get(f"{ADMIN_RESULTS}?page_size=1").status_code == 200
        with CaptureQueriesContext(connection) as four:
            assert admin_client.get(f"{ADMIN_RESULTS}?page_size=4").status_code == 200
        assert len(four.captured_queries) == len(one.captured_queries)

    def test_still_admin_only(self, board, student):
        assert APIClient().get(ADMIN_RESULTS).status_code == 401
        assert jwt_client(student).get(ADMIN_RESULTS).status_code == 401
        session = APIClient()
        session.force_login(student)
        assert session.get(ADMIN_RESULTS).status_code == 403


def json_text(body) -> str:
    import json

    return json.dumps(body)


class TestAdminExamResultsVisible:
    """``results_visible`` on the admin exam = the results app's own rule, evaluated now."""

    def visible(self, admin_client, exam):
        detail = admin_client.get(f"/api/v1/admin/exams/{exam.pk}/").json()["results_visible"]
        listed = admin_client.get(f"/api/v1/admin/exams/?search={exam.title_en}").json()
        assert [row["results_visible"] for row in listed["results"]] == [detail]
        return detail

    def test_immediate(self, admin_client, subject):
        assert self.visible(admin_client, published(subject, title_en="Immediate")) is True

    def test_after_exam_end(self, admin_client, subject):
        now = timezone.now()
        exam = published(
            subject,
            title_en="After end",
            result_visibility="after_exam_end",
            end_at=now + timedelta(hours=1),
        )
        assert self.visible(admin_client, exam) is False  # before the end
        type(exam).objects.filter(pk=exam.pk).update(end_at=now - timedelta(minutes=1))
        assert self.visible(admin_client, exam) is True  # after the end

    def test_manual_hidden_then_published_then_hidden(self, admin_client, subject):
        exam = published(subject, title_en="Manual", result_visibility="manual")
        assert self.visible(admin_client, exam) is False
        published_now = admin_client.post(f"/api/v1/admin/exams/{exam.pk}/results/publish/")
        assert published_now.json()["results_visible"] is True
        assert self.visible(admin_client, exam) is True
        hidden = admin_client.post(f"/api/v1/admin/exams/{exam.pk}/results/hide/")
        assert hidden.json()["results_visible"] is False

    def test_matches_the_results_rule_and_is_read_only(self, admin_client, subject):
        exam = published(subject, title_en="Read only", result_visibility="manual")
        exam_services.unpublish_exam(exam.pk, ctx=exam_services_ctx())
        response = admin_client.patch(
            f"/api/v1/admin/exams/{exam.pk}/", {"results_visible": True}, format="json"
        )
        assert response.status_code == 200
        exam.refresh_from_db()
        assert response.json()["results_visible"] is False
        assert response.json()["results_visible"] == selectors.results_visible(exam, timezone.now())
