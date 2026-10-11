"""Milestone 4B: exam engine — start/resume, answers, submit, finalize, locks."""

import threading
import uuid
from contextlib import contextmanager
from datetime import timedelta
from decimal import Decimal
from unittest import mock

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.http import Http404
from django.utils import timezone
from rest_framework.test import APIClient

from apps.attempts import selectors, services
from apps.attempts.exceptions import AttemptError
from apps.attempts.models import AttemptAnswer, AttemptStatus, ExamAttempt
from apps.attempts.tasks import finalize_overdue_attempts_task
from apps.exams import services as exam_services
from apps.exams.exceptions import ExamStateError
from apps.exams.models import Exam, ExamQuestion
from apps.questions import locks as question_locks
from apps.questions.models import QuestionOption
from apps.subscriptions import services as subscription_services
from tests.test_exams import make_category, make_exam, make_question, make_subject
from tests.test_subscriptions import grant, jwt_client, make_package, make_student

pytestmark = pytest.mark.django_db

SECRET = "SECRET-EXPLANATION"
GRACE = timedelta(seconds=30)


# --------------------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def _media(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "media")
    settings.ATTEMPT_SUBMIT_GRACE_SECONDS = 30


@pytest.fixture
def subject():
    return make_subject()


@pytest.fixture
def student():
    return make_student()


def questions(subject, n=3, **fields):
    fields.setdefault("explanation_en", SECRET)
    return [make_question(subject, **fields) for _ in range(n)]


def published(subject, /, n=3, **extra):
    return make_exam(
        subject, questions=questions(subject, n), publish=True, total_questions=n, **extra
    )


def start(user, exam, **kwargs):
    return services.start_attempt(user, exam.pk, **kwargs)


@contextmanager
def at(moment):
    """Freeze the engine's server clock at ``moment``."""
    with mock.patch("apps.attempts.services._now", return_value=moment):
        yield


_KEEP = object()


def item(question_id, option_id=_KEEP, when=None, **extra):
    """One answer change; ``option_id=None`` clears, omitted keeps the stored answer."""
    data = {"question_id": question_id, "client_saved_at": when or timezone.now(), **extra}
    if option_id is not _KEEP:
        data["selected_option_id"] = option_id
    return data


def answers_of(attempt):
    return list(attempt.answers.order_by("display_order"))


def code(response):
    return response.json()["error"]["code"]


def walk(value):
    """Every key anywhere in a JSON value."""
    if isinstance(value, dict):
        for key, inner in value.items():
            yield key
            yield from walk(inner)
    elif isinstance(value, list):
        for inner in value:
            yield from walk(inner)


def correct_option_id(question_id):
    return QuestionOption.objects.get(question_id=question_id, is_correct=True).pk


def wrong_option_id(question_id):
    return QuestionOption.objects.filter(question_id=question_id, is_correct=False).first().pk


def start_url(exam):
    return f"/api/v1/exams/{exam.slug}/attempts/"


def url(attempt, suffix=""):
    return f"/api/v1/attempts/{attempt.public_id}/{suffix}"


# ======================================================================================
# Database
# ======================================================================================
class TestDatabase:
    @pytest.mark.parametrize(
        "sql",
        [
            "UPDATE attempts_examattempt SET deadline_at = started_at",
            "UPDATE attempts_examattempt SET attempt_no = 0",
            "UPDATE attempts_examattempt SET status = 'paused'",
            "UPDATE attempts_examattempt SET submitted_at = now()",
            "UPDATE attempts_examattempt SET status = 'submitted'",
            "UPDATE attempts_examattempt SET status = 'auto_submitted', submitted_at = now(),"
            " submit_source = 'manual'",
            "UPDATE attempts_examattempt SET content_language = 'both'",
            "UPDATE attempts_attemptanswer SET marks = 0",
            "UPDATE attempts_attemptanswer SET negative_marks = -1",
            "UPDATE attempts_attemptanswer SET display_order = 0",
        ],
    )
    def test_raw_invalid_data_rejected(self, student, subject, sql):
        start(student, published(subject))
        with pytest.raises(IntegrityError), transaction.atomic(), connection.cursor() as cur:
            cur.execute(sql)

    def test_one_open_attempt_and_unique_numbers(self, student, subject):
        exam = published(subject, exam_type="practice")
        attempt, _ = start(student, exam)
        fields = {
            "exam": exam,
            "user": student,
            "started_at": attempt.started_at,
            "deadline_at": attempt.deadline_at,
            "content_language": "bn",
        }
        with pytest.raises(IntegrityError), transaction.atomic():
            ExamAttempt.objects.create(attempt_no=2, **fields)  # second open attempt
        services.submit_attempt(student, attempt.public_id)
        with pytest.raises(IntegrityError), transaction.atomic():
            ExamAttempt.objects.create(attempt_no=1, **fields)  # duplicate number

    def test_answer_once_per_question(self, student, subject):
        attempt, _ = start(student, published(subject))
        first = answers_of(attempt)[0]
        with pytest.raises(IntegrityError), transaction.atomic():
            AttemptAnswer.objects.create(
                attempt=attempt,
                question_id=first.question_id,
                display_order=99,
                option_order=[],
                marks=1,
                negative_marks=0,
            )

    def test_history_is_protected(self, student, subject):
        exam = published(subject)
        attempt, _ = start(student, exam)
        from django.db.models import ProtectedError

        with pytest.raises(ProtectedError):
            student.delete()
        with pytest.raises(ProtectedError):
            answers_of(attempt)[0].question.delete()
        with pytest.raises(IntegrityError), transaction.atomic(), connection.cursor() as cur:
            cur.execute("SET CONSTRAINTS ALL IMMEDIATE")
            cur.execute("DELETE FROM exams_exam")


