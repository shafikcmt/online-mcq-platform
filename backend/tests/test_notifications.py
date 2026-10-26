"""Milestone 6B: in-app notifications (payment success, result published)."""

import json
from datetime import timedelta
from decimal import Decimal
from unittest import mock

import pytest
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.audit.services import AuditContext
from apps.exams import services as exam_services
from apps.exams.models import Exam
from apps.notifications import services
from apps.notifications.models import Notification, NotificationRollout, NotificationType
from apps.payments import services as payments
from apps.payments.exceptions import PaymentError
from apps.payments.gateways import Outcome, VerificationResult, get_gateway
from apps.results import services as result_services
from apps.results import tasks as result_tasks
from apps.results.models import Result
from tests.test_attempts import _run_concurrently, start
from tests.test_exams import make_category, make_subject
from tests.test_payments import (
    _age,
    close,
    initiate,
    ipn_url,
    mock_callback,
    pay_mock,
    post_form,
    refreshed,
)
from tests.test_results import published, take
from tests.test_subscriptions import all_paid, jwt_client, make_package, make_student

pytestmark = pytest.mark.django_db

CTX = AuditContext()
ME = "/api/v1/me/notifications/"
_n = iter(range(1, 10_000))


@pytest.fixture(autouse=True)
def _settings(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "media")
    settings.PAYMENT_PROVIDER = "mock"
    settings.PAYMENT_MOCK_ALLOWED = True
    settings.PAYMENT_CALLBACK_BASE_URL = "https://api.test"
    settings.PAYMENT_RETURN_URL = "https://app.test/payment-return"
    settings.ATTEMPT_SUBMIT_GRACE_SECONDS = 30
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def student():
    return make_student(full_name="Rahim Hossain", email="rahim@example.org")


@pytest.fixture
def package():
    return make_package(
        f"gold-{next(_n)}",
        rules=all_paid(),
        price=Decimal("500.00"),
        name_bn="গোল্ড প্যাকেজ",
        name_en="Gold package",
    )


def fresh_subject():
    n = next(_n)
    return make_subject(f"ns-{n}", category=make_category(f"nc-{n}"))


def notes(user=None, type=None):
    queryset = Notification.objects.all()
    if user is not None:
        queryset = queryset.filter(user=user)
    if type is not None:
        queryset = queryset.filter(type=type)
    return list(queryset)


def paid(student, package):
    payment = initiate(student, package)
    mock_callback(payment, val_id=pay_mock(payment))
    return refreshed(payment)


# ======================================================================================
# Model
# ======================================================================================
class TestModel:
    def test_database_guards(self, student):
        note = services.build(student.pk, NotificationType.PAYMENT_SUCCESS, 7, {})
        note.save()
        for update in ({"type": "marketing"}, {"source_id": 0}):
            with pytest.raises(IntegrityError), transaction.atomic():
                Notification.objects.filter(pk=note.pk).update(**update)
        with pytest.raises(IntegrityError), transaction.atomic():
            Notification.objects.filter(pk=note.pk).update(
                read_at=note.created_at - timedelta(seconds=1)
            )
        with pytest.raises(IntegrityError), transaction.atomic():
            services.build(student.pk, NotificationType.PAYMENT_SUCCESS, 7, {}).save()
        # Same source for another user or type is a different event.
        services.build(make_student().pk, NotificationType.PAYMENT_SUCCESS, 7, {}).save()
        services.build(student.pk, NotificationType.RESULT_PUBLISHED, 7, {}).save()

    def test_params_are_allow_listed(self, student):
        with pytest.raises(ValueError, match="not allow-listed"):
            services.build(
                student.pk, NotificationType.PAYMENT_SUCCESS, 1, {"raw_verification": "x"}
            )
        with pytest.raises(ValueError):
            services.build(student.pk, NotificationType.RESULT_PUBLISHED, 1, {"email": "a@b"})
        with pytest.raises(KeyError):
            services.build(student.pk, "marketing", 1, {})

    def test_types_match_docs(self):
        assert NotificationType.values == ["payment_success", "result_published"]


