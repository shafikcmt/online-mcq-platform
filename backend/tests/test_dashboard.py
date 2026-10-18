"""Milestone 6C: student dashboard and admin basic operational statistics (read-only)."""

import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest import mock

import pytest
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.attempts.models import AttemptStatus, ExamAttempt
from apps.catalog.models import Category
from apps.dashboard import selectors
from apps.exams.models import Exam
from apps.notifications import services as notification_services
from apps.notifications.models import Notification, NotificationType
from apps.payments.models import Payment
from apps.subscriptions.models import Subscription, SubscriptionStatus
from tests.test_attempts import published, start
from tests.test_exams import make_category, make_subject
from tests.test_payments import initiate, mock_callback, pay_mock, refreshed
from tests.test_results import take
from tests.test_subscriptions import all_paid, grant, jwt_client, make_package, make_student

pytestmark = pytest.mark.django_db

ME = "/api/v1/me/dashboard/"
ADMIN = "/api/v1/admin/dashboard/"
_n = iter(range(1, 100_000))


@pytest.fixture(autouse=True)
def _settings(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "media")
    settings.PAYMENT_PROVIDER = "mock"
    settings.PAYMENT_MOCK_ALLOWED = True
    settings.PAYMENT_CALLBACK_BASE_URL = "https://api.test"
    settings.PAYMENT_RETURN_URL = "https://app.test/payment-return"
    settings.ATTEMPT_SUBMIT_GRACE_SECONDS = 30
    settings.DASHBOARD_TIME_ZONE = "Asia/Dhaka"
    settings.DASHBOARD_LIST_SIZE = 5
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def student():
    return make_student(full_name="Rahim Hossain", email="rahim@example.org")


def make_admin():
    return User.objects.create_user(
        f"0161{next(_n):07d}", password="Strong-Pass-2026", full_name="Ops", role=Role.ADMIN
    )


@pytest.fixture
def admin_api():
    client = APIClient()
    client.force_login(make_admin())
    return client


def subject():
    n = next(_n)
    return make_subject(f"ds-{n}", category=make_category(f"dc-{n}"))


def exam(**extra):
    """A published exam (free, regular, unscheduled unless given)."""
    extra.setdefault("title_en", f"Exam {next(_n)}")
    schedule = {k: extra.pop(k) for k in ("start_at", "end_at") if k in extra}
    if extra.get("exam_type") == "live":  # live exams need a schedule to be published
        soon = timezone.now() + timedelta(days=30)
        extra.update(start_at=soon, end_at=soon + timedelta(hours=1))
    row = published(subject(), **extra)
    if schedule:  # set after publishing: publish validation does not apply to history
        Exam.objects.filter(pk=row.pk).update(**schedule)
        row.refresh_from_db()
    return row


def dashboard(user, **headers):
    response = jwt_client(user).get(ME, **headers)
    assert response.status_code == 200, response.content
    return response.json()


def slugs(section):
    return [item["slug"] for item in section["items"]]


# ======================================================================================
# Student — access
# ======================================================================================
class TestStudentAccess:
    def test_requires_student_jwt(self, student):
        assert APIClient().get(ME).status_code == 401
        session = APIClient()
        session.force_login(make_admin())
        assert session.get(ME).status_code == 401  # admin session is not student auth
        session.force_login(student)
        assert session.get(ME).status_code == 401  # nor is a student session
        assert jwt_client(student).get(ME).status_code == 200

    def test_read_only(self, student):
        client = jwt_client(student)
        for method in ("post", "put", "patch", "delete"):
            assert getattr(client, method)(ME).status_code == 405

    def test_empty_dashboard_shape(self, student):
        body = dashboard(student)
        assert set(body) == {"server_time", "exams", "subscription", "results", "notifications"}
        assert set(body["exams"]) == {"available", "upcoming", "practice"}
        for section in body["exams"].values():
            assert section == {"count": 0, "items": []}
        assert body["subscription"] == {"active_count": 0, "items": []}
        assert body["results"] == {"count": 0, "items": []}
        assert body["notifications"] == {"unread_count": 0}