# ======================================================================================
# Start / resume
# ======================================================================================
class TestStart:
    def test_creates_attempt_with_snapshots(self, student, subject):
        qs = questions(subject)
        exam = make_exam(
            subject,
            questions=qs,
            total_questions=3,
            default_marks=Decimal("2.00"),
            negative_marks=Decimal("0.25"),
        )
        ExamQuestion.objects.filter(exam=exam, question=qs[1]).update(marks=Decimal("5.00"))
        exam_services.publish_exam(exam.pk, ctx=exam_services_ctx())
        before = timezone.now()
        attempt, created = start(student, exam)
        assert created and attempt.attempt_no == 1 and attempt.status == "in_progress"
        assert before <= attempt.started_at <= timezone.now()
        assert attempt.deadline_at == attempt.started_at + timedelta(minutes=30)
        rows = answers_of(attempt)
        assert [r.question_id for r in rows] == [q.pk for q in qs]  # not shuffled
        assert [r.marks for r in rows] == [Decimal("2.00"), Decimal("5.00"), Decimal("2.00")]
        assert {r.negative_marks for r in rows} == {Decimal("0.25")}
        for row in rows:
            expected = list(
                QuestionOption.objects.filter(question_id=row.question_id)
                .order_by("sort_order", "id")
                .values_list("id", flat=True)
            )
            assert row.option_order == expected
            assert row.selected_option_id is None and row.is_correct is None
            assert row.awarded_marks is None

    def test_resume_returns_the_same_attempt(self, student, subject):
        exam = published(subject, shuffle_questions=True, shuffle_options=True)
        first, created = start(student, exam)
        snapshot = [(a.question_id, a.option_order) for a in answers_of(first)]
        later = first.started_at + timedelta(minutes=5)
        with at(later):
            again, created_again = start(student, exam)
        assert created and not created_again and again.pk == first.pk
        assert again.deadline_at == first.deadline_at
        assert [(a.question_id, a.option_order) for a in answers_of(again)] == snapshot
        assert ExamAttempt.objects.count() == 1

    @pytest.mark.parametrize("language", ["bn", "en", "both"])
    def test_attempt_language(self, student, subject, language):
        exam = published(subject, content_language=language)
        attempt, _ = start(student, exam, language="en")
        assert attempt.content_language == ("en" if language in ("en", "both") else "bn")

    def test_unavailable_exams_are_not_found(self, student, subject):
        draft = make_exam(subject, questions=questions(subject), total_questions=3)
        with pytest.raises(Http404):
            start(student, draft)
        exam = published(subject)
        exam_services.unpublish_exam(exam.pk, ctx=exam_services_ctx())
        with pytest.raises(Http404):
            start(student, exam)
        other = published(subject)
        subject.category.is_active = False
        subject.category.save()
        with pytest.raises(Http404):
            start(student, other)
        assert not ExamAttempt.objects.exists()

    def test_paid_exam_needs_access(self, student, subject):
        exam = published(subject, access_type="paid")
        with pytest.raises(AttemptError) as exc:
            start(student, exam)
        assert (exc.value.code, exc.value.status) == ("needs_subscription", 403)
        grant(student, make_package(rules=[{"rule_type": "exam", "exam": exam.pk}]))
        assert start(student, exam)[1]

    def test_free_exam_needs_no_subscription(self, student, subject):
        assert start(student, published(subject, access_type="free"))[1]


def exam_services_ctx():
    from apps.audit.services import AuditContext

    return AuditContext()


# ======================================================================================
# Schedule and deadlines
# ======================================================================================
class TestTiming:
    def _scheduled(self, subject, start_in, length, duration=30, **extra):
        now = timezone.now()
        return published(
            subject,
            start_at=now + start_in,
            end_at=now + start_in + length,
            duration_minutes=duration,
            **extra,
        )

    def test_start_window_boundaries(self, student, subject):
        exam = self._scheduled(subject, timedelta(hours=1), timedelta(hours=2))
        tick = timedelta(microseconds=1)
        with at(exam.start_at - tick), pytest.raises(AttemptError) as exc:
            start(student, exam)
        assert exc.value.code == "exam_not_started"
        assert exc.value.details["start_at"] == exam.start_at.isoformat()
        with at(exam.end_at), pytest.raises(AttemptError) as exc:
            start(student, exam)
        assert exc.value.code == "exam_ended"
        with at(exam.start_at):
            attempt, _ = start(student, exam)
        assert attempt.started_at == exam.start_at
        assert attempt.deadline_at == exam.start_at + timedelta(minutes=30)

    def test_one_microsecond_before_end_gets_only_the_rest(self, student, subject):
        exam = self._scheduled(subject, timedelta(hours=1), timedelta(hours=2), exam_type="live")
        moment = exam.end_at - timedelta(microseconds=1)
        with at(moment):
            attempt, _ = start(student, exam)
        assert attempt.deadline_at == exam.end_at

    def test_live_late_joiner_gets_remaining_window(self, student, subject):
        exam = self._scheduled(
            subject, timedelta(hours=1), timedelta(minutes=60), duration=45, exam_type="live"
        )
        on_time = make_student()
        with at(exam.start_at):
            early, _ = start(on_time, exam)
        with at(exam.start_at + timedelta(minutes=40)):
            late, _ = start(student, exam)
        assert early.deadline_at == exam.start_at + timedelta(minutes=45)  # duration first
        assert late.deadline_at == exam.end_at  # only 20 minutes left
        assert late.deadline_at - late.started_at == timedelta(minutes=20)

    def test_duration_boundary(self, student, subject):
        attempt, _ = start(student, published(subject))
        tick = timedelta(microseconds=1)
        assert selectors.can_edit(attempt, attempt.deadline_at - tick)
        assert not selectors.can_edit(attempt, attempt.deadline_at)
        assert selectors.can_submit(attempt, attempt.deadline_at + GRACE)
        assert not selectors.can_submit(attempt, attempt.deadline_at + GRACE + tick)
        assert not selectors.is_overdue(attempt, attempt.deadline_at + GRACE)
        assert selectors.is_overdue(attempt, attempt.deadline_at + GRACE + tick)

    def test_client_clock_never_affects_timing(self, student, subject):
        exam = published(subject)
        client = jwt_client(student)
        response = client.post(
            start_url(exam), {"client_info": {"platform": "android"}}, format="json"
        )
        assert response.status_code == 201
        attempt = ExamAttempt.objects.get()
        question = answers_of(attempt)[0].question_id
        option = wrong_option_id(question)
        for client_time in ("2099-01-01T00:00:00Z", "2000-01-01T00:00:00Z"):
            saved = client.put(
                url(attempt, f"answers/{question}/"),
                {"selected_option_id": option, "client_saved_at": client_time},
                format="json",
                HTTP_DATE=client_time,
            )
            assert saved.status_code == 200
        attempt.refresh_from_db()
        assert attempt.deadline_at == attempt.started_at + timedelta(minutes=30)
        with at(attempt.deadline_at):
            with pytest.raises(AttemptError) as exc:
                services.save_answers(
                    student, attempt.public_id, [item(question, option, when=attempt.started_at)]
                )
        assert exc.value.code == "attempt_deadline_passed"


# ======================================================================================
# Retakes
# ======================================================================================
class TestRetakes:
    def _finish(self, user, exam):
        attempt, _ = start(user, exam)
        services.submit_attempt(user, attempt.public_id)
        return attempt

    def test_no_retake(self, student, subject):
        exam = published(subject)  # regular: no retake, 1 attempt
        self._finish(student, exam)
        with pytest.raises(AttemptError) as exc:
            start(student, exam)
        assert (exc.value.code, exc.value.status) == ("retake_not_allowed", 422)

    def test_live_always_one(self, student, subject):
        now = timezone.now()
        exam = published(
            subject,
            exam_type="live",
            start_at=now - timedelta(minutes=1),
            end_at=now + timedelta(hours=2),
        )
        self._finish(student, exam)
        with pytest.raises(AttemptError) as exc:
            start(student, exam)
        assert exc.value.code == "retake_not_allowed"

    def test_exact_max_attempts(self, student, subject):
        exam = published(subject, allow_retake=True, max_attempts=2)
        assert [self._finish(student, exam).attempt_no for _ in range(2)] == [1, 2]
        with pytest.raises(AttemptError) as exc:
            start(student, exam)
        assert exc.value.code == "attempt_limit_reached"
        assert exc.value.details == {"max_attempts": 2}

    def test_unlimited_practice(self, student, subject):
        exam = published(subject, exam_type="practice")
        assert [self._finish(student, exam).attempt_no for _ in range(4)] == [1, 2, 3, 4]

    def test_open_attempt_is_resumed_not_duplicated(self, student, subject):
        exam = published(subject, exam_type="practice")
        first, _ = start(student, exam)
        again, created = start(student, exam)
        assert not created and again.pk == first.pk

    def test_overdue_open_attempt_is_finalized_before_a_retake(self, student, subject):
        exam = published(subject, exam_type="practice")
        first, _ = start(student, exam)
        with at(first.deadline_at + GRACE + timedelta(seconds=1)):
            second, created = start(student, exam)
        first.refresh_from_db()
        assert created and second.attempt_no == 2
        assert (first.status, first.submit_source) == ("auto_submitted", "server_auto")

    def test_other_students_and_exams_are_counted_separately(self, student, subject):
        exam, other_exam = published(subject), published(subject)
        self._finish(make_student(), exam)
        self._finish(student, other_exam)
        assert start(student, exam)[0].attempt_no == 1