# ======================================================================================
# Rendering (re-rendered in the reader's language at read time)
# ======================================================================================
class TestRendering:
    def test_bangla_english_and_language_switch(self, student, package):
        paid(student, package)
        client = jwt_client(student)
        en = client.get(ME, HTTP_ACCEPT_LANGUAGE="en").json()["results"][0]
        assert en["title"] == "Payment successful"
        assert en["message"] == (
            "Your payment for “Gold package” was successful. Your subscription is now active."
        )
        bn = client.get(ME, HTTP_ACCEPT_LANGUAGE="bn").json()["results"][0]
        assert bn["title"] == "পেমেন্ট সফল হয়েছে"
        assert "গোল্ড প্যাকেজ" in bn["message"]
        # No explicit choice → the student's preferred language decides.
        student.preferred_language = "en"
        student.save(update_fields=["preferred_language"])
        assert client.get(ME).json()["results"][0]["title"] == "Payment successful"
        student.preferred_language = "bn"
        student.save(update_fields=["preferred_language"])
        assert client.get(ME).json()["results"][0]["title"] == "পেমেন্ট সফল হয়েছে"

    def test_name_fallback(self, student):
        package = make_package(f"en-only-{next(_n)}", rules=all_paid(), name_bn="", name_en="Only")
        paid(student, package)
        bn = jwt_client(student).get(ME, HTTP_ACCEPT_LANGUAGE="bn").json()["results"][0]
        assert "“Only”" in bn["message"]  # bn empty → en
        package2 = make_package(f"bn-only-{next(_n)}", rules=all_paid(), name_bn="বাংলা", name_en="")
        paid(student, package2)
        en = jwt_client(student).get(ME, HTTP_ACCEPT_LANGUAGE="en").json()["results"][0]
        assert "“বাংলা”" in en["message"]  # en empty → bn

    def test_plain_text_never_html(self, student):
        package = make_package(
            f"x-{next(_n)}", rules=all_paid(), name_en="<script>alert(1)</script>"
        )
        paid(student, package)
        message = (
            jwt_client(student).get(ME, HTTP_ACCEPT_LANGUAGE="en").json()["results"][0]["message"]
        )
        assert "<script>alert(1)</script>" in message  # JSON text; clients render escaped