# ======================================================================================
# Student — exams
# ======================================================================================
class TestStudentExams:
    def test_sections_and_boundaries(self, student):
        now = timezone.now()
        with mock.patch("django.utils.timezone.now", return_value=now):
            open_regular = exam(start_at=now - timedelta(hours=1), end_at=now + timedelta(hours=1))
            starts_now = exam(exam_type="live", start_at=now, end_at=now + timedelta(hours=1))
            unscheduled = exam()
            ends_now = exam(start_at=now - timedelta(hours=1), end_at=now)  # end excluded
            ended = exam(start_at=now - timedelta(hours=3), end_at=now - timedelta(hours=1))
            future = exam(start_at=now + timedelta(seconds=1), end_at=now + timedelta(hours=2))
            practice = exam(exam_type="practice")
            future_practice = exam(exam_type="practice", start_at=now + timedelta(days=1))
            draft = exam()
            Exam.objects.filter(pk=draft.pk).update(status="unpublished")
            hidden = exam()
            Category.objects.filter(pk=hidden.category_id).update(is_active=False)
            body = dashboard(student)["exams"]
        assert set(slugs(body["available"])) == {
            open_regular.slug,
            starts_now.slug,
            unscheduled.slug,
        }
        assert body["available"]["count"] == 3
        assert slugs(body["upcoming"]) == [future.slug, future_practice.slug]  # soonest first
        assert body["upcoming"]["count"] == 2
        assert slugs(body["practice"]) == [practice.slug]
        assert body["practice"]["count"] == 1
        everywhere = {s for section in body.values() for s in slugs(section)}
        for excluded in (ends_now, ended, draft, hidden):
            assert excluded.slug not in everywhere

    def test_lists_bounded_counts_complete(self, settings, student):
        settings.DASHBOARD_LIST_SIZE = 2
        now = timezone.now()
        rows = [exam(start_at=now + timedelta(hours=i + 1)) for i in range(4)]
        body = dashboard(student)["exams"]["upcoming"]
        assert body["count"] == 4
        assert slugs(body) == [rows[0].slug, rows[1].slug]

    def test_available_closing_soonest_first(self, student):
        now = timezone.now()
        later = exam(start_at=now - timedelta(hours=1), end_at=now + timedelta(hours=5))
        sooner = exam(start_at=now - timedelta(hours=1), end_at=now + timedelta(hours=1))
        open_ended = exam()
        assert slugs(dashboard(student)["exams"]["available"]) == [
            sooner.slug,
            later.slug,
            open_ended.slug,
        ]

    def test_item_fields(self, student):
        row = exam()
        item = dashboard(student)["exams"]["available"]["items"][0]
        assert item["slug"] == row.slug
        assert set(item) == {
            "slug",
            "title",
            "exam_type",
            "access_type",
            "start_at",
            "end_at",
            "duration_minutes",
            "has_access",
            "can_start",
            "can_resume",
            "attempt_state",
        }

    def test_other_students_attempts_do_not_show(self, student):
        row = exam()
        take(make_student(), row, "c--")
        item = dashboard(student)["exams"]["available"]["items"][0]
        assert item["attempt_state"] is None
        assert item["can_start"] is True and item["can_resume"] is False

    def test_language(self, student):
        exam(title_bn="বাংলা শিরোনাম", title_en="English title")
        exam(title_bn="", title_en="Only English", content_language="en")
        titles = lambda lang: {  # noqa: E731
            i["title"]
            for i in dashboard(student, HTTP_ACCEPT_LANGUAGE=lang)["exams"]["available"]["items"]
        }
        assert titles("bn") == {"বাংলা শিরোনাম", "Only English"}  # falls back to English
        assert titles("en") == {"English title", "Only English"}
        student.preferred_language = "en"
        student.save(update_fields=["preferred_language"])
        assert {i["title"] for i in dashboard(student)["exams"]["available"]["items"]} == {
            "English title",
            "Only English",
        }


# ======================================================================================
# Student — start eligibility (the exam engine's own rules)
# ======================================================================================
def flags(user, row, section="available"):
    items = {i["slug"]: i for i in dashboard(user)["exams"][section]["items"]}
    item = items[row.slug]
    return item["has_access"], item["can_start"], item["can_resume"], item["attempt_state"]


def endpoint(user, row):
    """What the real start endpoint does: 201 = new attempt, 200 = resume, else refused."""
    return jwt_client(user).post(f"/api/v1/exams/{row.slug}/attempts/", {}, format="json")