# ======================================================================================
# Shuffle
# ======================================================================================
class TestShuffle:
    def test_orders_are_persisted_and_reused(self, student, subject):
        exam = published(subject, n=5, shuffle_questions=True, shuffle_options=True)
        reverse = lambda items: items.reverse()  # noqa: E731 — deterministic "shuffle"
        with mock.patch.object(services._random, "shuffle", side_effect=reverse):
            attempt, _ = start(student, exam)
        rows = answers_of(attempt)
        assigned = list(
            ExamQuestion.objects.filter(exam=exam)
            .order_by("sort_order")
            .values_list("question_id", flat=True)
        )
        assert [r.question_id for r in rows] == list(reversed(assigned))
        for row in rows:
            natural = list(
                QuestionOption.objects.filter(question_id=row.question_id)
                .order_by("sort_order", "id")
                .values_list("id", flat=True)
            )
            assert row.option_order == list(reversed(natural))
        payload = jwt_client(student).get(url(attempt)).json()
        assert [q["question_id"] for q in payload["questions"]] == [r.question_id for r in rows]
        assert [o["id"] for o in payload["questions"][0]["options"]] == rows[0].option_order
        assert [q["number"] for q in payload["questions"]] == [1, 2, 3, 4, 5]

    def test_real_shuffle_uses_system_randomness_once(self, student, subject):
        exam = published(subject, n=6, exam_type="practice", shuffle_questions=True)
        orders = set()
        for _ in range(8):
            attempt, _ = start(student, exam)
            orders.add(tuple(a.question_id for a in answers_of(attempt)))
            again, _ = start(student, exam)  # resume: same order
            assert tuple(a.question_id for a in answers_of(again)) in orders
            services.submit_attempt(student, attempt.public_id)
        assert len(orders) > 1  # 8 random permutations of 6 are (practically) never equal
        assert isinstance(services._random, __import__("random").SystemRandom)


# ======================================================================================
# Payload / leak surface
# ======================================================================================
class TestPayload:
    def test_room_payload_is_safe(self, student, subject):
        exam = published(subject, content_language="both")
        response = jwt_client(student).post(start_url(exam), {}, format="json")
        assert response.status_code == 201
        body = response.json()
        keys = set(walk(body))
        for forbidden in (
            "is_correct",
            "explanation",
            "explanation_en",
            "explanation_bn",
            "awarded_marks",
            "correct_option",
            "user",
            "user_id",
            "created_by",
        ):
            assert forbidden not in keys
        assert SECRET not in response.content.decode()
        assert set(body) == {
            "attempt_id",
            "attempt_no",
            "status",
            "server_time",
            "started_at",
            "deadline_at",
            "remaining_seconds",
            "can_edit",
            "can_submit",
            "submitted_at",
            "submit_source",
            "content_language",
            "exam",
            "questions",
        }
        assert set(body["exam"]) == {
            "slug",
            "title",
            "instructions",
            "exam_type",
            "content_language",
            "duration_minutes",
            "total_questions",
            "negative_marks",
        }
        question = body["questions"][0]
        assert set(question) == {
            "question_id",
            "number",
            "text",
            "text_bn",
            "text_en",
            "image",
            "marks",
            "options",
            "selected_option_id",
            "is_marked_for_review",
        }
        assert set(question["options"][0]) == {"id", "text", "text_bn", "text_en"}
        assert body["remaining_seconds"] > 29 * 60 and body["can_edit"] is True

    def test_single_language_payload_has_no_pairs(self, student, subject):
        exam = published(subject, content_language="bn")
        body = jwt_client(student).post(start_url(exam), {}, format="json").json()
        assert "text_en" not in body["questions"][0]
        assert "text_en" not in body["questions"][0]["options"][0]

    def test_resume_payload_keeps_saved_state(self, student, subject):
        exam = published(subject)
        attempt, _ = start(student, exam)
        first = answers_of(attempt)[0]
        option = wrong_option_id(first.question_id)
        services.save_answers(
            student, attempt.public_id, [item(first.question_id, option, is_marked_for_review=True)]
        )
        body = jwt_client(student).get(url(attempt)).json()
        assert body["questions"][0]["selected_option_id"] == option
        assert body["questions"][0]["is_marked_for_review"] is True

    def test_history_lists_only_own_attempts(self, student, subject):
        exam = published(subject, exam_type="practice")
        mine, _ = start(student, exam)
        start(make_student(), exam)
        body = jwt_client(student).get("/api/v1/attempts/").json()
        assert [row["attempt_id"] for row in body["results"]] == [str(mine.public_id)]
        assert body["results"][0]["exam"]["slug"] == exam.slug
        assert set(body["results"][0]["exam"]) == {"slug", "title"}