# ======================================================================================
# Payment success trigger
# ======================================================================================
class TestPaymentTrigger:
    def test_verified_success_creates_one(self, student, package):
        payment = paid(student, package)
        [note] = notes(student)
        assert note.type == "payment_success" and note.source_id == payment.pk
        assert note.params == {
            "payment_id": str(payment.public_id),
            "package_slug": package.slug,
            "package_name_bn": "গোল্ড প্যাকেজ",
            "package_name_en": "Gold package",
            "verified_at": payment.verified_at.isoformat(),
        }
        text = json.dumps(note.params)
        for secret in ("MOCKTXN", "VALID", "rahim", student.mobile_number, "500"):
            assert secret not in text

    def test_replays_reconciliation_and_reverify_do_not_duplicate(self, student, package):
        payment = initiate(student, package)
        val_id = pay_mock(payment)
        for _ in range(3):
            mock_callback(payment, val_id=val_id)
            post_form(ipn_url(), {"tran_id": payment.merchant_reference, "val_id": val_id})
        verified = get_gateway("mock").query(payment)
        payments.apply_verification(payment.pk, verified, source="test")
        with pytest.raises(PaymentError) as refused:  # a successful payment is final
            payments.admin_reverify(payment.public_id, ctx=CTX)
        assert refused.value.code == "already_successful"
        _age(payment, 1000)
        payments.reconcile_payments()
        assert len(notes(student)) == 1

    def test_late_provider_success_creates_one(self, student, package):
        payment = close(initiate(student, package))
        assert notes(student) == []
        val_id = pay_mock(payment, "success")
        mock_callback(payment, val_id=val_id)
        mock_callback(payment, val_id=val_id)
        assert refreshed(payment).status == "success"
        assert len(notes(student, "payment_success")) == 1

    @pytest.mark.parametrize("result", ["fail", "cancel"])
    def test_failed_or_cancelled_creates_none(self, student, package, result):
        payment = initiate(student, package)
        mock_callback(payment, result, pay_mock(payment, result))
        assert notes() == []

    def test_fake_or_tampered_callbacks_create_none(self, student, package):
        payment = initiate(student, package)
        mock_callback(payment, "success", "MOCKVALFAKE")  # never paid
        tampered = initiate(student, package)
        mock_callback(tampered, val_id=pay_mock(tampered, amount="1.00"))
        other = initiate(make_student(), package)
        mock_callback(payment, val_id=pay_mock(other))  # someone else's proof
        assert notes(student) == []

    def test_rolled_back_success_creates_none(self, student, package):
        payment = initiate(student, package)
        pay_mock(payment)
        verified = get_gateway("mock").query(payment)
        with pytest.raises(RuntimeError), transaction.atomic():
            payments.apply_verification(payment.pk, verified, source="test")
            assert len(notes(student)) == 1  # written in the same transaction …
            raise RuntimeError("roll back")
        assert notes(student) == []  # … and gone with it
        assert refreshed(payment).status == "pending"

    def test_failed_grant_creates_none(self, student, package):
        payment = initiate(student, package)
        with mock.patch(
            "apps.payments.services.grant_subscription",
            side_effect=payments.ValidationError({"user": "x"}),
        ):
            mock_callback(payment, val_id=pay_mock(payment))
        assert refreshed(payment).status == "pending" and notes() == []