class TestStartEligibility:
    def test_free_exam_without_attempts_can_start(self, student):
        row = exam()
        assert flags(student, row) == (True, True, False, None)
        assert endpoint(student, row).status_code == 201

    def test_paid_exam_needs_entitlement(self, student):
        row = exam(access_type="paid")
        assert flags(student, row) == (False, False, False, None)
        assert endpoint(student, row).status_code == 403
        grant(student, make_package("gold", rules=all_paid()))
        assert flags(student, row) == (True, True, False, None)
        assert endpoint(student, row).status_code == 201

    @pytest.mark.parametrize("state", ["expired", "cancelled", "stale", "scheduled"])
    def test_paid_exam_with_inactive_subscription_cannot_start(self, student, state):
        row = exam(access_type="paid")
        now = timezone.now()
        package = make_package("gold", rules=all_paid())
        if state == "scheduled":
            grant(student, package, starts_at=now + timedelta(days=1))
        else:
            sub = grant(student, package).subscription
            change = {
                "expired": {"status": SubscriptionStatus.EXPIRED},
                "cancelled": {"status": SubscriptionStatus.CANCELLED},
                "stale": {"starts_at": now - timedelta(days=9), "expires_at": now},
            }[state]
            Subscription.objects.filter(pk=sub.pk).update(**change)
        assert flags(student, row) == (False, False, False, None)
        assert endpoint(student, row).status_code == 403

    def test_live_exam_single_attempt(self, student):
        now = timezone.now()
        row = exam(
            exam_type="live", start_at=now - timedelta(minutes=5), end_at=now + timedelta(hours=1)
        )
        assert flags(student, row)[1] is True
        take(student, row, "c--")
        assert flags(student, row) == (True, False, False, "finished")
        response = endpoint(student, row)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "retake_not_allowed"

    def test_regular_retake_limit(self, student):
        row = exam(allow_retake=True, max_attempts=2)
        take(student, row, "c--")
        assert flags(student, row) == (True, True, False, "finished")  # one left
        take(student, row, "c--")
        assert flags(student, row) == (True, False, False, "finished")  # exhausted
        response = endpoint(student, row)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "attempt_limit_reached"

    def test_no_retake_and_unlimited_retake(self, student):
        once = exam(allow_retake=False)
        unlimited = exam(allow_retake=True, max_attempts=None)
        for row in (once, unlimited):
            take(student, row, "c--")
        assert flags(student, once)[1] is False
        assert endpoint(student, once).status_code == 422
        for _ in range(3):
            take(student, unlimited, "c--")
        assert flags(student, unlimited) == (True, True, False, "finished")
        assert endpoint(student, unlimited).status_code == 201

    def test_in_progress_attempt_resumes(self, student):
        row = exam(access_type="paid")
        package = make_package("gold", rules=all_paid())
        sub = grant(student, package).subscription
        attempt, _ = start(student, row)
        assert flags(student, row) == (True, False, True, "in_progress")
        # Losing access does not hide the resume (the engine resumes before checking access).
        Subscription.objects.filter(pk=sub.pk).update(status=SubscriptionStatus.CANCELLED)
        assert flags(student, row) == (False, False, True, "in_progress")
        response = endpoint(student, row)
        assert response.status_code == 200
        assert response.json()["attempt_id"] == str(attempt.public_id)

    def test_overdue_open_attempt_counts_as_finished(self, student):
        row = exam(allow_retake=False)
        attempt, _ = start(student, row)
        now = timezone.now()
        ExamAttempt.objects.filter(pk=attempt.pk).update(
            started_at=now - timedelta(hours=2), deadline_at=now - timedelta(minutes=5)
        )
        assert flags(student, row) == (True, False, False, "finished")
        response = endpoint(student, row)  # finalizes the overdue attempt, then refuses
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "retake_not_allowed"

    def test_upcoming_exam_cannot_start_yet(self, student):
        row = exam(start_at=timezone.now() + timedelta(hours=1))
        assert flags(student, row, "upcoming") == (True, False, False, None)
        response = endpoint(student, row)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "exam_not_started"

    def test_exam_ending_exactly_now_cannot_start(self, student):
        from apps.attempts.selectors import start_options

        now = timezone.now()
        row = exam(start_at=now - timedelta(hours=1), end_at=now + timedelta(hours=1))
        Exam.objects.filter(pk=row.pk).update(end_at=now)
        row.refresh_from_db()
        assert start_options(row, now, entitled=True, attempts=0, open_deadline=None) == (
            False,
            False,
        )
        assert start_options(
            row, now - timedelta(microseconds=1), entitled=True, attempts=0, open_deadline=None
        ) == (True, False)
        assert endpoint(student, row).status_code == 422  # already past end_at

    def test_other_students_attempts_do_not_affect_eligibility(self, student):
        row = exam(
            exam_type="live",
            start_at=timezone.now() - timedelta(minutes=1),
            end_at=timezone.now() + timedelta(hours=1),
        )
        take(make_student(), row, "c--")
        start(make_student(), row)
        assert flags(student, row) == (True, True, False, None)
        assert endpoint(student, row).status_code == 201

    def test_practice_follows_the_same_rules(self, student):
        once = exam(exam_type="practice", allow_retake=False)
        many = exam(exam_type="practice", allow_retake=True, max_attempts=None)
        assert flags(student, once, "practice") == (True, True, False, None)
        take(student, once, "c--")
        take(student, many, "c--")
        assert flags(student, once, "practice") == (True, False, False, "finished")
        assert flags(student, many, "practice") == (True, True, False, "finished")
        assert endpoint(student, once).status_code == 422
        assert endpoint(student, many).status_code == 201