# ======================================================================================
# Saves and batch sync
# ======================================================================================
class TestSave:
    def test_single_save_clear_and_mark(self, student, subject):
        attempt, _ = start(student, published(subject))
        question = answers_of(attempt)[0].question_id
        option = wrong_option_id(question)
        client = jwt_client(student)
        when = timezone.now()
        response = client.put(
            url(attempt, f"answers/{question}/"),
            {"selected_option_id": option, "client_saved_at": when.isoformat()},
            format="json",
        )
        assert response.status_code == 200, response.json()
        assert response.json()["answers"] == [
            {
                "question_id": question,
                "status": "saved",
                "selected_option_id": option,
                "is_marked_for_review": False,
            }
        ]
        row = AttemptAnswer.objects.get(attempt=attempt, question_id=question)
        assert row.selected_option_id == option and row.answered_at is not None
        assert row.client_saved_at == when and row.is_correct is None
        # Mark for review only: the answer stays.
        later = (when + timedelta(seconds=1)).isoformat()
        client.put(
            url(attempt, f"answers/{question}/"),
            {"is_marked_for_review": True, "client_saved_at": later},
            format="json",
        )
        row.refresh_from_db()
        assert row.is_marked_for_review and row.selected_option_id == option
        # Clear the answer: still marked for review.
        last = (when + timedelta(seconds=2)).isoformat()
        client.put(
            url(attempt, f"answers/{question}/"),
            {"selected_option_id": None, "client_saved_at": last},
            format="json",
        )
        row.refresh_from_db()
        assert row.selected_option_id is None and row.is_marked_for_review

    def test_invalid_question_or_option_rejected(self, student, subject):
        exam = published(subject)
        attempt, _ = start(student, exam)
        other_question = make_question(subject)
        mine = answers_of(attempt)[0].question_id
        other_option = wrong_option_id(answers_of(attempt)[1].question_id)
        client = jwt_client(student)
        now = timezone.now().isoformat()
        response = client.put(
            url(attempt, f"answers/{other_question.pk}/"),
            {"selected_option_id": None, "client_saved_at": now},
            format="json",
        )
        assert (
            response.status_code == 400
            and "question_id" in response.json()["error"]["field_errors"]
        )
        response = client.put(
            url(attempt, f"answers/{mine}/"),
            {"selected_option_id": other_option, "client_saved_at": now},
            format="json",
        )
        assert response.status_code == 400
        assert "selected_option_id" in response.json()["error"]["field_errors"]
        for body in ({"selected_option_id": 1}, {"client_saved_at": "2026-01-01T10:00:00"}):
            assert (
                client.put(url(attempt, f"answers/{mine}/"), body, format="json").status_code == 400
            )
        assert not AttemptAnswer.objects.filter(selected_option__isnull=False).exists()

    def test_stale_single_save_is_ignored(self, student, subject):
        attempt, _ = start(student, published(subject))
        question = answers_of(attempt)[0].question_id
        newer, older = wrong_option_id(question), correct_option_id(question)
        t = timezone.now()
        services.save_answers(student, attempt.public_id, [item(question, newer, when=t)])
        _, results = services.save_answers(
            student, attempt.public_id, [item(question, older, when=t - timedelta(seconds=5))]
        )
        assert results == [{"question_id": question, "status": "stale"}]
        row = AttemptAnswer.objects.get(attempt=attempt, question_id=question)
        assert row.selected_option_id == newer and row.client_saved_at == t
        # The same device time again is a retry of the same change: applied (idempotent).
        _, results = services.save_answers(
            student, attempt.public_id, [item(question, newer, when=t)]
        )
        assert results[0]["status"] == "saved"

    def test_batch_sync(self, student, subject):
        attempt, _ = start(student, published(subject))
        rows = answers_of(attempt)
        t = timezone.now()
        services.save_answers(
            student,
            attempt.public_id,
            [item(rows[2].question_id, wrong_option_id(rows[2].question_id), when=t)],
        )
        batch = [
            {
                "question_id": rows[0].question_id,
                "selected_option_id": wrong_option_id(rows[0].question_id),
                "client_saved_at": (t - timedelta(seconds=30)).isoformat(),
            },
            {
                "question_id": rows[1].question_id,
                "is_marked_for_review": True,
                "client_saved_at": (t - timedelta(seconds=20)).isoformat(),
            },
            {
                "question_id": rows[2].question_id,
                "selected_option_id": None,
                "client_saved_at": (t - timedelta(seconds=10)).isoformat(),
            },  # older → stale
        ]
        response = jwt_client(student).put(
            url(attempt, "answers/"), {"answers": batch}, format="json"
        )
        assert response.status_code == 200, response.json()
        assert [a["status"] for a in response.json()["answers"]] == ["saved", "saved", "stale"]
        rows = answers_of(attempt)
        assert rows[0].selected_option_id is not None and rows[1].is_marked_for_review
        assert rows[2].selected_option_id is not None  # the newer answer survived

    def test_invalid_batch_changes_nothing(self, student, subject):
        attempt, _ = start(student, published(subject))
        rows = answers_of(attempt)
        now = timezone.now().isoformat()
        good = {
            "question_id": rows[0].question_id,
            "selected_option_id": wrong_option_id(rows[0].question_id),
            "client_saved_at": now,
        }
        client = jwt_client(student)
        for bad in (
            [good, {**good, "selected_option_id": wrong_option_id(rows[1].question_id)}],
            [good, {**good}],  # duplicate question
            [good, {"question_id": 999999, "client_saved_at": now}],
        ):
            response = client.put(url(attempt, "answers/"), {"answers": bad}, format="json")
            assert response.status_code == 400
        assert (
            client.put(url(attempt, "answers/"), {"answers": []}, format="json").status_code == 400
        )
        assert not AttemptAnswer.objects.filter(selected_option__isnull=False).exists()

    def test_saves_rejected_when_not_editable(self, student, subject):
        exam = published(subject)
        attempt, _ = start(student, exam)
        question = answers_of(attempt)[0].question_id
        option = wrong_option_id(question)
        with at(attempt.deadline_at), pytest.raises(AttemptError) as exc:
            services.save_answers(student, attempt.public_id, [item(question, option)])
        assert (exc.value.code, exc.value.status) == ("attempt_deadline_passed", 410)
        with at(attempt.deadline_at + timedelta(seconds=5)), pytest.raises(AttemptError):
            services.save_answers(
                student, attempt.public_id, [item(question, option)]
            )  # grace ≠ editing
        services.submit_attempt(student, attempt.public_id)
        with pytest.raises(AttemptError) as exc:
            services.save_answers(student, attempt.public_id, [item(question, option)])
        assert (exc.value.code, exc.value.status) == ("attempt_not_in_progress", 409)
        assert not AttemptAnswer.objects.filter(selected_option__isnull=False).exists()

    def test_lost_access_blocks_saves_and_submit(self, student, subject):
        exam = published(subject, access_type="paid")
        result = grant(student, make_package(rules=[{"rule_type": "exam", "exam": exam.pk}]))
        attempt, _ = start(student, exam)
        question = answers_of(attempt)[0].question_id
        option = wrong_option_id(question)
        services.save_answers(student, attempt.public_id, [item(question, option)])
        subscription_services.cancel_subscription(result.subscription.pk, ctx=exam_services_ctx())
        with pytest.raises(AttemptError) as exc:
            services.save_answers(student, attempt.public_id, [item(question, None)])
        assert (exc.value.code, exc.value.status) == ("needs_subscription", 403)
        with pytest.raises(AttemptError):
            services.submit_attempt(student, attempt.public_id)
        attempt.refresh_from_db()
        assert attempt.status == "in_progress"
        # The saved answer is kept; the server finalizes the attempt after the deadline.
        with at(attempt.deadline_at + GRACE + timedelta(seconds=1)):
            assert services.finalize_overdue_attempts() == 1
        attempt.refresh_from_db()
        assert attempt.status == "auto_submitted"
        assert (
            AttemptAnswer.objects.get(attempt=attempt, question_id=question).selected_option_id
            == option
        )