# ======================================================================================
# Result published trigger
# ======================================================================================
class TestResultTrigger:
    def test_immediate_result_creates_one_at_scoring(self, student):
        exam = published(fresh_subject())  # immediate (default)
        attempt = take(student, exam, "cc-")
        [note] = notes(student, "result_published")
        result = Result.objects.get(attempt=attempt)
        assert note.source_id == result.pk
        assert note.params == {
            "attempt_id": str(attempt.public_id),
            "exam_slug": exam.slug,
            "exam_title_bn": exam.title_bn,
            "exam_title_en": exam.title_en,
        }
        assert result_services.notify_visible_results() == 0  # job adds nothing new
        assert len(notes(student)) == 1
        body = jwt_client(student).get(ME, HTTP_ACCEPT_LANGUAGE="en").json()["results"][0]
        assert body["title"] == "Result published"
        assert body["target"] == {"type": "result", "attempt_id": str(attempt.public_id)}

    def test_manual_only_on_publication_and_never_twice(
        self, student, django_capture_on_commit_callbacks
    ):
        exam = published(fresh_subject(), result_visibility="manual")
        other = make_student()
        take(student, exam, "c--")
        take(other, exam, "ccc")
        assert notes() == []  # hidden results: nothing yet
        assert result_services.notify_visible_results() == 0
        with django_capture_on_commit_callbacks(execute=True) as callbacks:
            exam_services.publish_results(exam.pk, ctx=CTX)  # on_commit → task (eager)
        assert len(callbacks) == 1
        assert len(notes(type="result_published")) == 2
        assert {n.user_id for n in notes()} == {student.pk, other.pk}
        exam_services.hide_results(exam.pk, ctx=CTX)
        with django_capture_on_commit_callbacks(execute=True):
            exam_services.publish_results(exam.pk, ctx=CTX)  # re-publish: no second round
        result_services.notify_visible_results()
        assert len(notes()) == 2

    def test_after_exam_end_waits_for_the_end(self, student):
        now = timezone.now()
        exam = published(
            fresh_subject(),
            result_visibility="after_exam_end",
            start_at=now - timedelta(hours=1),
            end_at=now + timedelta(hours=2),
        )
        take(student, exam, "c--")
        assert result_services.notify_visible_results() == 0
        assert notes() == []
        Exam.objects.filter(pk=exam.pk).update(end_at=timezone.now() - timedelta(minutes=1))
        assert result_services.notify_visible_results() == 1
        assert result_services.notify_visible_results() == 0
        assert len(notes(student)) == 1

    def test_bounded_batches(self):
        exam = published(fresh_subject(), result_visibility="manual")
        for _ in range(5):
            take(make_student(), exam, "c--")
        Exam.objects.filter(pk=exam.pk).update(result_published_at=timezone.now())
        assert result_services.notify_visible_results(batch_size=2, max_batches=1) == 2
        assert result_services.notify_visible_results(batch_size=2, max_batches=10) == 3
        assert len(notes()) == 5

    def test_publish_survives_a_queue_failure(self, student, django_capture_on_commit_callbacks):
        set_rollout(timezone.now() - timedelta(days=30))
        exam = published(fresh_subject(), result_visibility="manual")
        take(student, exam, "c--")
        with (
            mock.patch(
                "apps.results.tasks.notify_visible_results_task.delay",
                side_effect=RuntimeError("broker down"),
            ) as delay,
            django_capture_on_commit_callbacks(execute=True),
        ):
            exam_services.publish_results(exam.pk, ctx=CTX)
        assert delay.called
        assert Exam.objects.get(pk=exam.pk).result_published_at is not None
        assert notes() == []
        # The broker stays down for days; the next beat run still catches it up.
        Exam.objects.filter(pk=exam.pk).update(
            result_published_at=timezone.now() - timedelta(days=5)
        )
        assert result_tasks.notify_visible_results_task() == 1
        assert len(notes(student, type="result_published")) == 1
        assert result_services.notify_visible_results() == 0  # nothing left, no duplicate

    def test_unfinished_attempt_creates_none(self, student):
        exam = published(fresh_subject())
        start(student, exam)
        assert result_services.notify_visible_results() == 0 and notes() == []

    def test_task_and_schedule(self, settings):
        from apps.results.tasks import notify_visible_results_task

        assert notify_visible_results_task.delay().get() == 0
        assert settings.CELERY_BEAT_SCHEDULE["notify-visible-results"]["task"] == (
            "apps.results.tasks.notify_visible_results_task"
        )


# ======================================================================================
# API
# ======================================================================================
def set_rollout(when):
    NotificationRollout.objects.update_or_create(
        type=NotificationType.RESULT_PUBLISHED, defaults={"starts_at": when}
    )


