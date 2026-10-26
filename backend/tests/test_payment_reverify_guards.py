"""Admin payment re-verify guards: a successful payment is final, and at most one
provider query per payment per ``PAYMENT_REVERIFY_COOLDOWN_SECONDS`` (atomic claim)."""

import itertools
import threading
from datetime import timedelta
from decimal import Decimal
from unittest import mock

import pytest
from django.core.cache import cache
from django.db import connection
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.audit.models import AuditLog
from apps.audit.services import AuditContext
from apps.payments import services
from apps.payments.exceptions import PaymentError
from apps.payments.gateways.mock import MockGateway
from apps.payments.models import Payment
from tests.test_payments import close, code, events, initiate, pay_mock, refreshed
from tests.test_subscriptions import all_paid, make_package, make_student

pytestmark = pytest.mark.django_db

ADMIN = "/api/v1/admin/payments/"
COOLDOWN = 60
_slugs = itertools.count(1)


@pytest.fixture(autouse=True)
def _payment_settings(settings, tmp_path):
    """The mock provider, as in tests/test_payments.py."""
    settings.MEDIA_ROOT = str(tmp_path / "media")
    settings.PAYMENT_PROVIDER = "mock"
    settings.PAYMENT_MOCK_ALLOWED = True
    settings.PAYMENT_CALLBACK_BASE_URL = "https://api.test"
    settings.PAYMENT_RETURN_URL = "https://app.test/payment-return"
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def student():
    return make_student(full_name="Rahim Hossain")


@pytest.fixture
def package():
    return make_package(f"rv-{next(_slugs)}", rules=all_paid(), price=Decimal("500.00"))


@pytest.fixture
def admin_client():
    admin = User.objects.create_user(
        "01612345678", password="Strong-Pass-2026", full_name="Ops", role=Role.ADMIN
    )
    client = APIClient()
    client.force_login(admin)
    return client


@pytest.fixture
def cooldown(settings):
    settings.PAYMENT_REVERIFY_COOLDOWN_SECONDS = COOLDOWN


@pytest.fixture
def spy():
    """Counts real provider queries (the mock gateway keeps working)."""
    with mock.patch.object(
        MockGateway, "query", autospec=True, side_effect=MockGateway.query
    ) as query:
        yield query


def reverify(client, payment, **headers):
    return client.post(f"{ADMIN}{payment.public_id}/reverify/", **headers)


def age_check(payment, seconds):
    Payment.objects.filter(pk=payment.pk).update(
        last_checked_at=timezone.now() - timedelta(seconds=seconds)
    )


def audits():
    return AuditLog.objects.filter(action="payment.reverify")


class TestSuccessfulIsFinal:
    def test_success_is_refused_without_asking_the_provider(
        self, admin_client, student, package, spy
    ):
        payment = initiate(student, package)
        pay_mock(payment)
        assert reverify(admin_client, payment).json()["status"] == "success"
        checked = refreshed(payment).last_checked_at
        calls, reverify_events = spy.call_count, len(events(payment, "admin_reverify"))
        response = reverify(admin_client, payment)
        assert response.status_code == 409 and code(response) == "already_successful"
        assert spy.call_count == calls  # no provider query
        assert len(events(payment, "admin_reverify")) == reverify_events
        assert audits().count() == 1  # only the first (successful) re-verify
        assert refreshed(payment).last_checked_at == checked

    def test_message_in_bangla(self, admin_client, student, package):
        payment = initiate(student, package)
        pay_mock(payment)
        reverify(admin_client, payment)
        response = reverify(admin_client, payment, HTTP_ACCEPT_LANGUAGE="bn")
        assert response.json()["error"]["message"] == (
            "এই পেমেন্ট ইতিমধ্যে সফল; আবার যাচাই করার কিছু নেই।"
        )

    @pytest.mark.parametrize("result", ["fail", "cancel"])
    def test_failed_and_cancelled_can_still_recover(
        self, admin_client, student, package, cooldown, result
    ):
        payment = close(initiate(student, package), result)
        pay_mock(payment, "success")  # the provider later says it was paid
        age_check(payment, COOLDOWN + 1)  # the closing callback was a provider check
        response = reverify(admin_client, payment)
        assert response.status_code == 200 and response.json()["status"] == "success"
        assert refreshed(payment).subscription_id is not None