# ======================================================================================
# Submit
# ======================================================================================
class TestSubmit:
    def test_manual_submit_is_idempotent(self, student, subject):
        attempt, _ = start(student, published(subject))
        client = jwt_client(student)
        first = client.post(url(attempt, "submit/"), {}, format="json", HTTP_IDEMPOTENCY_KEY="k-1")
        assert first.status_code == 200, first.json()
        body = first.json()
        assert body["status"] == "submitted" and body["submit_source"] == "manual"
        assert body["result_available"] is False and body["result"] is None
        attempt.refresh_from_db()
        assert attempt.idempotency_key == "k-1" and attempt.submitted_at is not None
        again = client.post(url(attempt, "submit/"), {}, format="json", HTTP_IDEMPOTENCY_KEY="k-1")
        assert again.status_code == 200 and again.json()["submitted_at"] == body["submitted_at"]
        other_key = client.post(
            url(attempt, "submit/"), {"source": "client_timeout"}, format="json"
        )
        assert other_key.json()["submit_source"] == "manual"  # never changes again

    def test_submit_with_final_answers(self, student, subject):
        attempt, _ = start(student, published(subject))
        rows = answers_of(attempt)
        option = wrong_option_id(rows[0].question_id)
        response = jwt_client(student).post(
            url(attempt, "submit/"),
            {
                "source": "client_timeout",
                "answers": [
                    {
                        "question_id": rows[0].question_id,
                        "selected_option_id": option,
                        "client_saved_at": timezone.now().isoformat(),
                    }
                ],
            },
            format="json",
        )
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "submitted" and body["submit_source"] == "client_timeout"
        assert body["answers"][0]["status"] == "saved"
        assert AttemptAnswer.objects.get(pk=rows[0].pk).selected_option_id == option

    def test_submit_in_grace_does_not_apply_late_answers(self, student, subject):
        attempt, _ = start(student, published(subject))
        question = answers_of(attempt)[0].question_id
        with at(attempt.deadline_at + GRACE):
            attempt, results = services.submit_attempt(
                student, attempt.public_id, items=[item(question, wrong_option_id(question))]
            )
        assert attempt.status == "submitted"
        assert results == [{"question_id": question, "status": "deadline_passed"}]
        assert not AttemptAnswer.objects.filter(selected_option__isnull=False).exists()

    def test_submit_after_grace_is_finalized_by_server(self, student, subject):
        attempt, _ = start(student, published(subject))
        with at(attempt.deadline_at + GRACE + timedelta(microseconds=1)):
            attempt, _ = services.submit_attempt(student, attempt.public_id)
        assert (attempt.status, attempt.submit_source) == ("auto_submitted", "server_auto")

    def test_submit_after_unpublish_still_works(self, student, subject):
        exam = published(subject)
        attempt, _ = start(student, exam)
        exam_services.unpublish_exam(exam.pk, ctx=exam_services_ctx())
        response = jwt_client(student).post(url(attempt, "submit/"), {}, format="json")
        assert response.status_code == 200 and response.json()["status"] == "submitted"

    def test_invalid_input(self, student, subject):
        attempt, _ = start(student, published(subject))
        client = jwt_client(student)
        assert (
            client.post(
                url(attempt, "submit/"), {"source": "server_auto"}, format="json"
            ).status_code
            == 400
        )
        assert (
            client.post(
                url(attempt, "submit/"), {}, format="json", HTTP_IDEMPOTENCY_KEY="bad key!"
            ).status_code
            == 400
        )
        assert (
            client.post(
                url(attempt, "submit/"), {}, format="json", HTTP_IDEMPOTENCY_KEY="x" * 65
            ).status_code
            == 400
        )
        attempt.refresh_from_db()
        assert attempt.status == "in_progress"


# ======================================================================================
# Server finalization
# ======================================================================================
class TestFinalize:
    def test_only_overdue_attempts_are_finalized(self, subject):
        exam = published(subject, exam_type="practice")
        attempts = [start(make_student(), exam)[0] for _ in range(3)]
        deadline = attempts[0].deadline_at
        services.submit_attempt(attempts[2].user, attempts[2].public_id)
        with at(deadline + GRACE):
            assert services.finalize_overdue_attempts() == 0  # still inside grace
        with at(deadline + GRACE + timedelta(seconds=61)):
            assert services.finalize_overdue_attempts() == 2
            assert services.finalize_overdue_attempts() == 0  # idempotent
        states = {a.pk: (a.status, a.submit_source) for a in ExamAttempt.objects.all()}
        assert states[attempts[0].pk] == ("auto_submitted", "server_auto")
        assert states[attempts[2].pk] == ("submitted", "manual")

    def test_batches_are_bounded(self, subject, settings):
        exam = published(subject, exam_type="practice")
        for _ in range(5):
            start(make_student(), exam)
        later = ExamAttempt.objects.first().deadline_at + timedelta(minutes=5)
        with at(later):
            assert services.finalize_overdue_attempts(batch_size=2, max_batches=2) == 4
            assert services.finalize_overdue_attempts(batch_size=2) == 1

    def test_celery_task(self, subject, student):
        attempt, _ = start(student, published(subject))
        with at(attempt.deadline_at + timedelta(minutes=5)):
            assert finalize_overdue_attempts_task() == 1

    def test_beat_schedule_is_configured(self, settings):
        entry = settings.CELERY_BEAT_SCHEDULE["finalize-overdue-attempts"]
        assert entry["task"] == "apps.attempts.tasks.finalize_overdue_attempts_task"
        assert entry["schedule"] == 60.0


# ======================================================================================
# Locks
# ======================================================================================
class TestLocks:
    def test_exam_with_attempts_cannot_be_edited(self, student, subject):
        exam = published(subject)
        start(student, exam)
        ctx = exam_services_ctx()
        exam_services.unpublish_exam(exam.pk, ctx=ctx)
        with pytest.raises(ExamStateError) as exc:
            exam_services.update_exam(exam.pk, {"duration_minutes": 99}, ctx=ctx)
        assert exc.value.code == "exam_has_attempts"
        with pytest.raises(ExamStateError) as exc:
            exam_services.set_exam_questions(exam.pk, [], ctx=ctx)
        assert exc.value.code == "exam_has_attempts"
        # Status actions and duplicate still work; history stays.
        exam_services.publish_exam(exam.pk, ctx=ctx)
        exam_services.unpublish_exam(exam.pk, ctx=ctx)
        exam_services.archive_exam(exam.pk, ctx=ctx)
        copy = exam_services.duplicate_exam(exam.pk, ctx=ctx)
        assert copy.exam_questions.count() == 3 and ExamAttempt.objects.count() == 1

    def test_exam_edit_returns_409_via_api(self, student, subject):
        exam = published(subject)
        start(student, exam)
        exam_services.unpublish_exam(exam.pk, ctx=exam_services_ctx())
        from apps.accounts.models import Role, User

        admin = User.objects.create_user(
            "01612345670", password="Strong-Pass-2026", full_name="Ops", role=Role.ADMIN
        )
        client = APIClient()
        client.force_login(admin)
        response = client.patch(
            f"/api/v1/admin/exams/{exam.pk}/", {"duration_minutes": 50}, format="json"
        )
        assert response.status_code == 409 and code(response) == "exam_has_attempts"

    def test_question_lock_is_registered(self, student, subject):
        attempt, _ = start(student, published(subject))
        question = answers_of(attempt)[0].question
        assert selectors.question_used_by_attempt(question)
        assert selectors.question_used_by_attempt in question_locks._checks[question_locks.CONTENT]
        assert not selectors.question_used_by_attempt(make_question(subject))

    def test_exams_without_attempts_stay_editable(self, subject):
        exam = published(subject)
        exam_services.unpublish_exam(exam.pk, ctx=exam_services_ctx())
        exam_services.update_exam(exam.pk, {"duration_minutes": 45}, ctx=exam_services_ctx())