class TestCatchUp:
    """No look-back window: anything visible since the rollout boundary and still
    unannounced is caught up, however long workers were down; history is not."""

    def test_rollout_boundary_recorded_by_migration(self):
        boundary = services.rollout_start(NotificationType.RESULT_PUBLISHED)
        assert boundary is not None and boundary <= timezone.now()

    def test_manual_publication_during_long_outage_is_caught_up(self, student):
        now = timezone.now()
        set_rollout(now - timedelta(days=30))
        exam = published(fresh_subject(), result_visibility="manual")
        take(student, exam, "c--")
        Result.objects.filter(exam=exam).update(calculated_at=now - timedelta(days=12))
        # Published 10 days ago while Celery/beat was down (well beyond 72 h).
        Exam.objects.filter(pk=exam.pk).update(result_published_at=now - timedelta(days=10))
        assert result_services.notify_visible_results() == 1
        assert len(notes(student, type="result_published")) == 1

    def test_after_exam_end_during_long_outage_is_caught_up(self, student):
        now = timezone.now()
        set_rollout(now - timedelta(days=30))
        exam = published(
            fresh_subject(),
            result_visibility="after_exam_end",
            start_at=now - timedelta(hours=1),
            end_at=now + timedelta(hours=2),
        )
        take(student, exam, "c--")
        assert notes() == []
        Result.objects.filter(exam=exam).update(calculated_at=now - timedelta(days=8))
        Exam.objects.filter(pk=exam.pk).update(
            start_at=now - timedelta(days=9), end_at=now - timedelta(days=7)
        )
        assert result_services.notify_visible_results() == 1
        assert len(notes(student)) == 1

    def test_pre_rollout_results_are_never_announced(self, student):
        now = timezone.now()
        manual = published(fresh_subject(), result_visibility="manual")
        ended = published(
            fresh_subject(),
            result_visibility="after_exam_end",
            start_at=now - timedelta(hours=1),
            end_at=now + timedelta(hours=2),
        )
        take(student, manual, "c--")
        take(make_student(), ended, "c--")
        # Both became visible well before notifications existed.
        Result.objects.all().update(calculated_at=now - timedelta(days=60))
        Exam.objects.filter(pk=manual.pk).update(result_published_at=now - timedelta(days=50))
        Exam.objects.filter(pk=ended.pk).update(
            start_at=now - timedelta(days=61), end_at=now - timedelta(days=50)
        )
        set_rollout(now - timedelta(days=1))
        assert result_services.notify_visible_results() == 0
        assert notes() == []

    def test_scored_after_rollout_in_an_older_exam_is_caught_up(self, student):
        now = timezone.now()
        exam = published(fresh_subject(), result_visibility="manual")
        take(student, exam, "c--")
        Exam.objects.filter(pk=exam.pk).update(result_published_at=now - timedelta(days=50))
        Notification.objects.all().delete()  # as if the in-transaction insert were missing
        set_rollout(now - timedelta(days=1))
        assert result_services.notify_visible_results() == 1

    def test_repeated_runs_never_duplicate(self, student):
        set_rollout(timezone.now() - timedelta(days=30))
        exam = published(fresh_subject(), result_visibility="manual")
        take(student, exam, "c--")
        take(make_student(), exam, "c--")
        Exam.objects.filter(pk=exam.pk).update(
            result_published_at=timezone.now() - timedelta(days=4)
        )
        assert result_services.notify_visible_results() == 2
        for _ in range(3):
            assert result_services.notify_visible_results() == 0
        assert len(notes()) == 2

    def test_backlog_is_drained_in_bounded_runs(self):
        set_rollout(timezone.now() - timedelta(days=30))
        exam = published(fresh_subject(), result_visibility="manual")
        for _ in range(5):
            take(make_student(), exam, "c--")
        Exam.objects.filter(pk=exam.pk).update(
            result_published_at=timezone.now() - timedelta(days=6)
        )
        sent = [
            result_services.notify_visible_results(batch_size=2, max_batches=1) for _ in range(4)
        ]
        assert sent == [2, 2, 1, 0]  # at most batch_size × max_batches per run
        assert len(notes()) == 5

    def test_missing_boundary_sends_nothing(self, student):
        exam = published(fresh_subject(), result_visibility="manual")
        take(student, exam, "c--")
        Exam.objects.filter(pk=exam.pk).update(result_published_at=timezone.now())
        NotificationRollout.objects.all().delete()
        assert result_services.notify_visible_results() == 0
        assert notes() == []