# ======================================================================================
# Student — subscriptions
# ======================================================================================
class TestStudentSubscription:
    def test_only_effectively_active_counts(self, student):
        now = timezone.now()
        active = grant(student, make_package("gold", name_bn="গোল্ড", name_en="Gold")).subscription
        scheduled = grant(
            student, make_package("silver"), starts_at=now + timedelta(days=1)
        ).subscription
        stale = grant(student, make_package("bronze")).subscription  # status active, past expiry
        Subscription.objects.filter(pk=stale.pk).update(
            starts_at=now - timedelta(days=10), expires_at=now - timedelta(seconds=1)
        )
        cancelled = grant(student, make_package("tin")).subscription
        Subscription.objects.filter(pk=cancelled.pk).update(status=SubscriptionStatus.CANCELLED)
        expired = grant(student, make_package("iron")).subscription
        Subscription.objects.filter(pk=expired.pk).update(status=SubscriptionStatus.EXPIRED)
        grant(make_student(), make_package("other"))  # another student's
        body = dashboard(student, HTTP_ACCEPT_LANGUAGE="bn")["subscription"]
        assert body["active_count"] == 1
        assert body["items"] == [
            {
                "package": {"slug": "gold", "name": "গোল্ড"},
                "starts_at": body["items"][0]["starts_at"],
                "expires_at": body["items"][0]["expires_at"],
            }
        ]
        assert scheduled.pk and active.pk

    def test_boundaries_at_now(self, student):
        now = timezone.now()
        starts = grant(student, make_package("a")).subscription
        ends = grant(student, make_package("b")).subscription
        Subscription.objects.filter(pk=starts.pk).update(
            starts_at=now, expires_at=now + timedelta(days=1)
        )
        Subscription.objects.filter(pk=ends.pk).update(
            starts_at=now - timedelta(days=1), expires_at=now
        )
        with mock.patch("django.utils.timezone.now", return_value=now):
            body = dashboard(student)["subscription"]
        assert body["active_count"] == 1  # starts_at <= now < expires_at
        assert body["items"][0]["package"]["slug"] == "a"


# ======================================================================================
# Student — results and notifications
# ======================================================================================
class TestStudentResults:
    def test_only_visible_own_results_newest_first_bounded(self, settings, student):
        settings.DASHBOARD_LIST_SIZE = 2
        first = take(student, exam(result_visibility="immediate"), "c--")
        second = take(student, exam(result_visibility="immediate"), "cc-")
        third = take(student, exam(result_visibility="immediate"), "ccc")
        take(student, exam(result_visibility="manual"), "ccc")  # not published: hidden
        take(make_student(), exam(result_visibility="immediate"), "ccc")  # someone else
        body = dashboard(student)["results"]
        assert body["count"] == 3
        assert [r["attempt_id"] for r in body["items"]] == [
            str(third.public_id),
            str(second.public_id),
        ]
        assert str(first.public_id) not in json.dumps(body)
        assert set(body["items"][0]) == {
            "attempt_id",
            "exam",
            "submitted_at",
            "obtained_marks",
            "total_marks",
            "percentage",
            "is_passed",
            "merit_position",
        }

    def test_manual_result_appears_after_publication(self, student):
        from apps.audit.services import AuditContext
        from apps.exams import services as exam_services

        row = exam(result_visibility="manual")
        take(student, row, "c--")
        assert dashboard(student)["results"]["count"] == 0
        exam_services.publish_results(row.pk, ctx=AuditContext())
        assert dashboard(student)["results"]["count"] == 1

    def test_unread_notification_count_is_own_only(self, student):
        def note(user, n):
            notification_services.notify_results(
                [
                    notification_services.build(
                        user.pk, NotificationType.RESULT_PUBLISHED, next(_n), {"exam_slug": n}
                    )
                ]
            )

        for i in range(3):
            note(student, f"e{i}")
        note(make_student(), "x")
        notification_services.mark_read(
            student, Notification.objects.filter(user=student).first().public_id
        )
        assert dashboard(student)["notifications"] == {"unread_count": 2}