# ======================================================================================
# Permissions / IDOR
# ======================================================================================
class TestPermissions:
    def test_authentication_required(self, student, subject):
        from apps.accounts.models import Role, User

        exam = published(subject)
        attempt, _ = start(student, exam)
        admin = User.objects.create_user(
            "01612345671", password="Strong-Pass-2026", full_name="Ops", role=Role.ADMIN
        )
        session = APIClient()
        session.force_login(admin)
        inactive = make_student()
        inactive_client = jwt_client(inactive)
        inactive.is_active = False
        inactive.save(update_fields=["is_active"])
        question = answers_of(attempt)[0].question_id
        calls = [
            ("post", start_url(exam), {}),
            ("get", "/api/v1/attempts/", None),
            ("get", url(attempt), None),
            (
                "put",
                url(attempt, f"answers/{question}/"),
                {"client_saved_at": timezone.now().isoformat()},
            ),
            ("put", url(attempt, "answers/"), {"answers": []}),
            ("post", url(attempt, "submit/"), {}),
        ]
        for method, path, body in calls:
            for client in (APIClient(), session, jwt_client(admin), inactive_client):
                assert getattr(client, method)(path, body, format="json").status_code == 401

    def test_other_students_attempt_is_not_found(self, student, subject):
        exam = published(subject)
        attempt, _ = start(student, exam)
        question = answers_of(attempt)[0].question_id
        intruder = jwt_client(make_student())
        now = timezone.now().isoformat()
        assert intruder.get(url(attempt)).status_code == 404
        assert (
            intruder.put(
                url(attempt, f"answers/{question}/"),
                {"selected_option_id": None, "client_saved_at": now},
                format="json",
            ).status_code
            == 404
        )
        assert (
            intruder.put(
                url(attempt, "answers/"),
                {"answers": [{"question_id": question, "client_saved_at": now}]},
                format="json",
            ).status_code
            == 404
        )
        assert intruder.post(url(attempt, "submit/"), {}, format="json").status_code == 404
        assert intruder.get(f"/api/v1/attempts/{uuid.uuid4()}/").status_code == 404
        assert intruder.get(f"/api/v1/attempts/{attempt.pk}/").status_code == 404  # numeric id
        attempt.refresh_from_db()
        assert attempt.status == "in_progress"

    def test_unknown_or_unpublished_exam_slug(self, student, subject):
        draft = make_exam(subject, questions=questions(subject), total_questions=3)
        client = jwt_client(student)
        assert client.post(start_url(draft), {}, format="json").status_code == 404
        assert client.post("/api/v1/exams/nope/attempts/", {}, format="json").status_code == 404
        assert (
            client.post(f"/api/v1/exams/{draft.pk}/attempts/", {}, format="json").status_code == 404
        )

    def test_api_error_codes(self, student, subject):
        paid = published(subject, access_type="paid")
        response = jwt_client(student).post(start_url(paid), {}, format="json")
        assert response.status_code == 403 and code(response) == "needs_subscription"
        bad_info = jwt_client(student).post(
            start_url(published(subject)), {"client_info": {"k": "v" * 101}}, format="json"
        )
        assert bad_info.status_code == 400