class TestCooldown:
    def test_second_reverify_within_the_cooldown_is_429(
        self, admin_client, student, package, cooldown, spy
    ):
        payment = initiate(student, package)
        first = reverify(admin_client, payment)
        assert first.status_code == 200 and first.json()["status"] == "pending"
        second = reverify(admin_client, payment, HTTP_ACCEPT_LANGUAGE="en")
        assert second.status_code == 429 and code(second) == "reverify_too_soon"
        retry_after = int(second["Retry-After"])
        assert 1 <= retry_after <= COOLDOWN
        assert f"{retry_after} seconds" in second.json()["error"]["message"]
        assert spy.call_count == 1
        assert audits().count() == 1
        assert len(events(payment, "admin_reverify")) == 1

    def test_allowed_again_after_the_cooldown(self, admin_client, student, package, cooldown, spy):
        payment = initiate(student, package)
        reverify(admin_client, payment)
        age_check(payment, COOLDOWN)
        pay_mock(payment)
        response = reverify(admin_client, payment)
        assert response.status_code == 200 and response.json()["status"] == "success"
        assert spy.call_count == 2 and audits().count() == 2

    def test_a_recent_callback_or_reconciliation_check_counts(
        self, admin_client, student, package, cooldown, spy
    ):
        payment = initiate(student, package)
        age_check(payment, 10)  # e.g. the reconciliation job asked the provider 10 s ago
        response = reverify(admin_client, payment)
        assert response.status_code == 429
        assert 49 <= int(response["Retry-After"]) <= 50
        assert spy.call_count == 0

    def test_never_checked_payment_is_allowed(self, admin_client, student, package, cooldown):
        payment = initiate(student, package)
        Payment.objects.filter(pk=payment.pk).update(last_checked_at=None)
        assert reverify(admin_client, payment).status_code == 200

    def test_message_in_bangla(self, admin_client, student, package, cooldown):
        payment = initiate(student, package)
        reverify(admin_client, payment)
        response = reverify(admin_client, payment, HTTP_ACCEPT_LANGUAGE="bn")
        seconds = response["Retry-After"]
        assert response.json()["error"]["message"] == (
            f"এই পেমেন্টটি কিছুক্ষণ আগে প্রোভাইডারের কাছে যাচাই করা হয়েছে। {seconds} সেকেন্ড পরে আবার চেষ্টা করুন।"
        )

    def test_disabled_provider_does_not_use_up_the_slot(
        self, settings, admin_client, student, package, cooldown
    ):
        payment = initiate(student, package)
        age_check(payment, COOLDOWN + 1)
        before = refreshed(payment).last_checked_at
        settings.PAYMENT_MOCK_ALLOWED = False
        response = reverify(admin_client, payment)
        assert response.status_code == 409 and code(response) == "provider_disabled"
        assert refreshed(payment).last_checked_at == before

    def test_zero_cooldown_disables_the_limit(self, admin_client, student, package, settings):
        settings.PAYMENT_REVERIFY_COOLDOWN_SECONDS = 0
        payment = initiate(student, package)
        assert [reverify(admin_client, payment).status_code for _ in range(3)] == [200] * 3

    def test_service_refusals_carry_codes(self, student, package, cooldown):
        payment = initiate(student, package)
        services.admin_reverify(payment.public_id, ctx=AuditContext())
        with pytest.raises(PaymentError) as exc:
            services.admin_reverify(payment.public_id, ctx=AuditContext())
        assert (exc.value.code, exc.value.status) == ("reverify_too_soon", 429)
        assert 1 <= exc.value.retry_after <= COOLDOWN


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_concurrent_reverifies_query_the_provider_once(run, settings, student, package):
    settings.PAYMENT_REVERIFY_COOLDOWN_SECONDS = COOLDOWN
    admin = User.objects.create_user(
        f"0161234{run}777", password="Strong-Pass-2026", full_name="Ops", role=Role.ADMIN
    )
    payment = initiate(student, package)
    age_check(payment, COOLDOWN + 1)
    barrier = threading.Barrier(3)
    statuses = []

    def click():
        client = APIClient()
        client.force_login(admin)
        barrier.wait()
        statuses.append(reverify(client, payment).status_code)
        connection.close()

    with mock.patch.object(
        MockGateway, "query", autospec=True, side_effect=MockGateway.query
    ) as query:
        threads = [threading.Thread(target=click) for _ in range(3)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
    assert sorted(statuses) == [200, 429, 429]
    assert query.call_count == 1
    assert audits().count() == 1
    assert len(events(payment, "admin_reverify")) == 1