# ======================================================================================
# Student — privacy and query count
# ======================================================================================
class TestStudentPrivacy:
    def test_no_internal_ids_or_sensitive_fields(self, student):
        package = make_package("gold", rules=all_paid())
        subscription = grant(student, package).subscription
        row = exam(result_visibility="immediate", allow_answer_review=True)
        attempt = take(student, row, "cw-")
        result = attempt.result
        body = dashboard(student)
        internal = {
            str(v) for v in (student.pk, package.pk, subscription.pk, row.pk, attempt.pk, result.pk)
        }

        def leaves(value):
            if isinstance(value, dict):
                for key, item in value.items():
                    assert key not in {"id", "pk", "user", "user_id", "exam_id", "package_id"}
                    yield from leaves(item)
            elif isinstance(value, list):
                for item in value:
                    yield from leaves(item)
            else:
                yield value

        for leaf in leaves(body):
            assert not (isinstance(leaf, str) and leaf in internal)
        text = json.dumps(body)
        for hidden in (
            "is_correct",
            "explanation",
            "price",
            "amount",
            "mobile",
            "email",
            "rahim@",
            "Rahim",
            "merchant",
            "provider",
        ):
            assert hidden not in text

    def test_query_count_is_constant(self, student):
        client = jwt_client(student)
        exam()  # one row per kind of section, so every query of the endpoint runs
        client.get(ME)  # warm caches (language default, etc.)
        with CaptureQueriesContext(connection) as small:
            assert client.get(ME).status_code == 200
        grant(student, make_package("gold", rules=all_paid()))
        for i in range(8):
            take(student, exam(result_visibility="immediate", access_type="paid"), "c--")
            exam(start_at=timezone.now() + timedelta(days=i + 1))
            exam(exam_type="practice")
        with CaptureQueriesContext(connection) as large:
            assert client.get(ME).status_code == 200
        assert len(large) == len(small)
        assert len(large) <= 12  # 1 auth + 11 dashboard queries


# ======================================================================================
# Admin
# ======================================================================================
class TestAdminAccess:
    def test_admin_only(self, student):
        assert APIClient().get(ADMIN).status_code == 401
        assert jwt_client(student).get(ADMIN).status_code == 401  # student JWT not accepted
        session = APIClient()
        session.force_login(student)
        assert session.get(ADMIN).status_code == 403  # a student session is not an admin
        admin = make_admin()
        session.force_login(admin)
        assert session.get(ADMIN).status_code == 200
        User.objects.filter(pk=admin.pk).update(is_active=False)
        assert session.get(ADMIN).status_code in (401, 403)

    def test_read_only_and_csrf_safe(self, admin_api):
        for method in ("post", "put", "patch", "delete"):
            assert getattr(admin_api, method)(ADMIN).status_code in (403, 405)


def _pay(user, package, result):
    payment = initiate(user, package)
    if result != "pending":
        mock_callback(payment, result, pay_mock(payment, result))
    return refreshed(payment)