# ======================================================================================
# Concurrency
# ======================================================================================
def _run_concurrently(*funcs):
    barrier = threading.Barrier(len(funcs))
    results = [None] * len(funcs)

    def runner(index, func):
        try:
            barrier.wait()
            results[index] = func()
        except Exception as exc:  # noqa: BLE001 — asserted by the tests
            results[index] = exc
        finally:
            connection.close()

    threads = [threading.Thread(target=runner, args=(i, f)) for i, f in enumerate(funcs)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    return results


def _fresh(tag, **extra):
    subject = make_subject(f"s-{tag}", category=make_category(f"c-{tag}"))
    return published(subject, **extra)


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_simultaneous_starts_create_one_attempt(run):
    exam = _fresh(f"a{run}")
    student = make_student()
    results = _run_concurrently(*[lambda: start(student, exam)] * 3)
    assert all(isinstance(r, tuple) for r in results), results
    assert sum(created for _attempt, created in results) == 1
    assert len({attempt.pk for attempt, _ in results}) == 1
    assert ExamAttempt.objects.filter(user=student).count() == 1
    assert AttemptAnswer.objects.filter(attempt__user=student).count() == 3


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_concurrent_retake_starts_get_one_new_number(run):
    exam = _fresh(f"r{run}", exam_type="practice")
    student = make_student()
    first, _ = start(student, exam)
    services.submit_attempt(student, first.public_id)
    results = _run_concurrently(*[lambda: start(student, exam)] * 3)
    assert sum(created for _a, created in results) == 1
    assert sorted(
        ExamAttempt.objects.filter(user=student).values_list("attempt_no", flat=True)
    ) == [1, 2]


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_start_racing_unpublish(run):
    exam = _fresh(f"u{run}")
    student = make_student()
    started, unpublished = _run_concurrently(
        lambda: start(student, exam),
        lambda: exam_services.unpublish_exam(exam.pk, ctx=exam_services_ctx()),
    )
    assert isinstance(unpublished, Exam)
    if isinstance(started, tuple):
        assert ExamAttempt.objects.filter(exam=exam).count() == 1
    else:
        assert isinstance(started, Http404) and not ExamAttempt.objects.exists()


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_concurrent_saves_keep_the_newest(run):
    exam = _fresh(f"v{run}")
    student = make_student()
    attempt, _ = start(student, exam)
    question = answers_of(attempt)[0].question_id
    old_option, new_option = correct_option_id(question), wrong_option_id(question)
    t = timezone.now()
    _run_concurrently(
        lambda: services.save_answers(
            student, attempt.public_id, [item(question, new_option, when=t)]
        ),
        lambda: services.save_answers(
            student, attempt.public_id, [item(question, old_option, when=t - timedelta(seconds=3))]
        ),
    )
    row = AttemptAnswer.objects.get(attempt=attempt, question_id=question)
    assert (row.selected_option_id, row.client_saved_at) == (new_option, t)


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_stale_batch_retry_vs_newer_save(run):
    exam = _fresh(f"b{run}")
    student = make_student()
    attempt, _ = start(student, exam)
    rows = answers_of(attempt)
    q0 = rows[0].question_id
    t = timezone.now()
    batch = [
        item(r.question_id, wrong_option_id(r.question_id), when=t - timedelta(seconds=9))
        for r in rows
    ]
    _run_concurrently(
        lambda: services.save_answers(student, attempt.public_id, batch),
        lambda: services.save_answers(
            student, attempt.public_id, [item(q0, correct_option_id(q0), when=t)]
        ),
    )
    row = AttemptAnswer.objects.get(attempt=attempt, question_id=q0)
    assert row.selected_option_id == correct_option_id(q0)  # newer one wins either way
    assert AttemptAnswer.objects.filter(attempt=attempt, selected_option__isnull=False).count() == 3


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_double_submit_transitions_once(run):
    exam = _fresh(f"d{run}")
    student = make_student()
    attempt, _ = start(student, exam)
    calls = []
    real = services._finalize

    def counting(*args, **kwargs):
        calls.append(1)
        return real(*args, **kwargs)

    with mock.patch.object(services, "_finalize", side_effect=counting):
        results = _run_concurrently(
            *[lambda: services.submit_attempt(student, attempt.public_id)] * 3
        )
    assert all(isinstance(r, tuple) for r in results), results
    assert len(calls) == 1
    attempt.refresh_from_db()
    assert attempt.status == "submitted"


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_manual_submit_vs_auto_finalize(run):
    exam = _fresh(f"m{run}")
    student = make_student()
    attempt, _ = start(student, exam)
    calls = []
    real = services._finalize

    def counting(*args, **kwargs):
        calls.append(args[2])
        return real(*args, **kwargs)

    late = attempt.deadline_at + GRACE + timedelta(seconds=1)
    with at(late), mock.patch.object(services, "_finalize", side_effect=counting):
        submitted, finalized = _run_concurrently(
            lambda: services.submit_attempt(student, attempt.public_id),
            lambda: services.finalize_overdue_attempts(),
        )
    assert isinstance(submitted, tuple) and finalized in (0, 1)
    assert calls == ["server_auto"]
    attempt.refresh_from_db()
    assert (attempt.status, attempt.submit_source) == ("auto_submitted", "server_auto")


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_save_vs_submit(run):
    exam = _fresh(f"x{run}")
    student = make_student()
    attempt, _ = start(student, exam)
    question = answers_of(attempt)[0].question_id
    option = wrong_option_id(question)
    saved, submitted = _run_concurrently(
        lambda: services.save_answers(student, attempt.public_id, [item(question, option)]),
        lambda: services.submit_attempt(student, attempt.public_id),
    )
    assert isinstance(submitted, tuple)
    row = AttemptAnswer.objects.get(attempt=attempt, question_id=question)
    if isinstance(saved, tuple):
        assert row.selected_option_id == option  # saved before the submit
    else:
        assert isinstance(saved, AttemptError) and saved.code == "attempt_not_in_progress"
        assert row.selected_option_id is None


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_cancel_subscription_vs_save(run):
    exam = _fresh(f"p{run}", access_type="paid")
    student = make_student()
    result = grant(
        student, make_package(f"pk{run}", rules=[{"rule_type": "exam", "exam": exam.pk}])
    )
    attempt, _ = start(student, exam)
    question = answers_of(attempt)[0].question_id
    option = wrong_option_id(question)
    saved, _cancelled = _run_concurrently(
        lambda: services.save_answers(student, attempt.public_id, [item(question, option)]),
        lambda: subscription_services.cancel_subscription(
            result.subscription.pk, ctx=exam_services_ctx()
        ),
    )
    row = AttemptAnswer.objects.get(attempt=attempt, question_id=question)
    if isinstance(saved, tuple):
        assert row.selected_option_id == option
    else:
        assert isinstance(saved, AttemptError) and saved.code == "needs_subscription"
        assert row.selected_option_id is None
    with pytest.raises(AttemptError):
        services.save_answers(student, attempt.public_id, [item(question, option)])


# ======================================================================================
# Validation of service input (defence in depth)
# ======================================================================================
def test_service_rejects_option_of_another_question(student, subject):
    attempt, _ = start(student, published(subject))
    rows = answers_of(attempt)
    with pytest.raises(ValidationError):
        services.save_answers(
            student,
            attempt.public_id,
            [item(rows[0].question_id, wrong_option_id(rows[1].question_id))],
        )


def test_status_values_match_docs():
    assert AttemptStatus.values == ["in_progress", "submitted", "auto_submitted"]


def test_room_payload_queries_do_not_grow_with_questions(student, subject):
    from django.test.utils import CaptureQueriesContext

    counts = []
    for n in (2, 8):
        attempt, _ = start(make_student(), published(subject, n=n))
        with CaptureQueriesContext(connection) as queries:
            loaded = selectors.attempt_with_content(attempt.public_id, attempt.user)
            selectors.attempt_payload(loaded, timezone.now())
        counts.append(len(queries))
    assert counts[0] == counts[1] <= 5


def test_error_messages_in_bangla(student, subject):
    paid = published(subject, access_type="paid")
    response = jwt_client(student).post(
        start_url(paid), {}, format="json", HTTP_ACCEPT_LANGUAGE="bn"
    )
    assert response.json()["error"]["message"] == (
        "এই পরীক্ষার জন্য এটি অন্তর্ভুক্ত এমন একটি সক্রিয় সাবস্ক্রিপশন প্রয়োজন।"
    )


# ======================================================================================
# Exam status changes while attempts are running (policy: new starts only)
# ======================================================================================
class TestStatusChangesDuringAttempt:
    @pytest.mark.parametrize("change", ["unpublish", "archive", "category", "subject"])
    def test_running_attempt_keeps_working(self, student, subject, change):
        exam = published(subject, **({"subject": subject} if change == "subject" else {}))
        attempt, _ = start(student, exam)
        rows = answers_of(attempt)
        ctx = exam_services_ctx()
        if change in ("unpublish", "archive"):
            exam_services.unpublish_exam(exam.pk, ctx=ctx)
        if change == "archive":
            exam_services.archive_exam(exam.pk, ctx=ctx)
        if change == "category":
            subject.category.is_active = False
            subject.category.save()
        if change == "subject":
            subject.is_active = False
            subject.save()
        # New starts are blocked for everyone else ...
        with pytest.raises(Http404):
            start(make_student(), exam)
        # ... but the running attempt resumes, saves and submits from its snapshot.
        client = jwt_client(student)
        assert client.get(url(attempt)).status_code == 200
        q = rows[0].question_id
        saved = client.put(
            url(attempt, f"answers/{q}/"),
            {
                "selected_option_id": wrong_option_id(q),
                "client_saved_at": timezone.now().isoformat(),
            },
            format="json",
        )
        assert saved.status_code == 200 and saved.json()["answers"][0]["status"] == "saved"
        submitted = client.post(url(attempt, "submit/"), {}, format="json")
        assert submitted.status_code == 200 and submitted.json()["status"] == "submitted"

    def test_resume_endpoint_returns_existing_attempt_only_while_available(self, student, subject):
        exam = published(subject)
        attempt, _ = start(student, exam)
        exam_services.unpublish_exam(exam.pk, ctx=exam_services_ctx())
        # The start endpoint is for available exams; a running attempt is resumed by id.
        assert jwt_client(student).post(start_url(exam), {}, format="json").status_code == 404
        assert jwt_client(student).get(url(attempt)).json()["attempt_id"] == str(attempt.public_id)


# ======================================================================================
# Grace rule (one cutoff for answers: deadline_at)
# ======================================================================================
class TestGraceRule:
    TICK = timedelta(microseconds=1)

    def _attempt(self, student, subject):
        attempt, _ = start(student, published(subject))
        q = answers_of(attempt)[0].question_id
        return attempt, q, wrong_option_id(q)

    def test_save_one_microsecond_before_deadline_succeeds(self, student, subject):
        attempt, q, option = self._attempt(student, subject)
        with at(attempt.deadline_at - self.TICK):
            _, results = services.save_answers(student, attempt.public_id, [item(q, option)])
        assert results[0]["status"] == "saved"

    @pytest.mark.parametrize("offset", [timedelta(0), timedelta(seconds=1), GRACE])
    def test_save_at_deadline_or_in_grace_fails(self, student, subject, offset):
        attempt, q, option = self._attempt(student, subject)
        with at(attempt.deadline_at + offset), pytest.raises(AttemptError) as exc:
            services.save_answers(student, attempt.public_id, [item(q, option)])
        assert exc.value.code == "attempt_deadline_passed"
        assert AttemptAnswer.objects.get(attempt=attempt, question_id=q).selected_option_id is None

    @pytest.mark.parametrize("offset", [timedelta(0), timedelta(seconds=10), GRACE])
    def test_submit_at_deadline_and_inside_grace_succeeds(self, student, subject, offset):
        attempt, q, option = self._attempt(student, subject)
        with at(attempt.deadline_at + offset):
            done, results = services.submit_attempt(
                student, attempt.public_id, items=[item(q, option)], source="client_timeout"
            )
        assert (done.status, done.submit_source) == ("submitted", "client_timeout")
        assert done.submitted_at == attempt.deadline_at + offset
        assert results == [{"question_id": q, "status": "deadline_passed"}]  # no late answers
        assert AttemptAnswer.objects.get(attempt=attempt, question_id=q).selected_option_id is None

    def test_submit_answers_before_deadline_are_applied(self, student, subject):
        attempt, q, option = self._attempt(student, subject)
        with at(attempt.deadline_at - self.TICK):
            _, results = services.submit_attempt(
                student, attempt.public_id, items=[item(q, option)]
            )
        assert results[0]["status"] == "saved"

    def test_submit_after_grace_returns_server_auto_state(self, student, subject):
        attempt, q, option = self._attempt(student, subject)
        with at(attempt.deadline_at + GRACE + self.TICK):
            done, results = services.submit_attempt(
                student, attempt.public_id, items=[item(q, option)]
            )
        assert (done.status, done.submit_source) == ("auto_submitted", "server_auto")
        assert results == []

    def test_device_clock_never_decides_timing(self, student, subject):
        attempt, q, option = self._attempt(student, subject)
        future = attempt.deadline_at + timedelta(days=365)
        past = attempt.started_at - timedelta(days=365)
        with at(attempt.deadline_at - self.TICK):  # server says: still in time
            for device_time in (future, past):
                services.save_answers(
                    student, attempt.public_id, [item(q, option, when=device_time)]
                )
        with at(attempt.deadline_at):  # server says: time is over, whatever the device says
            with pytest.raises(AttemptError):
                services.save_answers(student, attempt.public_id, [item(q, option, when=past)])
        attempt.refresh_from_db()
        assert attempt.deadline_at == attempt.started_at + timedelta(minutes=30)


# ======================================================================================
# Snapshot stability: permitted admin changes never alter a running attempt
# ======================================================================================
def _stable(payload):
    return {k: v for k, v in payload.items() if k not in ("server_time", "remaining_seconds")}


def test_permitted_admin_changes_do_not_alter_the_attempt(student, subject):
    from apps.questions import services as question_services
    from apps.questions.exceptions import QuestionLocked

    exam = published(
        subject, shuffle_questions=True, shuffle_options=True, negative_marks=Decimal("0.5")
    )
    attempt, _ = start(student, exam)
    rows = answers_of(attempt)
    q = rows[1].question_id
    services.save_answers(
        student, attempt.public_id, [item(q, wrong_option_id(q), is_marked_for_review=True)]
    )
    client = jwt_client(student)
    before = _stable(client.get(url(attempt)).json())
    ctx = exam_services_ctx()
    exam_services.unpublish_exam(exam.pk, ctx=ctx)
    # Everything an admin may still do:
    question_services.update_question(q, {"difficulty": "hard"}, None, ctx=ctx)
    question_services.update_question(q, {"is_active": False}, None, ctx=ctx)
    exam_services.duplicate_exam(exam.pk, ctx=ctx)
    exam_services.archive_exam(exam.pk, ctx=ctx)
    # Everything that would change the attempt is refused:
    with pytest.raises(QuestionLocked):
        question_services.update_question(q, {"text_en": "Changed"}, None, ctx=ctx)
    with pytest.raises(ExamStateError):
        exam_services.update_exam(exam.pk, {"negative_marks": Decimal("1")}, ctx=ctx)
    after = _stable(client.get(url(attempt)).json())
    assert after == before
    assert [
        (a.question_id, a.option_order, a.marks, a.negative_marks) for a in answers_of(attempt)
    ] == [(a.question_id, a.option_order, a.marks, a.negative_marks) for a in rows]


# ======================================================================================
# Pre-submit leak review (every student response)
# ======================================================================================
FORBIDDEN_KEYS = {
    "is_correct",
    "correct",
    "correct_option",
    "correct_option_id",
    "answer_key",
    "explanation",
    "explanation_bn",
    "explanation_en",
    "awarded_marks",
    "score",
    "user",
    "user_id",
    "mobile_number",
    "full_name",
    "created_by",
    "idempotency_key",
    "client_info",
    "pk",
    "attempt_pk",
}


def id_paths(value, path=""):
    """Paths of every object that has an ``id`` key."""
    found = []
    if isinstance(value, dict):
        if "id" in value:
            found.append(path)
        for key, inner in value.items():
            found += id_paths(inner, f"{path}.{key}")
    elif isinstance(value, list):
        for inner in value:
            found += id_paths(inner, path)
    return found


def test_no_student_response_leaks_answers_or_internal_ids(student, subject):
    exam = published(subject, content_language="both")
    client = jwt_client(student)
    responses = [client.post(start_url(exam), {"client_info": {"app": "1.0"}}, format="json")]
    attempt = ExamAttempt.objects.get()
    q = answers_of(attempt)[0].question_id
    option = wrong_option_id(q)
    now = timezone.now().isoformat()
    responses += [
        client.get(url(attempt)),
        client.put(
            url(attempt, f"answers/{q}/"),
            {"selected_option_id": option, "client_saved_at": now},
            format="json",
        ),
        client.put(
            url(attempt, "answers/"),
            {"answers": [{"question_id": q, "client_saved_at": now}]},
            format="json",
        ),
        client.get("/api/v1/attempts/"),
        client.post(
            url(attempt, "submit/"), {}, format="json", HTTP_IDEMPOTENCY_KEY="secret-key-1"
        ),
        client.get(url(attempt)),  # after submit, still before any result exists
    ]
    for response in responses:
        assert response.status_code in (200, 201), response.content
        body = response.json()
        assert not set(walk(body)) & FORBIDDEN_KEYS, response.request["PATH_INFO"]
        text = response.content.decode()
        assert SECRET not in text and student.mobile_number not in text
        assert "secret-key-1" not in text
        # The only numeric "id" fields are option ids; attempts are identified by UUID.
        assert all(path.endswith("options") for path in id_paths(body)), id_paths(body)
    room = responses[1].json()
    assert room["attempt_id"] == str(attempt.public_id) and "id" not in room
    # Nothing distinguishes the correct option from the others.
    for question in room["questions"]:
        assert {tuple(sorted(o)) for o in question["options"]} == {
            ("id", "text", "text_bn", "text_en")
        }


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_unpublish_racing_save_and_submit_never_strands_the_attempt(run):
    exam = _fresh(f"w{run}")
    student = make_student()
    attempt, _ = start(student, exam)
    question = answers_of(attempt)[0].question_id
    option = wrong_option_id(question)
    saved, unpublished = _run_concurrently(
        lambda: services.save_answers(student, attempt.public_id, [item(question, option)]),
        lambda: exam_services.unpublish_exam(exam.pk, ctx=exam_services_ctx()),
    )
    assert isinstance(saved, tuple) and isinstance(unpublished, Exam)
    submitted, archived = _run_concurrently(
        lambda: services.submit_attempt(student, attempt.public_id),
        lambda: exam_services.archive_exam(exam.pk, ctx=exam_services_ctx()),
    )
    assert isinstance(submitted, tuple) and isinstance(archived, Exam)
    attempt.refresh_from_db()
    assert attempt.status == "submitted"
    assert (
        AttemptAnswer.objects.get(attempt=attempt, question_id=question).selected_option_id
        == option
    )