class TestIdentifiers:
    """Responses carry public UUIDs only — never an internal primary key or source_id."""

    def _leaves(self, value):
        if isinstance(value, dict):
            for item in value.values():
                yield from self._leaves(item)
        elif isinstance(value, list):
            for item in value:
                yield from self._leaves(item)
        else:
            yield value

    def _assert_public_only(self, row, internal_ids):
        for leaf in self._leaves(row):
            assert leaf is None or isinstance(leaf, (str, bool)), leaf
            assert not (isinstance(leaf, str) and leaf in internal_ids), leaf
        for key in ("pk", "user", "user_id", "source_id", "params", "result_id", "exam_id"):
            assert key not in json.dumps(row)

    def test_list_detail_and_targets_use_public_ids(self, student, package):
        payment = paid(student, package)
        exam = published(fresh_subject(), result_visibility="immediate")
        attempt = take(student, exam, "c--")
        result = Result.objects.get(attempt=attempt)
        rows = notes(student)
        assert len(rows) == 2
        internal_ids = {
            str(value)
            for value in (
                student.pk,
                payment.pk,
                package.pk,
                attempt.pk,
                result.pk,
                exam.pk,
                *(n.pk for n in rows),
                *(n.source_id for n in rows),
            )
        }
        client = jwt_client(student)
        body = client.get(ME).json()
        targets = {}
        for row in body["results"]:
            self._assert_public_only(row, internal_ids)
            detail = client.get(f"{ME}{row['id']}/").json()
            self._assert_public_only(detail, internal_ids)
            assert detail == row
            targets[row["type"]] = row["target"]
        assert {r["id"] for r in body["results"]} == {str(n.public_id) for n in rows}
        assert targets["payment_success"] == {
            "type": "payment",
            "payment_id": str(payment.public_id),
        }
        assert targets["result_published"] == {
            "type": "result",
            "attempt_id": str(attempt.public_id),
        }
        read = client.post(f"{ME}{rows[0].public_id}/read/").json()
        self._assert_public_only(read, internal_ids)


class TestApi:
    def make(self, user, n=3):
        rows = [
            services.build(
                user.pk,
                NotificationType.RESULT_PUBLISHED,
                next(_n),
                {"attempt_id": "", "exam_slug": f"e{i}", "exam_title_en": f"Exam {i}"},
            )
            for i in range(n)
        ]
        for row in rows:
            row.save()
        return rows

    def test_own_list_paginated_newest_first(self, student):
        self.make(student, 3)
        self.make(make_student(), 2)
        body = jwt_client(student).get(ME, HTTP_ACCEPT_LANGUAGE="en").json()
        assert body["count"] == 3
        assert [r["message"] for r in body["results"]] == [
            "Your result for “Exam 2” is now available.",
            "Your result for “Exam 1” is now available.",
            "Your result for “Exam 0” is now available.",
        ]
        row = body["results"][0]
        assert set(row) == {
            "id",
            "type",
            "title",
            "message",
            "target",
            "is_read",
            "created_at",
            "read_at",
        }
        assert row["target"] is None  # no attempt id → no navigation
        dumped = json.dumps(body)
        for hidden in ("user", "params", "source_id", '"pk"'):
            assert hidden not in dumped

    def test_detail_and_idor(self, student):
        mine = self.make(student, 1)[0]
        theirs = self.make(make_student(), 1)[0]
        client = jwt_client(student)
        assert client.get(f"{ME}{mine.public_id}/").status_code == 200
        assert client.get(f"{ME}{theirs.public_id}/").status_code == 404
        assert client.post(f"{ME}{theirs.public_id}/read/").status_code == 404
        assert Notification.objects.get(pk=theirs.pk).read_at is None
        assert client.get(f"{ME}00000000-0000-0000-0000-000000000000/").status_code == 404

    def test_mark_read_is_idempotent(self, student):
        note = self.make(student, 1)[0]
        client = jwt_client(student)
        first = client.post(f"{ME}{note.public_id}/read/", {"read_at": "2000-01-01T00:00:00Z"})
        assert first.status_code == 200 and first.json()["is_read"] is True
        read_at = Notification.objects.get(pk=note.pk).read_at
        assert read_at.year != 2000  # client cannot choose it
        second = client.post(f"{ME}{note.public_id}/read/")
        assert second.json()["read_at"] == first.json()["read_at"]
        assert Notification.objects.get(pk=note.pk).read_at == read_at

    def test_read_all_and_filter(self, student):
        notes_ = self.make(student, 3)
        other = self.make(make_student(), 2)
        client = jwt_client(student)
        client.post(f"{ME}{notes_[0].public_id}/read/")
        assert client.get(ME, {"is_read": "false"}).json()["count"] == 2
        assert client.get(ME, {"is_read": "true"}).json()["count"] == 1
        assert client.get(ME, {"is_read": "maybe"}).status_code == 400
        assert client.post(f"{ME}read-all/").json() == {"updated": 2}
        assert client.post(f"{ME}read-all/").json() == {"updated": 0}
        assert not Notification.objects.filter(user=student, read_at__isnull=True).exists()
        assert Notification.objects.filter(pk__in=[o.pk for o in other], read_at=None).count() == 2

    def test_no_write_endpoints(self, student):
        note = self.make(student, 1)[0]
        client = jwt_client(student)
        assert client.post(ME, {"type": "payment_success"}, format="json").status_code == 405
        url = f"{ME}{note.public_id}/"
        for method in ("put", "patch", "delete"):
            response = getattr(client, method)(url, {"type": "x", "params": {}}, format="json")
            assert response.status_code == 405
        assert client.get(f"{ME}{note.public_id}/read/").status_code == 405
        assert Notification.objects.get(pk=note.pk).type == "result_published"

    def test_anonymous_and_admin_rejected(self, student):
        note = self.make(student, 1)[0]
        assert APIClient().get(ME).status_code == 401
        assert APIClient().post(f"{ME}{note.public_id}/read/").status_code == 401
        admin = User.objects.create_user(
            "01699999998", password="x-Strong-2026", full_name="Ops", role=Role.ADMIN
        )
        session = APIClient()
        session.force_login(admin)
        assert session.get(ME).status_code == 401  # admin sessions are not student auth