class TestAdminStats:
    def test_exact_seeded_counts(self, admin_api):
        now = timezone.now()
        students = [make_student() for _ in range(3)]
        User.objects.filter(pk=students[2].pk).update(is_active=False)
        # Exams by status / time.
        open_exam = exam(start_at=now - timedelta(hours=1), end_at=now + timedelta(hours=1))
        exam(start_at=now + timedelta(hours=1), end_at=now + timedelta(hours=2))  # upcoming
        exam(start_at=now - timedelta(hours=3), end_at=now - timedelta(hours=1))  # ended
        unpublished = exam(start_at=now + timedelta(hours=1))
        Exam.objects.filter(pk=unpublished.pk).update(status="unpublished")  # not upcoming
        # Attempts: two finished today, one open, one overdue (not open).
        take(students[0], open_exam, "c--")
        take(students[1], open_exam, "c--")
        open_attempt, _ = start(students[0], exam())
        overdue, _ = start(students[1], exam())
        ExamAttempt.objects.filter(pk=overdue.pk).update(
            started_at=now - timedelta(hours=2), deadline_at=now - timedelta(minutes=5)
        )
        # Subscriptions: two active rows for one student, one scheduled, one cancelled.
        gold = make_package("gold", rules=all_paid(), price=Decimal("500.00"))
        grant(students[0], gold)
        grant(students[0], make_package("silver"))
        grant(students[1], make_package("later"), starts_at=now + timedelta(days=2))
        gone = grant(students[1], make_package("gone")).subscription
        Subscription.objects.filter(pk=gone.pk).update(status=SubscriptionStatus.CANCELLED)
        # Payments: success ×2 (one through the late-success path is not needed here),
        # failed, cancelled, pending.
        for result in ("success", "success", "fail", "cancel", "pending"):
            _pay(students[2 if result == "pending" else 1], gold, result)

        body = admin_api.get(ADMIN).json()
        assert body["users"] == {"students_total": 3, "students_active": 2}
        exams = body["exams"]
        assert exams["total"] == 6
        assert exams["published"] == 5 and exams["unpublished"] == 1
        assert exams["draft"] == 0 and exams["archived"] == 0
        assert exams["open_now"] == 3  # open_exam + the two unscheduled ones
        assert exams["upcoming"] == 1
        assert body["attempts"] == {"started_today": 4, "submitted_today": 2, "in_progress": 1}
        # +2 subscriptions created by the successful payments (students[1]).
        assert body["subscriptions"] == {"active_now": 3, "students_with_active": 2}
        by_status = body["payments"]["by_status"]
        assert by_status["success"] == 2
        assert by_status["failed"] == 1
        assert by_status["cancelled"] == 1
        assert by_status["pending"] + by_status["initiated"] == 1
        assert sum(by_status.values()) == Payment.objects.count() == 5
        assert body["payments"]["success_this_month"] == 2
        assert body["payments"]["revenue_this_month"] == [{"currency": "BDT", "amount": "1000.00"}]
        assert open_attempt.status == AttemptStatus.IN_PROGRESS

    def test_today_and_month_use_dhaka_calendar(self, admin_api, student):
        # 2026-10-14 18:30 UTC = 2026-10-15 00:30 in Dhaka (UTC+6).
        now = datetime(2026, 10, 14, 18, 30, tzinfo=UTC)
        period = selectors.periods(now)
        assert period.today_start == datetime(2026, 10, 14, 18, 0, tzinfo=UTC)
        assert period.today_end == datetime(2026, 10, 15, 18, 0, tzinfo=UTC)
        assert period.month_start == datetime(2026, 9, 30, 18, 0, tzinfo=UTC)
        assert period.month_end == datetime(2026, 10, 31, 18, 0, tzinfo=UTC)
        december = selectors.periods(datetime(2026, 12, 31, 19, 0, tzinfo=UTC))
        assert december.month_start == datetime(2026, 12, 31, 18, 0, tzinfo=UTC)  # 1 Jan
        assert december.month_end == datetime(2027, 1, 31, 18, 0, tzinfo=UTC)

    def test_attempt_and_revenue_period_boundaries(self, admin_api, student):
        now = timezone.now()
        period = selectors.periods(now)
        row = exam()
        attempts = [start(make_student(), row)[0] for _ in range(3)]
        ExamAttempt.objects.filter(pk=attempts[0].pk).update(
            started_at=period.today_start, deadline_at=period.today_start + timedelta(hours=1)
        )  # first instant of today: counted
        ExamAttempt.objects.filter(pk=attempts[1].pk).update(
            started_at=period.today_start - timedelta(microseconds=1),
            deadline_at=period.today_start + timedelta(hours=1),
        )  # last instant of yesterday: not counted
        gold = make_package("gold", rules=all_paid(), price=Decimal("250.00"))
        inside, outside = _pay(student, gold, "success"), _pay(student, gold, "success")
        Payment.objects.filter(pk=inside.pk).update(verified_at=period.month_start)
        Payment.objects.filter(pk=outside.pk).update(
            verified_at=period.month_start - timedelta(microseconds=1)
        )
        body = admin_api.get(ADMIN).json()
        assert body["attempts"]["started_today"] == 2
        assert body["payments"]["success_this_month"] == 1
        assert body["payments"]["revenue_this_month"] == [{"currency": "BDT", "amount": "250.00"}]
        assert body["payments"]["by_status"]["success"] == 2  # lifetime count is unchanged
        assert body["period"]["time_zone"] == "Asia/Dhaka"

    def test_no_people_lists_or_sensitive_fields(self, admin_api, student):
        gold = make_package("gold", rules=all_paid())
        _pay(student, gold, "success")
        from apps.cms.models import ContactMessage

        ContactMessage.objects.create(
            name="Karim",
            phone="01711111111",
            email="k@example.org",
            subject="S",
            message="Secret",
            language="bn",
        )
        body = admin_api.get(ADMIN).json()
        assert set(body) == {
            "server_time",
            "period",
            "users",
            "exams",
            "attempts",
            "subscriptions",
            "payments",
        }
        text = json.dumps(body)
        for hidden in (
            student.mobile_number,
            "rahim@",
            "Rahim",
            "Karim",
            "Secret",
            "merchant",
            "transaction",
            "raw",
            "ip_address",
            "MOCK",
        ):
            assert hidden not in text

    def test_query_count_is_constant(self, admin_api):
        admin_api.get(ADMIN)
        with CaptureQueriesContext(connection) as small:
            assert admin_api.get(ADMIN).status_code == 200
        gold = make_package("gold", rules=all_paid())
        for _ in range(5):
            user = make_student()
            _pay(user, gold, "success")
            take(user, exam(), "c--")
        with CaptureQueriesContext(connection) as large:
            assert admin_api.get(ADMIN).status_code == 200
        assert len(large) == len(small)
        assert len(large) <= 8  # session + user + 6 aggregates


class TestAdminBoundaries:
    def test_exam_window_and_subscription_state_at_now(self, admin_api, student):
        now = timezone.now()
        exam(start_at=now, end_at=now + timedelta(hours=1))  # opens now: open
        exam(start_at=now - timedelta(hours=1), end_at=now)  # ends now: closed
        exam(start_at=now + timedelta(microseconds=1))  # upcoming
        exam(exam_type="practice")  # unscheduled: open
        package = make_package("gold")
        stale = grant(student, package).subscription  # status active but already expired
        Subscription.objects.filter(pk=stale.pk).update(
            starts_at=now - timedelta(days=30), expires_at=now
        )
        future = grant(make_student(), make_package("later"), starts_at=now + timedelta(days=1))
        with mock.patch("django.utils.timezone.now", return_value=now):
            body = admin_api.get(ADMIN).json()
        assert body["exams"]["open_now"] == 2
        assert body["exams"]["upcoming"] == 1
        assert body["exams"]["published"] == 4
        assert body["subscriptions"] == {"active_now": 0, "students_with_active": 0}
        assert future.subscription.status == SubscriptionStatus.ACTIVE  # stored ≠ effective

    def test_sections_never_double_count(self, student):
        now = timezone.now()
        rows = [
            exam(start_at=now - timedelta(hours=1), end_at=now + timedelta(hours=1)),
            exam(start_at=now + timedelta(hours=1)),
            exam(exam_type="practice"),
            exam(exam_type="practice", start_at=now + timedelta(hours=1)),
        ]
        body = dashboard(student)["exams"]
        listed = [s for section in body.values() for s in slugs(section)]
        assert sorted(listed) == sorted(r.slug for r in rows)  # each exam exactly once
        assert sum(section["count"] for section in body.values()) == 4


class TestSettingsChecks:
    def test_bad_settings_reported(self, settings):
        from apps.dashboard.checks import check_dashboard_settings

        assert check_dashboard_settings(None) == []
        settings.DASHBOARD_TIME_ZONE = "Mars/Olympus"
        settings.DASHBOARD_LIST_SIZE = 0
        assert [m.id for m in check_dashboard_settings(None)] == [
            "dashboard.E001",
            "dashboard.E002",
        ]