# ======================================================================================
# Concurrency (PostgreSQL)
# ======================================================================================
@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_concurrent_payment_success_one_notification(run):
    student = make_student()
    package = make_package(f"cc-n{run}-{next(_n)}", rules=all_paid())
    payment = initiate(student, package)
    val_id = pay_mock(payment)
    verified = get_gateway("mock").query(payment)
    results = _run_concurrently(
        lambda: mock_callback(payment, val_id=val_id),
        lambda: post_form(ipn_url(), {"tran_id": payment.merchant_reference, "val_id": val_id}),
        lambda: payments.apply_verification(payment.pk, verified, source="test"),
    )
    assert not any(isinstance(r, Exception) for r in results), results
    assert Notification.objects.filter(user=student, type="payment_success").count() == 1


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_concurrent_result_publication_one_notification(run):
    set_rollout(timezone.now() - timedelta(days=1))  # a transactional flush drops the row
    exam = published(fresh_subject(), result_visibility="manual")
    students = [make_student() for _ in range(3)]
    for user in students:
        take(user, exam, "c--")
    Exam.objects.filter(pk=exam.pk).update(result_published_at=timezone.now())
    results = _run_concurrently(
        *[lambda: result_services.notify_visible_results(exam_id=exam.pk)] * 3,
        result_services.notify_visible_results,
    )
    assert not any(isinstance(r, Exception) for r in results), results
    assert Notification.objects.filter(type="result_published").count() == 3
    for user in students:
        assert Notification.objects.filter(user=user).count() == 1


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(2))
def test_concurrent_late_recovery_one_notification(run):
    student = make_student()
    package = make_package(f"cc-l{run}-{next(_n)}", rules=all_paid())
    payment = close(initiate(student, package))
    val_id = pay_mock(payment, "success")
    verified = get_gateway("mock").query(payment)
    results = _run_concurrently(
        lambda: mock_callback(payment, val_id=val_id),
        lambda: payments.apply_verification(payment.pk, verified, source="test"),
    )
    assert not any(isinstance(r, Exception) for r in results), results
    assert Notification.objects.filter(user=student, type="payment_success").count() == 1


def test_error_result_does_not_notify(student, package):
    payment = initiate(student, package)
    payments.apply_verification(
        payment.pk, VerificationResult(outcome=Outcome.ERROR, reason="timeout"), source="t"
    )
    assert notes() == []
