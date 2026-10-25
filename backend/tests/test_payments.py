"""Milestone 5: payments, gateways (mock + SSLCommerz), subscription activation, jobs."""

import hashlib
import itertools
import json
import logging
import urllib.error
import urllib.parse
from datetime import timedelta
from decimal import Decimal
from io import BytesIO
from unittest import mock

import pytest
from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured
from django.db import IntegrityError, connection, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.audit.models import AuditLog
from apps.payments import services
from apps.payments.gateways import Outcome, VerificationResult, get_gateway, sslcommerz
from apps.payments.gateways import mock as mock_gateway
from apps.payments.gateways.base import GatewayError
from apps.payments.models import (
    Payment,
    PaymentEvent,
    PaymentEventImmutable,
    PaymentEventType,
    PaymentStatus,
)
from apps.payments.sanitize import sanitize
from apps.subscriptions import services as subscription_services
from apps.subscriptions.models import Package, Subscription
from apps.subscriptions.selectors import user_can_access_exam
from config.settings.checks import validate_payment_settings
from tests.test_attempts import _run_concurrently
from tests.test_exams import make_category, make_exam, make_subject
from tests.test_subscriptions import CTX, all_paid, jwt_client, make_package, make_student

pytestmark = pytest.mark.django_db

PAYMENTS = "/api/v1/payments/"
ADMIN = "/api/v1/admin/payments/"
STORE_PASSWORD = "test-store-pass-123"  # test-only value
RETURN_URL = "https://app.test/payment-return"
_slugs = itertools.count(1)


def callback_url(kind, provider="mock"):
    return f"{PAYMENTS}callback/{provider}/{kind}/"


def ipn_url(provider="mock"):
    return f"{PAYMENTS}ipn/{provider}/"


@pytest.fixture(autouse=True)
def _payment_settings(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "media")
    settings.PAYMENT_PROVIDER = "mock"
    settings.PAYMENT_MOCK_ALLOWED = True
    settings.PAYMENT_CALLBACK_BASE_URL = "https://api.test"
    settings.PAYMENT_RETURN_URL = RETURN_URL
    settings.SSLCOMMERZ_STORE_ID = "teststore"
    settings.SSLCOMMERZ_STORE_PASSWORD = STORE_PASSWORD
    settings.SSLCOMMERZ_SANDBOX = True
    settings.PAYMENT_RECONCILE_MIN_AGE_SECONDS = 900
    settings.PAYMENT_ABANDON_AFTER_SECONDS = 86400
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def student():
    return make_student(full_name="Rahim Hossain", email="rahim@example.org")


@pytest.fixture
def package():
    return make_package(f"gold-{next(_slugs)}", rules=all_paid(), price=Decimal("500.00"))


@pytest.fixture
def paid_exam():
    n = next(_slugs)
    subject = make_subject(f"s-pay-{n}", category=make_category(f"c-pay-{n}"))
    return make_exam(subject, access_type="paid")


@pytest.fixture
def admin_client():
    admin = User.objects.create_user(
        "01612345678", password="Strong-Pass-2026", full_name="Ops", role=Role.ADMIN
    )
    client = APIClient()
    client.force_login(admin)
    return client


def initiate(user, package, key=""):
    payment, _created = services.initiate_payment(user, package.pk, idempotency_key=key)
    return payment


def post_form(url, data):
    return APIClient().post(
        url, urllib.parse.urlencode(data), content_type="application/x-www-form-urlencoded"
    )


def pay_mock(payment, result="success", **override):
    """The student completes (or not) the mock checkout; returns the val_id."""
    return mock_gateway.complete(payment.merchant_reference, result, **override)


def mock_callback(payment, kind="success", val_id=""):
    return post_form(callback_url(kind), {"tran_id": payment.merchant_reference, "val_id": val_id})


def refreshed(payment):
    payment.refresh_from_db()
    return payment


def events(payment, event_type=None):
    queryset = PaymentEvent.objects.filter(payment=payment)
    if event_type:
        queryset = queryset.filter(event_type=event_type)
    return list(queryset)


def all_text(payment) -> str:
    rows = [e.payload for e in events(payment)] + [payment.raw_verification]
    return json.dumps(rows)


def code(response):
    return response.json()["error"]["code"]


# ======================================================================================
# Database
# ======================================================================================
class TestDatabase:
    def test_success_requires_proof_and_subscription(self, student, package):
        payment = initiate(student, package)
        with pytest.raises(IntegrityError), transaction.atomic():
            Payment.objects.filter(pk=payment.pk).update(status=PaymentStatus.SUCCESS)

    def test_subscription_link_requires_success(self, student, package):
        payment = initiate(student, package)
        subscription = subscription_services.grant_subscription(
            student.pk, package.pk, ctx=CTX
        ).subscription
        with pytest.raises(IntegrityError), transaction.atomic():
            Payment.objects.filter(pk=payment.pk).update(subscription=subscription)

    def test_provider_transaction_id_unique_when_present(self, student, package):
        first, second = initiate(student, package), initiate(student, package)
        Payment.objects.filter(pk=first.pk).update(provider_transaction_id="TX1")
        with pytest.raises(IntegrityError), transaction.atomic():
            Payment.objects.filter(pk=second.pk).update(provider_transaction_id="TX1")
        # NULL (not yet verified) is allowed many times.
        assert Payment.objects.filter(provider_transaction_id__isnull=True).count() == 1

    def test_amount_must_be_positive(self, student, package):
        # Checked on insert (after creation the snapshot trigger refuses any change).
        with pytest.raises(IntegrityError), transaction.atomic():
            Payment.objects.create(
                merchant_reference=services.new_reference(),
                user=student,
                package=package,
                provider="mock",
                amount=Decimal("0"),
                currency=package.currency,
                validity_days=package.validity_days,
            )

    def test_events_are_append_only(self, student, package):
        payment = initiate(student, package)
        event = events(payment)[0]
        with pytest.raises(PaymentEventImmutable):
            event.save()
        with pytest.raises(PaymentEventImmutable):
            event.delete()
        with pytest.raises(PaymentEventImmutable):
            PaymentEvent.objects.filter(pk=event.pk).update(payload={})
        with pytest.raises(PaymentEventImmutable):
            PaymentEvent.objects.filter(pk=event.pk).delete()
        with pytest.raises(Exception, match="append-only"), transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE payments_paymentevent SET payload = '{}' WHERE id = %s", [event.pk]
                )
        with pytest.raises(Exception, match="append-only"), transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute("DELETE FROM payments_paymentevent WHERE id = %s", [event.pk])

    def test_no_payment_column_on_subscriptions(self):
        assert "payment" not in {f.name for f in Subscription._meta.concrete_fields}
        assert Payment._meta.get_field("subscription").remote_field.on_delete.__name__ == "PROTECT"

    def test_status_values_match_docs(self):
        assert PaymentStatus.values == ["initiated", "pending", "success", "failed", "cancelled"]


# ======================================================================================
# Initiation
# ======================================================================================
class TestInitiation:
    def test_initiate_snapshots_server_price(self, student, package):
        response = jwt_client(student).post(
            PAYMENTS,
            {"package_id": package.pk, "amount": "1.00", "price": "1.00", "currency": "USD"},
            format="json",
        )
        assert response.status_code == 201, response.content
        body = response.json()
        assert body["status"] == "pending"
        assert body["amount"] == "500.00" and body["currency"] == "BDT"
        assert body["checkout_url"].startswith("https://api.test/api/v1/payments/mock/checkout/")
        assert set(body) == {
            "payment_id",
            "merchant_reference",
            "status",
            "provider",
            "amount",
            "currency",
            "package",
            "checkout_url",
            "transaction_id",
            "verified_at",
            "created_at",
            "updated_at",
        }
        payment = Payment.objects.get(public_id=body["payment_id"])
        assert payment.amount == Decimal("500.00") and payment.user == student
        assert len(payment.merchant_reference) <= 30
        assert [e.event_type for e in events(payment)] == [
            PaymentEventType.INITIATED,
            PaymentEventType.STATUS_CHANGED,
        ]

    def test_references_are_unique_and_unguessable(self, student, package):
        refs = {initiate(student, package).merchant_reference for _ in range(5)}
        assert len(refs) == 5
        assert all(ref.startswith("MCQ") and len(ref) == 27 for ref in refs)

    def test_inactive_package_refused(self, student, package):
        Package.objects.filter(pk=package.pk).update(status="inactive")
        response = jwt_client(student).post(PAYMENTS, {"package_id": package.pk}, format="json")
        assert response.status_code == 409 and code(response) == "package_inactive"
        assert not Payment.objects.exists()

    def test_free_package_refused(self, student):
        free = make_package("free-pack", price=Decimal("0.00"))
        response = jwt_client(student).post(PAYMENTS, {"package_id": free.pk}, format="json")
        assert response.status_code == 409 and code(response) == "package_not_purchasable"

    def test_unknown_or_missing_package(self, student):
        client = jwt_client(student)
        response = client.post(PAYMENTS, {"package_id": 999999}, format="json")
        assert response.status_code == 400
        assert "package_id" in response.json()["error"]["field_errors"]
        assert client.post(PAYMENTS, {}, format="json").status_code == 400

    def test_only_active_students(self, student, package):
        admin = User.objects.create_user(
            "01699999999", password="x-Strong-2026", full_name="Ops", role=Role.ADMIN
        )
        with pytest.raises(services.PaymentError) as exc:
            services.initiate_payment(admin, package.pk)
        assert exc.value.code == "not_student"
        student.is_active = False
        student.save()
        with pytest.raises(services.PaymentError):
            services.initiate_payment(student, package.pk)
        assert APIClient().post(PAYMENTS, {"package_id": package.pk}).status_code == 401

    def test_idempotency_key(self, student, package):
        client = jwt_client(student)
        first = client.post(
            PAYMENTS, {"package_id": package.pk}, format="json", HTTP_IDEMPOTENCY_KEY="buy-1"
        )
        again = client.post(
            PAYMENTS, {"package_id": package.pk}, format="json", HTTP_IDEMPOTENCY_KEY="buy-1"
        )
        assert first.status_code == 201 and again.status_code == 200
        assert first.json()["payment_id"] == again.json()["payment_id"]
        assert again.json()["checkout_url"] == first.json()["checkout_url"]
        other = make_package("silver", rules=all_paid())
        conflict = client.post(
            PAYMENTS, {"package_id": other.pk}, format="json", HTTP_IDEMPOTENCY_KEY="buy-1"
        )
        assert conflict.status_code == 409 and code(conflict) == "idempotency_key_reused"
        bad = client.post(
            PAYMENTS, {"package_id": package.pk}, format="json", HTTP_IDEMPOTENCY_KEY="bad key!"
        )
        assert bad.status_code == 400
        assert Payment.objects.count() == 1
        # Another student may use the same key independently.
        response = jwt_client(make_student()).post(
            PAYMENTS, {"package_id": package.pk}, format="json", HTTP_IDEMPOTENCY_KEY="buy-1"
        )
        assert response.status_code == 201

    def test_gateway_failure_fails_payment_without_access(self, student, package, paid_exam):
        with mock.patch.object(
            mock_gateway.MockGateway, "initiate", side_effect=GatewayError("timeout")
        ):
            response = jwt_client(student).post(PAYMENTS, {"package_id": package.pk}, format="json")
        assert response.status_code == 503 and code(response) == "payment_unavailable"
        payment = Payment.objects.get()
        assert payment.status == "failed" and payment.failure_reason == "initiation_failed"
        assert str(payment.public_id) == response.json()["error"]["details"]["payment_id"]
        assert not Subscription.objects.exists()
        assert not user_can_access_exam(student, paid_exam)

    def test_disabled_provider_unavailable(self, settings, student, package):
        settings.PAYMENT_MOCK_ALLOWED = False
        response = jwt_client(student).post(PAYMENTS, {"package_id": package.pk}, format="json")
        assert response.status_code == 503 and code(response) == "payment_unavailable"
        assert not Payment.objects.exists()

    def test_throttled_per_student(self, settings, student, package):
        settings.AUTH_THROTTLE_RATES = {**settings.AUTH_THROTTLE_RATES, "payment_init": "2/hour"}
        client = jwt_client(student)
        statuses = [
            client.post(PAYMENTS, {"package_id": package.pk}, format="json").status_code
            for _ in range(3)
        ]
        assert statuses == [201, 201, 429]
        assert client.get(PAYMENTS).status_code == 200  # reading is not throttled

    def test_bangla_error_message(self, student, package):
        Package.objects.filter(pk=package.pk).update(status="inactive")
        response = jwt_client(student).post(
            PAYMENTS, {"package_id": package.pk}, format="json", HTTP_ACCEPT_LANGUAGE="bn"
        )
        assert response.json()["error"]["message"] == "এই প্যাকেজটি এখন বিক্রি হচ্ছে না।"


# ======================================================================================
# Mock gateway end to end
# ======================================================================================
class TestMockFlow:
    def test_verified_success_activates_subscription(self, student, package, paid_exam):
        payment = initiate(student, package)
        assert not user_can_access_exam(student, paid_exam)
        val_id = pay_mock(payment)
        response = mock_callback(payment, val_id=val_id)
        assert response.status_code == 302
        location = urllib.parse.urlparse(response["Location"])
        assert response["Location"].startswith(RETURN_URL + "?")
        assert urllib.parse.parse_qs(location.query) == {
            "status": ["success"],
            "payment": [str(payment.public_id)],
        }
        payment = refreshed(payment)
        assert payment.status == "success" and payment.verified_at is not None
        assert payment.provider_transaction_id.startswith("MOCKTXN")
        subscription = payment.subscription
        assert subscription.user == student and subscription.package == package
        assert subscription.price_paid == Decimal("500.00")
        assert user_can_access_exam(student, paid_exam)
        types = [e.event_type for e in events(payment)]
        assert types[-4:] == [
            "callback_received",
            "verify_request",
            "verify_response",
            "status_changed",
        ]

    def test_full_http_flow_through_mock_checkout_page(self, student, package, paid_exam):
        body = jwt_client(student).post(PAYMENTS, {"package_id": package.pk}, format="json").json()
        checkout = urllib.parse.urlparse(body["checkout_url"])
        page = APIClient().get(checkout.path, {"result": "success"})
        assert page.status_code == 302
        target = urllib.parse.urlparse(page["Location"])
        assert target.netloc == "api.test" and target.path == callback_url("success")
        response = APIClient().get(target.path + "?" + target.query)
        assert response.status_code == 302 and "status=success" in response["Location"]
        status = jwt_client(student).get(f"{PAYMENTS}{body['payment_id']}/").json()
        assert status["status"] == "success" and status["checkout_url"] is None
        assert status["transaction_id"]
        assert user_can_access_exam(student, paid_exam)

    @pytest.mark.parametrize(("result", "expected"), [("fail", "failed"), ("cancel", "cancelled")])
    def test_fail_and_cancel(self, student, package, paid_exam, result, expected):
        payment = initiate(student, package)
        val_id = pay_mock(payment, result)
        response = mock_callback(payment, result, val_id)
        assert f"status={expected}" in response["Location"]
        payment = refreshed(payment)
        assert payment.status == expected and payment.subscription is None
        assert not user_can_access_exam(student, paid_exam)

    def test_fake_success_callback_without_payment(self, student, package, paid_exam):
        payment = initiate(student, package)  # never paid at the provider
        response = mock_callback(payment, "success", "")
        assert "status=pending" in response["Location"]
        forged = mock_callback(payment, "success", "MOCKVALFORGED")
        assert "status=pending" in forged["Location"]
        assert refreshed(payment).status == "pending"
        assert not Subscription.objects.exists()
        assert not user_can_access_exam(student, paid_exam)

    def test_unknown_reference(self, student, package):
        initiate(student, package)
        response = post_form(callback_url("success"), {"tran_id": "MCQNOPE", "val_id": "X"})
        assert response.status_code == 302
        assert urllib.parse.parse_qs(urllib.parse.urlparse(response["Location"]).query) == {
            "status": ["unknown"]
        }
        assert not Subscription.objects.exists()

    def test_replayed_success_callback_grants_once(self, student, package):
        payment = initiate(student, package)
        val_id = pay_mock(payment)
        mock_callback(payment, val_id=val_id)
        subscription = refreshed(payment).subscription
        expires = subscription.expires_at
        for _ in range(3):
            assert "status=success" in mock_callback(payment, val_id=val_id)["Location"]
            post_form(ipn_url(), {"tran_id": payment.merchant_reference, "val_id": val_id})
        assert Subscription.objects.count() == 1
        subscription.refresh_from_db()
        assert subscription.expires_at == expires
        assert subscription.price_paid == Decimal("500.00")
        assert AuditLog.objects.filter(action__startswith="subscription.").count() == 1
        assert len(events(payment, "status_changed")) == 2  # → pending, → success

    def test_ipn_then_callback(self, student, package):
        payment = initiate(student, package)
        val_id = pay_mock(payment)
        response = post_form(ipn_url(), {"tran_id": payment.merchant_reference, "val_id": val_id})
        assert response.status_code == 200 and response.json() == {"status": "received"}
        assert refreshed(payment).status == "success"
        mock_callback(payment, val_id=val_id)
        assert Subscription.objects.count() == 1
        assert len(events(payment, "ipn_received")) == 1

    def test_ipn_is_stable_for_unknown_and_bad_input(self):
        for data in ({}, {"tran_id": "MCQX"}, {"tran_id": "x" * 500, "val_id": "<script>"}):
            response = post_form(ipn_url(), data)
            assert response.status_code == 200 and response.json() == {"status": "received"}
        assert APIClient().get(ipn_url()).status_code == 405
        response = post_form(ipn_url("bkash"), {"tran_id": "MCQX"})
        assert response.status_code == 200

    @pytest.mark.parametrize(
        ("override", "reason"),
        [
            ({"amount": "1.00"}, "amount_mismatch"),
            ({"amount": "500.01"}, "amount_mismatch"),
            ({"amount": "abc"}, "amount_mismatch"),
            ({"currency": "USD"}, "currency_mismatch"),
        ],
    )
    def test_tampered_amount_or_currency_fails(self, student, package, paid_exam, override, reason):
        payment = initiate(student, package)
        val_id = pay_mock(payment, **override)
        response = mock_callback(payment, val_id=val_id)
        assert "status=failed" in response["Location"]
        payment = refreshed(payment)
        assert payment.status == "failed" and payment.failure_reason == reason
        assert not Subscription.objects.exists()
        assert not user_can_access_exam(student, paid_exam)

    def test_val_id_of_another_payment_is_ignored(self, student, package):
        mine = initiate(student, package)
        other = initiate(make_student(), package)
        other_val = pay_mock(other)
        response = mock_callback(mine, val_id=other_val)  # replay someone else's proof
        assert "status=pending" in response["Location"]
        assert refreshed(mine).status == "pending"
        assert refreshed(other).status == "pending"  # untouched too
        assert events(mine, "verify_response")[-1].payload["reason"] == "reference_mismatch"
        assert not Subscription.objects.exists()

    def test_fail_or_cancel_after_success_changes_nothing(self, student, package):
        payment = initiate(student, package)
        val_id = pay_mock(payment)
        mock_callback(payment, val_id=val_id)
        for kind in ("fail", "cancel"):
            assert "status=success" in mock_callback(payment, kind, val_id)["Location"]
        assert refreshed(payment).status == "success"
        assert Subscription.objects.filter(status="active").count() == 1

    def test_forged_cancel_cannot_end_a_paid_payment(self, student, package, paid_exam):
        payment = initiate(student, package)
        pay_mock(payment)  # really paid at the provider
        response = mock_callback(payment, "cancel")  # forged/early cancel redirect
        assert "status=success" in response["Location"]  # provider says paid
        assert user_can_access_exam(student, paid_exam)

    def test_forged_cancel_while_unpaid_keeps_pending(self, student, package):
        payment = initiate(student, package)
        mock_callback(payment, "cancel")
        assert refreshed(payment).status == "pending"

    def test_provider_transaction_reused_for_another_payment(self, student, package):
        first, second = initiate(student, package), initiate(student, package)
        mock_callback(first, val_id=pay_mock(first, bank_tran_id="BANKTX1"))
        assert refreshed(first).status == "success"
        mock_callback(second, val_id=pay_mock(second, bank_tran_id="BANKTX1"))
        second = refreshed(second)
        assert second.status == "failed" and second.failure_reason == "duplicate_transaction"
        assert second.provider_transaction_id is None
        assert Subscription.objects.get().price_paid == Decimal("500.00")

    def test_price_change_after_initiation(self, student, package):
        payment = initiate(student, package)
        subscription_services.update_package(package.pk, {"price": Decimal("800.00")}, ctx=CTX)
        mock_callback(payment, val_id=pay_mock(payment))  # charged the original 500.00
        payment = refreshed(payment)
        assert payment.status == "success" and payment.amount == Decimal("500.00")
        assert payment.subscription.price_paid == Decimal("500.00")
        second = initiate(student, package)
        assert second.amount == Decimal("800.00")
        third = initiate(student, package)
        subscription_services.update_package(package.pk, {"price": Decimal("900.00")}, ctx=CTX)
        mock_callback(third, val_id=pay_mock(third, amount="900.00"))  # the *new* price
        assert refreshed(third).failure_reason == "amount_mismatch"

    def test_fractional_amount(self, student):
        package = make_package("frac", rules=all_paid(), price=Decimal("499.50"))
        payment = initiate(student, package)
        assert payment.amount == Decimal("499.50")
        mock_callback(payment, val_id=pay_mock(payment, amount="499.5"))
        assert refreshed(payment).status == "success"
        tampered = initiate(student, package)
        mock_callback(tampered, val_id=pay_mock(tampered, amount="499.49"))
        assert refreshed(tampered).failure_reason == "amount_mismatch"

    def test_callback_for_wrong_provider_path(self, student, package):
        payment = initiate(student, package)
        val_id = pay_mock(payment)
        response = post_form(
            callback_url("success", "sslcommerz"),
            {"tran_id": payment.merchant_reference, "val_id": val_id},
        )
        assert "status=unknown" in response["Location"]
        assert refreshed(payment).status == "pending"

    def test_without_return_url_answers_json(self, settings, student, package):
        settings.PAYMENT_RETURN_URL = ""
        payment = initiate(student, package)
        response = mock_callback(payment, val_id=pay_mock(payment))
        assert response.status_code == 200
        assert response.json() == {"status": "success", "payment": str(payment.public_id)}

    def test_app_scheme_return_url(self, settings, student, package):
        settings.PAYMENT_RETURN_URL = "mcqapp://payment-result"
        payment = initiate(student, package)
        response = mock_callback(payment, val_id=pay_mock(payment))
        assert response.status_code == 302
        assert response["Location"].startswith("mcqapp://payment-result?")

    def test_callback_cannot_choose_redirect(self, student, package):
        payment = initiate(student, package)
        response = post_form(
            callback_url("success"),
            {
                "tran_id": payment.merchant_reference,
                "val_id": pay_mock(payment),
                "next": "https://evil.test/",
                "return_url": "https://evil.test/",
            },
        )
        assert response["Location"].startswith(RETURN_URL + "?")

    def test_mock_checkout_page_rules(self, settings, student, package):
        payment = initiate(student, package)
        page = f"{PAYMENTS}mock/checkout/{payment.merchant_reference}/"
        assert APIClient().get(page).status_code == 400
        assert (
            APIClient().get(f"{PAYMENTS}mock/checkout/MCQUNKNOWN/?result=success").status_code
            == 404
        )
        settings.PAYMENT_MOCK_ALLOWED = False
        assert APIClient().get(page, {"result": "success"}).status_code == 404

    def test_callback_errors_never_leak(self, student, package):
        payment = initiate(student, package)
        with mock.patch.object(services, "apply_verification", side_effect=RuntimeError("boom")):
            response = mock_callback(payment, val_id=pay_mock(payment))
            ipn = post_form(ipn_url(), {"tran_id": payment.merchant_reference, "val_id": "x"})
        assert response.status_code == 302 and "status=unknown" in response["Location"]
        assert ipn.status_code == 200 and b"boom" not in ipn.content


# ======================================================================================
# Late provider-verified success of a failed/cancelled payment (recovery)
# ======================================================================================
def close(payment, result="fail"):
    """The provider reports the checkout failed/cancelled; our payment is closed."""
    mock_callback(payment, result, pay_mock(payment, result))
    payment = refreshed(payment)
    assert payment.status == {"fail": "failed", "cancel": "cancelled"}[result]
    return payment


def recovery_events(payment):
    return [
        e.payload
        for e in events(payment, "status_changed")
        if e.payload.get("reason") == "late_provider_success"
    ]


class TestLateSuccessRecovery:
    @pytest.mark.parametrize(("result", "closed"), [("fail", "failed"), ("cancel", "cancelled")])
    def test_closed_payment_recovers_when_provider_proves_payment(
        self, student, package, paid_exam, result, closed
    ):
        payment = close(initiate(student, package), result)
        assert not user_can_access_exam(student, paid_exam)
        val_id = pay_mock(payment, "success")  # the provider later confirms it was paid
        response = mock_callback(payment, val_id=val_id)
        assert "status=success" in response["Location"]
        payment = refreshed(payment)
        assert payment.status == "success" and payment.failure_reason == ""
        assert payment.verified_at and payment.provider_transaction_id.startswith("MOCKTXN")
        subscription = Subscription.objects.get()
        assert payment.subscription == subscription  # the real payment paid for the access
        assert subscription.price_paid == Decimal("500.00")
        assert user_can_access_exam(student, paid_exam)
        [event] = recovery_events(payment)
        assert event == {
            "from": closed,
            "to": "success",
            "reason": "late_provider_success",
            "previous_reason": closed,  # the mock reports no detailed reason
        }
        assert events(payment, "verify_response")[-1].payload["reason"] == "late_provider_success"
        audit = AuditLog.objects.get(action="payment.late_success_recover")
        assert audit.actor is None
        assert audit.metadata["changes"]["status"] == {"from": closed, "to": "success"}
        assert audit.metadata["values"]["subscription_id"] == subscription.pk
        assert not AuditLog.objects.filter(action="subscription.extend").exists()

    def test_repeated_late_verification_grants_once(self, student, package, admin_client):
        payment = close(initiate(student, package))
        val_id = pay_mock(payment, "success")
        for _ in range(3):
            mock_callback(payment, val_id=val_id)
            post_form(ipn_url(), {"tran_id": payment.merchant_reference, "val_id": val_id})
        admin_client.post(f"{ADMIN}{payment.public_id}/reverify/")
        assert Subscription.objects.count() == 1
        assert Subscription.objects.get().price_paid == Decimal("500.00")
        assert len(recovery_events(refreshed(payment))) == 1
        assert AuditLog.objects.filter(action="payment.late_success_recover").count() == 1

    def test_admin_reverify_recovers(self, student, package, admin_client):
        payment = close(initiate(student, package), "cancel")
        pay_mock(payment, "success")
        response = admin_client.post(f"{ADMIN}{payment.public_id}/reverify/")
        assert response.json()["status"] == "success"
        assert refreshed(payment).subscription_id == Subscription.objects.get().pk

    def test_callback_claim_without_provider_proof(self, student, package):
        payment = close(initiate(student, package))  # provider: FAILED
        for val_id in ("", "MOCKVALFORGED"):
            response = post_form(
                callback_url("success"),
                {"tran_id": payment.merchant_reference, "val_id": val_id, "status": "VALID"},
            )
            assert "status=failed" in response["Location"]
        post_form(ipn_url(), {"tran_id": payment.merchant_reference, "status": "VALID"})
        assert refreshed(payment).status == "failed"
        assert not Subscription.objects.exists()
        assert not recovery_events(payment)

    @pytest.mark.parametrize(
        ("override", "reason"),
        [
            ({"amount": "499.00"}, "late_success_amount_mismatch"),
            ({"currency": "USD"}, "late_success_currency_mismatch"),
        ],
    )
    def test_late_success_with_wrong_facts_is_left_for_review(
        self, student, package, override, reason, caplog
    ):
        payment = close(initiate(student, package))
        with caplog.at_level(logging.ERROR, logger="apps.payments.services"):
            mock_callback(payment, val_id=pay_mock(payment, "success", **override))
        payment = refreshed(payment)
        assert payment.status == "failed" and payment.failure_reason == "failed"
        assert payment.subscription is None and payment.provider_transaction_id is None
        assert events(payment, "verify_response")[-1].payload["reason"] == reason
        assert "rejected for review" in caplog.text
        assert not Subscription.objects.exists()

    def test_late_success_with_reused_transaction_id(self, student, package):
        other = initiate(make_student(), package)
        mock_callback(other, val_id=pay_mock(other, bank_tran_id="BANKTXREUSED"))
        payment = close(initiate(student, package))
        mock_callback(payment, val_id=pay_mock(payment, "success", bank_tran_id="BANKTXREUSED"))
        payment = refreshed(payment)
        assert payment.status == "failed" and payment.subscription is None
        reason = events(payment, "verify_response")[-1].payload["reason"]
        assert reason == "late_success_duplicate_transaction"
        assert Subscription.objects.count() == 1  # only the other student's

    def test_late_success_from_another_provider_or_reference(self, student, package):
        payment = close(initiate(student, package))
        foreign = VerificationResult(
            outcome=Outcome.PAID,
            provider="sslcommerz",
            merchant_reference=payment.merchant_reference,
            amount=payment.amount,
            currency="BDT",
            provider_transaction_id="TXFOREIGN",
        )
        services.apply_verification(payment.pk, foreign, source="test")
        other_ref = VerificationResult(
            outcome=Outcome.PAID,
            provider="mock",
            merchant_reference="MCQSOMEONEELSE",
            amount=payment.amount,
            currency="BDT",
            provider_transaction_id="TXOTHER",
        )
        services.apply_verification(payment.pk, other_ref, source="test")
        assert refreshed(payment).status == "failed"
        reasons = [e.payload["reason"] for e in events(payment, "verify_response")[-2:]]
        assert reasons == ["provider_mismatch", "reference_mismatch"]
        assert not Subscription.objects.exists()

    def test_late_success_extends_the_running_subscription(self, student, package):
        first = initiate(student, package)
        mock_callback(first, val_id=pay_mock(first))
        running = refreshed(first).subscription
        expires = running.expires_at
        late = close(initiate(student, package), "cancel")
        mock_callback(late, val_id=pay_mock(late, "success"))
        late = refreshed(late)
        assert late.status == "success" and late.subscription_id == running.pk
        running.refresh_from_db()
        assert running.expires_at == expires + timedelta(days=package.validity_days)
        assert running.price_paid == Decimal("1000.00")
        assert Subscription.objects.count() == 1

    def test_failed_or_cancelled_answers_never_reopen(self, student, package):
        payment = close(initiate(student, package))
        for outcome in (Outcome.CANCELLED, Outcome.PENDING, Outcome.NOT_FOUND, Outcome.ERROR):
            services.apply_verification(
                payment.pk,
                VerificationResult(
                    outcome=outcome, provider="mock", merchant_reference=payment.merchant_reference
                ),
                source="test",
            )
            assert refreshed(payment).status == "failed"


class TestRecoveryNeedsFreshProviderAnswer:
    """Late recovery is authorized only by a fresh server-to-server provider answer."""

    def test_recovery_asks_the_provider_and_obeys_it(self, student, package):
        payment = close(initiate(student, package))
        val_id = pay_mock(payment, "success")  # the ledger would say paid ...
        error = VerificationResult(outcome=Outcome.ERROR, reason="timeout")
        with mock.patch.object(mock_gateway.MockGateway, "verify", return_value=error) as verify:
            mock_callback(payment, val_id=val_id)  # ... but the live answer is an error
        assert verify.call_count == 1  # a fresh provider verification was requested
        assert refreshed(payment).status == "failed" and not Subscription.objects.exists()
        mock_callback(payment, val_id=val_id)  # fresh answer: paid → recovered
        assert refreshed(payment).status == "success"

    def test_fake_ipn_claiming_success(self, student, package):
        payment = close(initiate(student, package))
        for data in (
            {"tran_id": payment.merchant_reference, "status": "VALID", "amount": "500.00"},
            {"tran_id": payment.merchant_reference, "val_id": "MOCKVALFAKE", "status": "VALID"},
        ):
            assert post_form(ipn_url(), data).json() == {"status": "received"}
        assert refreshed(payment).status == "failed"
        assert not recovery_events(payment) and not Subscription.objects.exists()

    def test_fail_or_cancel_callback_cannot_recover_without_provider(self, student, package):
        payment = close(initiate(student, package))  # provider still says FAILED
        for kind in ("fail", "cancel"):
            mock_callback(payment, kind, "MOCKVALFAKE")
        assert refreshed(payment).status == "failed"

    def test_success_fields_alone_are_not_verification(self, student, package, paid_exam):
        payment = close(initiate(student, package))
        # Proof-looking fields written directly (not by the verification service).
        Payment.objects.filter(pk=payment.pk).update(
            verified_at=timezone.now(), provider_transaction_id="FAKETX1"
        )
        services.reconcile_payments()
        mock_callback(payment, "success", "")
        payment = refreshed(payment)
        assert payment.status == "failed" and payment.subscription is None
        assert not user_can_access_exam(student, paid_exam)
        body = jwt_client(student).get(f"{PAYMENTS}{payment.public_id}/").json()
        assert body["status"] == "failed" and body["transaction_id"] is None

    def test_admin_cannot_mark_success(self, student, package, admin_client):
        payment = close(initiate(student, package))
        url = f"{ADMIN}{payment.public_id}/"
        for method in ("put", "patch", "delete"):
            response = getattr(admin_client, method)(url, {"status": "success"}, format="json")
            assert response.status_code == 405
        response = admin_client.post(f"{url}reverify/", {"status": "success"}, format="json")
        assert response.status_code == 200 and response.json()["status"] == "failed"
        assert refreshed(payment).status == "failed"

    def test_student_cannot_send_status(self, student, package):
        client = jwt_client(student)
        body = client.post(
            PAYMENTS, {"package_id": package.pk, "status": "success"}, format="json"
        ).json()
        assert body["status"] == "pending"
        url = f"{PAYMENTS}{body['payment_id']}/"
        assert client.patch(url, {"status": "success"}, format="json").status_code == 405
        assert client.post(url, {"status": "success"}, format="json").status_code == 405


class TestForwardOnly:
    """Outside the provider-verified recovery, statuses only move forward. The database
    trigger guards the shape of transitions only; provider authenticity comes from the
    gateway verification service."""

    def test_service_refuses_illegal_moves(self, student, package):
        payment = close(initiate(student, package))
        with transaction.atomic():
            locked = Payment.objects.select_for_update().get(pk=payment.pk)
            with pytest.raises(RuntimeError):
                services._move(locked, PaymentStatus.SUCCESS)  # no recovery flag
            with pytest.raises(RuntimeError):
                services._move(locked, PaymentStatus.PENDING, recovery=True)
        paid = initiate(student, package)
        mock_callback(paid, val_id=pay_mock(paid))
        with transaction.atomic():
            locked = Payment.objects.select_for_update().get(pk=paid.pk)
            for target in ("failed", "cancelled", "pending"):
                with pytest.raises(RuntimeError):
                    services._move(locked, target, recovery=True)

    @pytest.mark.parametrize(
        ("start", "target"),
        [
            ("success", "failed"),
            ("success", "pending"),
            ("failed", "pending"),
            ("failed", "cancelled"),
            ("cancelled", "failed"),
            ("pending", "initiated"),
            ("initiated", "success"),
            ("initiated", "cancelled"),
        ],
    )
    def test_database_refuses_illegal_status_changes(self, student, package, start, target):
        payment = initiate(student, package)
        if start == "success":
            mock_callback(payment, val_id=pay_mock(payment))
        elif start in ("failed", "cancelled"):
            close(payment, {"failed": "fail", "cancelled": "cancel"}[start])
        elif start == "initiated":
            payment = Payment.objects.create(
                merchant_reference=services.new_reference(),
                user=student,
                package=package,
                provider="mock",
                amount=package.price,
                currency=package.currency,
                validity_days=package.validity_days,
            )
        with pytest.raises(Exception, match="illegal payment status change"):
            with transaction.atomic():
                Payment.objects.filter(pk=payment.pk).update(status=target)
        assert Payment.objects.get(pk=payment.pk).status == start

    def test_recovery_without_proof_is_refused_by_the_database(self, student, package):
        payment = close(initiate(student, package))
        with pytest.raises(IntegrityError), transaction.atomic():
            Payment.objects.filter(pk=payment.pk).update(status="success")
        assert refreshed(payment).status == "failed"

    def test_no_api_can_recover(self, student, package, admin_client):
        payment = close(initiate(student, package))
        for client, url in (
            (jwt_client(student), f"{PAYMENTS}{payment.public_id}/"),
            (admin_client, f"{ADMIN}{payment.public_id}/"),
        ):
            for method in ("put", "patch"):
                response = getattr(client, method)(url, {"status": "success"}, format="json")
                assert response.status_code == 405
        assert refreshed(payment).status == "failed"

    def test_reconciliation_never_touches_closed_payments(self, student, package):
        payment = close(initiate(student, package))
        pay_mock(payment, "success")
        _age(payment, 1000)
        assert services.reconcile_payments() == 0
        assert refreshed(payment).status == "failed"


# ======================================================================================
# Subscription activation and renewal (4A rules through payments)
# ======================================================================================
class TestSubscriptionIntegration:
    def buy(self, user, package):
        payment = initiate(user, package)
        mock_callback(payment, val_id=pay_mock(payment))
        return refreshed(payment)

    def test_same_package_renewal_extends_one_row(self, student, package):
        first = self.buy(student, package)
        subscription = first.subscription
        expires = subscription.expires_at
        second = self.buy(student, package)
        assert second.subscription_id == first.subscription_id
        subscription.refresh_from_db()
        assert subscription.expires_at == expires + timedelta(days=package.validity_days)
        assert subscription.price_paid == Decimal("1000.00")
        assert list(subscription.payments.order_by("id")) == [first, second]
        assert Subscription.objects.count() == 1

    def test_different_package_is_parallel(self, student, package):
        other = make_package("platinum", rules=all_paid(), price=Decimal("300.00"))
        a, b = self.buy(student, package), self.buy(student, other)
        assert a.subscription_id != b.subscription_id
        assert Subscription.objects.filter(user=student, status="active").count() == 2

    def test_expired_but_unmarked_row_is_replaced(self, student, package):
        old = self.buy(student, package).subscription
        Subscription.objects.filter(pk=old.pk).update(
            starts_at=timezone.now() - timedelta(days=60),
            expires_at=timezone.now() - timedelta(days=1),
        )
        renewed = self.buy(student, package)
        old.refresh_from_db()
        assert old.status == "expired"
        assert renewed.subscription_id != old.pk
        assert renewed.subscription.price_paid == Decimal("500.00")

    def test_package_deactivated_during_checkout_still_honoured(self, student, package):
        payment = initiate(student, package)
        subscription_services.update_package(package.pk, {"status": "inactive"}, ctx=CTX)
        mock_callback(payment, val_id=pay_mock(payment))
        assert refreshed(payment).status == "success"

    def test_grant_failure_keeps_payment_open(self, student, package, caplog):
        payment = initiate(student, package)
        val_id = pay_mock(payment)
        with mock.patch(
            "apps.payments.services.grant_subscription",
            side_effect=subscription_services.ValidationError({"user": "x"}),
        ):
            mock_callback(payment, val_id=val_id)
        payment = refreshed(payment)
        assert payment.status == "pending" and payment.failure_reason == "grant_failed"
        assert payment.provider_transaction_id is None
        mock_callback(payment, val_id=val_id)  # retried later → succeeds
        assert refreshed(payment).status == "success"

    def test_payment_grant_is_audited_as_system(self, student, package):
        self.buy(student, package)
        entry = AuditLog.objects.get(action="subscription.grant")
        assert entry.actor is None


# ======================================================================================
# SSLCommerz (provider HTTP mocked — no real credentials needed)
# ======================================================================================
def _md5(text):
    return hashlib.md5(text.encode(), usedforsecurity=False).hexdigest()


def signed(data, password=STORE_PASSWORD):
    data = dict(data)
    keys = list(data)
    fields = {k: data[k] for k in keys}
    fields["store_passwd"] = _md5(password)
    data["verify_key"] = ",".join(keys)
    data["verify_sign"] = _md5("&".join(f"{k}={fields[k]}" for k in sorted(fields)))
    return data


class FakeSslCommerz:
    def __init__(self):
        self.calls = []
        self.session = {
            "status": "SUCCESS",
            "GatewayPageURL": "https://sandbox.sslcommerz.com/EasyCheckOut/testcde123",
            "sessionkey": "SESSIONKEY-SECRETISH",
        }
        self.validations = {}
        self.queries = {}
        self.error = None

    def __call__(self, method, url, *, form=None, timeout):
        parsed = urllib.parse.urlparse(url)
        query = dict(urllib.parse.parse_qsl(parsed.query))
        self.calls.append((method, parsed.path, form or query))
        assert url.startswith("https://sandbox.sslcommerz.com/")
        if self.error:
            raise GatewayError(self.error)
        if parsed.path == sslcommerz.SESSION_PATH:
            return self.session
        if parsed.path == sslcommerz.VALIDATION_PATH:
            return self.validations.get(query["val_id"], {"status": "INVALID_TRANSACTION"})
        if parsed.path == sslcommerz.QUERY_PATH:
            return self.queries.get(
                query["tran_id"], {"APIConnect": "DONE", "no_of_trans_found": 0, "element": []}
            )
        raise AssertionError(url)

    def paths(self):
        return [path for _method, path, _data in self.calls]

    def valid(self, payment, val_id="VAL1", **override):
        body = {
            "status": "VALID",
            "tran_id": payment.merchant_reference,
            "val_id": val_id,
            "amount": f"{payment.amount:.2f}",
            "store_amount": "485.00",
            "currency": "BDT",
            "currency_type": "BDT",
            "currency_amount": f"{payment.amount:.2f}",
            "bank_tran_id": f"BANK-{val_id}",
            "card_type": "VISA-Dutch Bangla",
            "card_no": "432149XXXXXX0667",
            "risk_level": "0",
            "risk_title": "Safe",
            "cus_email": "leak@example.org",
        }
        body.update(override)
        self.validations[val_id] = body
        return body


@pytest.fixture
def ssl(settings, monkeypatch):
    settings.PAYMENT_PROVIDER = "sslcommerz"
    fake = FakeSslCommerz()
    monkeypatch.setattr(sslcommerz, "http_request", fake)
    return fake


def ssl_callback(payment, kind="success", val_id="VAL1", sign=True, **extra):
    data = {
        "tran_id": payment.merchant_reference,
        "val_id": val_id,
        "status": "VALID",
        "amount": "1.00",  # what a tampering client might claim — never trusted
        **extra,
    }
    data = signed(data) if sign else data
    url = ipn_url("sslcommerz") if kind == "ipn" else callback_url(kind, "sslcommerz")
    return post_form(url, data)


class TestSslCommerz:
    def test_session_request(self, ssl, student, package):
        payment = initiate(student, package)
        method, path, form = ssl.calls[0]
        assert (method, path) == ("POST", sslcommerz.SESSION_PATH)
        assert form["store_id"] == "teststore" and form["store_passwd"] == STORE_PASSWORD
        assert form["total_amount"] == "500.00" and form["currency"] == "BDT"
        assert form["tran_id"] == payment.merchant_reference
        base = "https://api.test/api/v1/payments/"
        assert form["success_url"] == base + "callback/sslcommerz/success/"
        assert form["fail_url"] == base + "callback/sslcommerz/fail/"
        assert form["cancel_url"] == base + "callback/sslcommerz/cancel/"
        assert form["ipn_url"] == base + "ipn/sslcommerz/"
        assert form["cus_email"] == "rahim@example.org"
        assert form["product_profile"] == "non-physical-goods"
        payment = refreshed(payment)
        assert payment.status == "pending" and payment.checkout_url == ssl.session["GatewayPageURL"]
        assert STORE_PASSWORD not in all_text(payment)

    def test_session_uses_default_email_when_student_has_none(self, ssl, package):
        initiate(make_student(), package)
        assert ssl.calls[0][2]["cus_email"] == "customer@example.com"

    @pytest.mark.parametrize(
        "session",
        [
            {"status": "FAILED", "failedreason": "Store Credential Error"},
            {"status": "SUCCESS", "GatewayPageURL": ""},
            {"status": "SUCCESS", "GatewayPageURL": "https://evil.test/pay"},
            {"status": "SUCCESS", "GatewayPageURL": "http://sandbox.sslcommerz.com/x"},
        ],
    )
    def test_session_rejected(self, ssl, student, package, session):
        ssl.session = session
        response = jwt_client(student).post(PAYMENTS, {"package_id": package.pk}, format="json")
        assert response.status_code == 503
        assert Payment.objects.get().status == "failed"

    def test_session_network_error(self, ssl, student, package):
        ssl.error = "timeout"
        response = jwt_client(student).post(PAYMENTS, {"package_id": package.pk}, format="json")
        assert response.status_code == 503
        payment = Payment.objects.get()
        assert events(payment, "verify_response")[-1].payload["error"] == "timeout"

    def test_missing_credentials(self, ssl, settings, student, package):
        settings.SSLCOMMERZ_STORE_PASSWORD = ""
        response = jwt_client(student).post(PAYMENTS, {"package_id": package.pk}, format="json")
        assert response.status_code == 503
        assert ssl.calls == []

    def test_valid_callback_activates_after_validation_api(self, ssl, student, package, paid_exam):
        payment = initiate(student, package)
        ssl.valid(payment)
        response = ssl_callback(payment)
        assert "status=success" in response["Location"]
        assert ssl.paths()[-1] == sslcommerz.VALIDATION_PATH
        assert ssl.calls[-1][2]["val_id"] == "VAL1"
        payment = refreshed(payment)
        assert payment.status == "success" and payment.provider_transaction_id == "BANK-VAL1"
        assert payment.provider_payment_id == "SESSIONKEY-SECRETISH"
        assert user_can_access_exam(student, paid_exam)
        text = all_text(payment)
        for secret in (STORE_PASSWORD, "verify_sign", "432149XXXXXX0667", "leak@example.org"):
            assert secret not in text
        assert payment.raw_verification["status"] == "VALID"

    def test_validated_status_also_accepted(self, ssl, student, package):
        payment = initiate(student, package)
        ssl.valid(payment, status="VALIDATED")
        ssl_callback(payment)
        assert refreshed(payment).status == "success"

    def test_invalid_signature_is_not_processed(self, ssl, student, package):
        payment = initiate(student, package)
        ssl.valid(payment)
        data = signed({"tran_id": payment.merchant_reference, "val_id": "VAL1"})
        data["verify_sign"] = "0" * 32
        response = post_form(callback_url("success", "sslcommerz"), data)
        assert "status=pending" in response["Location"]
        unsigned = ssl_callback(payment, sign=False)
        assert "status=pending" in unsigned["Location"]
        wrong_key = post_form(
            ipn_url("sslcommerz"),
            signed({"tran_id": payment.merchant_reference, "val_id": "VAL1"}, "other-pass"),
        )
        assert wrong_key.status_code == 200
        assert sslcommerz.VALIDATION_PATH not in ssl.paths()
        assert refreshed(payment).status == "pending"
        assert events(payment, "callback_received")[0].payload["signature_valid"] is False

    def test_success_redirect_without_valid_validation_response(self, ssl, student, package):
        payment = initiate(student, package)  # no validation entry → INVALID_TRANSACTION
        response = ssl_callback(payment)
        assert "status=pending" in response["Location"]
        assert not Subscription.objects.exists()

    @pytest.mark.parametrize(
        ("override", "reason"),
        [
            ({"currency_amount": "1.00", "amount": "1.00"}, "amount_mismatch"),
            ({"currency_amount": "", "amount": "499.99"}, "amount_mismatch"),
            ({"currency_type": "USD"}, "currency_mismatch"),
            ({"currency_type": "", "currency": "USD"}, "currency_mismatch"),
        ],
    )
    def test_wrong_amount_or_currency(self, ssl, student, package, override, reason):
        payment = initiate(student, package)
        ssl.valid(payment, **override)
        ssl_callback(payment)
        payment = refreshed(payment)
        assert payment.status == "failed" and payment.failure_reason == reason

    def test_wrong_reference(self, ssl, student, package):
        payment = initiate(student, package)
        ssl.valid(payment, tran_id="MCQSOMEONEELSE")
        ssl_callback(payment)
        assert refreshed(payment).status == "pending"

    def test_missing_bank_transaction_id_keeps_pending(self, ssl, student, package):
        payment = initiate(student, package)
        ssl.valid(payment).update(bank_tran_id="", val_id="")  # nothing to identify it
        ssl_callback(payment)
        payment = refreshed(payment)
        assert payment.status == "pending"
        assert events(payment, "verify_response")[-1].payload["reason"] == "missing_transaction_id"

    def test_duplicate_transaction_id(self, ssl, student, package):
        first, second = initiate(student, package), initiate(student, package)
        ssl.valid(first, "VALA", bank_tran_id="SAME")
        ssl.valid(second, "VALB", bank_tran_id="SAME")
        ssl_callback(first, val_id="VALA")
        ssl_callback(second, val_id="VALB")
        assert refreshed(first).status == "success"
        assert refreshed(second).failure_reason == "duplicate_transaction"
        assert Subscription.objects.count() == 1

    @pytest.mark.parametrize("error", ["timeout", "network_error", "http_502", "bad_response"])
    def test_provider_unreachable_keeps_pending(self, ssl, student, package, error):
        payment = initiate(student, package)
        ssl.error = error
        response = ssl_callback(payment)
        assert "status=pending" in response["Location"]
        payment = refreshed(payment)
        assert payment.status == "pending"
        assert events(payment, "verify_response")[-1].payload["reason"] == error

    def test_high_risk_is_held(self, ssl, student, package, paid_exam):
        payment = initiate(student, package)
        ssl.valid(payment, risk_level="1", risk_title="Risky")
        ssl_callback(payment)
        payment = refreshed(payment)
        assert payment.status == "pending" and payment.failure_reason == "provider_risk_review"
        assert not user_can_access_exam(student, paid_exam)

    def test_ipn_replay_validates_once(self, ssl, student, package):
        payment = initiate(student, package)
        ssl.valid(payment)
        for _ in range(3):
            assert ssl_callback(payment, "ipn").json() == {"status": "received"}
        ssl_callback(payment)
        assert ssl.paths().count(sslcommerz.VALIDATION_PATH) == 1
        assert Subscription.objects.count() == 1

    def test_fail_callback_queries_provider(self, ssl, student, package):
        payment = initiate(student, package)
        ssl.queries[payment.merchant_reference] = {
            "APIConnect": "DONE",
            "no_of_trans_found": 1,
            "element": [{"status": "FAILED", "tran_id": payment.merchant_reference}],
        }
        response = ssl_callback(payment, "fail", val_id="")
        assert "status=failed" in response["Location"]
        assert ssl.paths()[-1] == sslcommerz.QUERY_PATH
        assert refreshed(payment).failure_reason == "provider_failed"

    def test_cancel_callback_when_provider_says_cancelled(self, ssl, student, package):
        payment = initiate(student, package)
        ssl.queries[payment.merchant_reference] = {
            "APIConnect": "DONE",
            "element": [{"status": "CANCELLED", "tran_id": payment.merchant_reference}],
        }
        ssl_callback(payment, "cancel", val_id="")
        assert refreshed(payment).status == "cancelled"

    def test_query_with_valid_element_uses_validation_api(self, ssl, student, package):
        payment = initiate(student, package)
        ssl.valid(payment, "VALQ")
        ssl.queries[payment.merchant_reference] = {
            "APIConnect": "DONE",
            "element": [
                {"status": "FAILED", "tran_id": payment.merchant_reference, "val_id": "OLD"},
                {"status": "VALID", "tran_id": payment.merchant_reference, "val_id": "VALQ"},
            ],
        }
        result = get_gateway("sslcommerz").query(payment)
        assert result.outcome == Outcome.PAID and result.provider_transaction_id == "BANK-VALQ"
        assert ssl.paths()[-2:] == [sslcommerz.QUERY_PATH, sslcommerz.VALIDATION_PATH]

    def test_query_statuses(self, ssl, student, package):
        payment = initiate(student, package)
        gateway = get_gateway("sslcommerz")
        assert gateway.query(payment).outcome == Outcome.NOT_FOUND
        ssl.queries[payment.merchant_reference] = {"APIConnect": "INVALID_REQUEST"}
        assert gateway.query(payment).outcome == Outcome.ERROR
        ssl.queries[payment.merchant_reference] = {
            "APIConnect": "DONE",
            "element": [{"status": "PENDING", "tran_id": payment.merchant_reference}],
        }
        assert gateway.query(payment).outcome == Outcome.PENDING
        ssl.queries[payment.merchant_reference]["element"] = [
            {"status": "EXPIRED", "tran_id": payment.merchant_reference}
        ]
        result = gateway.query(payment)
        assert (result.outcome, result.reason) == (Outcome.FAILED, "provider_expired")

    @pytest.mark.parametrize("error", ["timeout", "network_error", "http_503", "bad_response"])
    def test_outage_never_abandons(self, ssl, student, package, error):
        payment = initiate(student, package)
        _age(payment, 90000)
        ssl.error = error
        services.reconcile_payments()
        assert refreshed(payment).status == "pending"

    def test_api_not_done_never_abandons(self, ssl, student, package):
        payment = initiate(student, package)
        _age(payment, 90000)
        ssl.queries[payment.merchant_reference] = {"APIConnect": "INACTIVE"}
        services.reconcile_payments()
        assert refreshed(payment).status == "pending"

    def test_genuine_not_found_abandons_after_24h(self, ssl, student, package):
        payment = initiate(student, package)  # provider: DONE, no transaction found
        _age(payment, 90000)
        services.reconcile_payments()
        payment = refreshed(payment)
        assert payment.status == "failed" and payment.failure_reason == "abandoned"

    def test_signature_algorithm(self):
        data = signed({"tran_id": "MCQ1", "val_id": "V", "amount": "10.00"})
        assert sslcommerz.signature_is_valid(data, STORE_PASSWORD)
        assert not sslcommerz.signature_is_valid({**data, "amount": "99.00"}, STORE_PASSWORD)
        assert not sslcommerz.signature_is_valid(data, "")
        assert not sslcommerz.signature_is_valid({"tran_id": "MCQ1"}, STORE_PASSWORD)

    def test_live_host_switch(self, settings):
        settings.SSLCOMMERZ_SANDBOX = False
        assert get_gateway("sslcommerz").host == sslcommerz.LIVE_HOST


class TestHttpTransport:
    """The real ``http_request`` with ``urlopen`` mocked (no network in tests)."""

    def call(self, **kwargs):
        return sslcommerz.http_request("GET", "https://sandbox.sslcommerz.com/x", timeout=5)

    def test_refuses_plain_http(self):
        with pytest.raises(GatewayError) as exc:
            sslcommerz.http_request("GET", "http://sandbox.sslcommerz.com/x", timeout=5)
        assert exc.value.reason == "insecure_url"

    @pytest.mark.parametrize(
        ("side_effect", "reason"),
        [
            (TimeoutError(), "timeout"),
            (urllib.error.URLError(TimeoutError()), "timeout"),
            (urllib.error.URLError("refused"), "network_error"),
            (urllib.error.HTTPError("u", 500, "err", {}, None), "http_500"),
            (OSError(), "network_error"),
        ],
    )
    def test_errors(self, side_effect, reason):
        with mock.patch("urllib.request.urlopen", side_effect=side_effect):
            with pytest.raises(GatewayError) as exc:
                self.call()
        assert exc.value.reason == reason

    @pytest.mark.parametrize(
        ("body", "reason"),
        [(b"not json", "bad_response"), (b"[1,2]", "bad_response"), (b"\xff", "bad_response")],
    )
    def test_bad_bodies(self, body, reason):
        response = mock.MagicMock()
        response.__enter__.return_value = BytesIO(body)
        with mock.patch("urllib.request.urlopen", return_value=response):
            with pytest.raises(GatewayError) as exc:
                self.call()
        assert exc.value.reason == reason

    def test_parses_json_with_timeout(self):
        response = mock.MagicMock()
        response.__enter__.return_value = BytesIO(b'{"status": "VALID"}')
        with mock.patch("urllib.request.urlopen", return_value=response) as urlopen:
            assert self.call() == {"status": "VALID"}
        assert urlopen.call_args.kwargs["timeout"] == 5


# ======================================================================================
# Sanitizing, secrets and logs
# ======================================================================================
class TestSecrets:
    def test_sanitize_allow_list(self):
        clean = sanitize(
            {
                "status": "VALID",
                "tran_id": "MCQ1",
                "store_passwd": "x",
                "store_id": "teststore",
                "verify_sign": "x",
                "verify_key": "x",
                "sessionkey": "x",
                "card_no": "4321",
                "cus_email": "a@b.c",
                "cus_phone": "017",
                "Authorization": "Bearer x",
                "cookie": "x",
                "amount": 1.5,
                "nested": {"a": 1},
                "element": [{"status": "VALID", "store_passwd": "x"}],
            }
        )
        assert clean == {
            "status": "VALID",
            "tran_id": "MCQ1",
            "amount": "1.5",
            "element": [{"status": "VALID"}],
        }
        assert sanitize("not a dict") == {}

    def test_logs_have_no_contact_data_or_secrets(self, ssl, student, package, caplog):
        with caplog.at_level(logging.DEBUG):
            payment = initiate(student, package)
            ssl.valid(payment)
            ssl_callback(payment)
            ssl_callback(payment, "ipn")
        text = caplog.text
        assert "Payment status changed" in text and str(payment.public_id) in text
        for secret in (
            STORE_PASSWORD,
            student.mobile_number,
            "rahim@example.org",
            "Rahim",
            "SESSIONKEY",
        ):
            assert secret not in text

    def test_student_api_hides_provider_data(self, ssl, student, package):
        payment = initiate(student, package)
        ssl.valid(payment)
        ssl_callback(payment)
        body = jwt_client(student).get(f"{PAYMENTS}{payment.public_id}/").json()
        dumped = json.dumps(body)
        for hidden in ("raw_verification", "events", "user", "SESSIONKEY", "subscription", "VALID"):
            assert hidden not in dumped
        assert body["transaction_id"] == "BANK-VAL1"


# ======================================================================================
# Student API and IDOR
# ======================================================================================
class TestStudentApi:
    def test_history_and_detail_are_own_only(self, student, package):
        mine = initiate(student, package)
        other_student = make_student()
        theirs = initiate(other_student, package)
        client = jwt_client(student)
        listing = client.get(PAYMENTS).json()
        assert [row["payment_id"] for row in listing["results"]] == [str(mine.public_id)]
        assert client.get(f"{PAYMENTS}{mine.public_id}/").status_code == 200
        assert client.get(f"{PAYMENTS}{theirs.public_id}/").status_code == 404
        assert client.get(f"{PAYMENTS}00000000-0000-0000-0000-000000000000/").status_code == 404
        assert client.get(f"{PAYMENTS}{theirs.merchant_reference}/").status_code == 404

    def test_student_cannot_use_admin_endpoints(self, student, package):
        payment = initiate(student, package)
        client = jwt_client(student)
        assert client.get(ADMIN).status_code in (401, 403)
        assert client.get(f"{ADMIN}{payment.public_id}/").status_code in (401, 403)
        response = client.post(f"{ADMIN}{payment.public_id}/reverify/")
        assert response.status_code in (401, 403)
        assert not events(payment, "admin_reverify")

    def test_no_write_methods_on_payments(self, student, package):
        payment = initiate(student, package)
        client = jwt_client(student)
        url = f"{PAYMENTS}{payment.public_id}/"
        for method in ("put", "patch", "delete"):
            assert (
                getattr(client, method)(url, {"status": "success"}, format="json").status_code
                == 405
            )
        assert refreshed(payment).status == "pending"

    def test_checkout_url_only_while_pending(self, student, package):
        payment = initiate(student, package)
        client = jwt_client(student)
        assert client.get(f"{PAYMENTS}{payment.public_id}/").json()["checkout_url"]
        mock_callback(payment, "fail", pay_mock(payment, "fail"))
        assert client.get(f"{PAYMENTS}{payment.public_id}/").json()["checkout_url"] is None

    def test_package_name_in_request_language(self, student):
        package = make_package("lang", rules=all_paid(), name_bn="সোনা", name_en="Gold")
        payment = initiate(student, package)
        client = jwt_client(student)
        url = f"{PAYMENTS}{payment.public_id}/"
        assert client.get(url, HTTP_ACCEPT_LANGUAGE="bn").json()["package"]["name"] == "সোনা"
        assert client.get(url, HTTP_ACCEPT_LANGUAGE="en").json()["package"]["name"] == "Gold"


# ======================================================================================
# Admin API
# ======================================================================================
class TestAdminApi:
    def test_list_filters_and_detail(self, admin_client, student, package):
        paid = initiate(student, package)
        mock_callback(paid, val_id=pay_mock(paid))
        paid = refreshed(paid)
        open_one = initiate(make_student(), package)
        rows = admin_client.get(ADMIN).json()["results"]
        assert {r["payment_id"] for r in rows} == {str(paid.public_id), str(open_one.public_id)}
        assert [
            r["payment_id"]
            for r in admin_client.get(ADMIN, {"status": "success"}).json()["results"]
        ] == [str(paid.public_id)]
        assert admin_client.get(ADMIN, {"provider": "sslcommerz"}).json()["count"] == 0
        assert admin_client.get(ADMIN, {"user": student.pk}).json()["count"] == 1
        assert admin_client.get(ADMIN, {"package": package.pk}).json()["count"] == 2
        assert admin_client.get(ADMIN, {"search": paid.merchant_reference}).json()["count"] == 1
        today = timezone.now().date().isoformat()
        assert (
            admin_client.get(ADMIN, {"created_from": today, "created_to": today}).json()["count"]
            == 2
        )
        assert admin_client.get(ADMIN, {"created_from": "nope"}).status_code == 400
        assert admin_client.get(ADMIN, {"status": "paid"}).status_code == 400
        assert admin_client.get(ADMIN, {"ordering": "-amount"}).status_code == 200
        detail = admin_client.get(f"{ADMIN}{paid.public_id}/").json()
        assert detail["status"] == "success" and detail["subscription_id"] == paid.subscription_id
        assert [e["event_type"] for e in detail["events"]][0] == "initiated"
        # 7H: an allow-listed summary instead of the stored provider answer.
        assert "raw_verification" not in detail
        assert detail["verification"]["provider_status"] == "VALID"
        assert "mobile_number" not in json.dumps(detail)

    def test_admin_cannot_set_status(self, admin_client, student, package):
        payment = initiate(student, package)
        url = f"{ADMIN}{payment.public_id}/"
        for method in ("put", "patch", "delete"):
            response = getattr(admin_client, method)(url, {"status": "success"}, format="json")
            assert response.status_code == 405
        assert admin_client.post(ADMIN, {"status": "success"}, format="json").status_code == 405
        assert refreshed(payment).status == "pending"

    def test_reverify_uses_provider_and_is_audited(self, admin_client, student, package, paid_exam):
        payment = initiate(student, package)
        response = admin_client.post(f"{ADMIN}{payment.public_id}/reverify/")
        assert response.status_code == 200 and response.json()["status"] == "pending"
        pay_mock(payment)  # provider now says paid (e.g. the callback never arrived)
        response = admin_client.post(f"{ADMIN}{payment.public_id}/reverify/")
        assert response.json()["status"] == "success"
        assert user_can_access_exam(student, paid_exam)
        entries = AuditLog.objects.filter(action="payment.reverify").order_by("id")
        assert entries.count() == 2
        assert entries[1].metadata["changes"]["status"] == {"from": "pending", "to": "success"}
        assert entries[1].actor is not None
        assert len(events(payment, "admin_reverify")) == 2
        # again: idempotent, no second grant
        admin_client.post(f"{ADMIN}{payment.public_id}/reverify/")
        assert Subscription.objects.count() == 1

    def test_reverify_needs_csrf_and_known_payment(self, student, package):
        payment = initiate(student, package)
        admin = User.objects.create_user(
            "01611111111", password="x-Strong-2026", full_name="Ops", role=Role.ADMIN
        )
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(admin)
        assert client.post(f"{ADMIN}{payment.public_id}/reverify/").status_code == 403
        api = APIClient()
        api.force_login(admin)
        unknown = api.post(f"{ADMIN}00000000-0000-0000-0000-000000000000/reverify/")
        assert unknown.status_code == 404

    def test_reverify_disabled_provider(self, settings, admin_client, student, package):
        payment = initiate(student, package)
        settings.PAYMENT_MOCK_ALLOWED = False
        response = admin_client.post(f"{ADMIN}{payment.public_id}/reverify/")
        assert response.status_code == 409 and code(response) == "provider_disabled"


# ======================================================================================
# Jobs
# ======================================================================================
def _age(payment, seconds):
    Payment.objects.filter(pk=payment.pk).update(
        created_at=timezone.now() - timedelta(seconds=seconds)
    )


class TestExpiryJob:
    def test_marks_only_ran_out_active_rows(self, student, package, paid_exam):
        now = timezone.now()
        running = subscription_services.grant_subscription(student.pk, package.pk, ctx=CTX)
        others = [
            subscription_services.grant_subscription(
                make_student().pk, package.pk, ctx=CTX
            ).subscription
            for _ in range(3)
        ]
        Subscription.objects.filter(pk__in=[s.pk for s in others]).update(
            starts_at=now - timedelta(days=40), expires_at=now - timedelta(days=1)
        )
        cancelled = others.pop()
        Subscription.objects.filter(pk=cancelled.pk).update(status="cancelled")
        assert subscription_services.expire_subscriptions() == 2
        assert set(Subscription.objects.filter(status="expired").values_list("pk", flat=True)) == {
            s.pk for s in others
        }
        running.subscription.refresh_from_db()
        assert running.subscription.status == "active"
        assert Subscription.objects.get(pk=cancelled.pk).status == "cancelled"
        assert subscription_services.expire_subscriptions() == 0  # idempotent

    def test_bounded_batches(self, package):
        now = timezone.now()
        rows = [
            subscription_services.grant_subscription(
                make_student().pk, package.pk, ctx=CTX
            ).subscription.pk
            for _ in range(5)
        ]
        Subscription.objects.filter(pk__in=rows).update(
            starts_at=now - timedelta(days=40), expires_at=now - timedelta(seconds=1)
        )
        assert subscription_services.expire_subscriptions(batch_size=2, max_batches=1) == 2
        assert subscription_services.expire_subscriptions(batch_size=2, max_batches=10) == 3

    def test_access_ends_even_before_the_job(self, student, package, paid_exam):
        grant = subscription_services.grant_subscription(student.pk, package.pk, ctx=CTX)
        Subscription.objects.filter(pk=grant.subscription.pk).update(
            starts_at=timezone.now() - timedelta(days=40),
            expires_at=timezone.now() - timedelta(seconds=1),
        )
        assert not user_can_access_exam(student, paid_exam)  # status still "active"

    def test_task_and_schedule(self, settings, package):
        from apps.subscriptions.tasks import expire_subscriptions_task

        assert expire_subscriptions_task.delay().get() == 0
        schedule = settings.CELERY_BEAT_SCHEDULE
        assert schedule["expire-subscriptions"]["task"] == (
            "apps.subscriptions.tasks.expire_subscriptions_task"
        )
        assert (
            schedule["reconcile-payments"]["task"] == "apps.payments.tasks.reconcile_payments_task"
        )


class TestReconciliation:
    def test_stuck_paid_payment_is_activated(self, student, package, paid_exam):
        payment = initiate(student, package)
        pay_mock(payment)  # paid, but no callback/IPN ever arrived
        _age(payment, 1000)
        assert services.reconcile_payments() == 1
        payment = refreshed(payment)
        assert payment.status == "success" and user_can_access_exam(student, paid_exam)
        assert events(payment, "reconciliation")[0].payload["outcome"] == "paid"
        assert services.reconcile_payments() == 0  # terminal: never selected again

    def test_young_payments_wait(self, student, package):
        payment = initiate(student, package)
        pay_mock(payment)
        assert services.reconcile_payments() == 0
        assert refreshed(payment).status == "pending"

    def test_never_succeeds_without_provider(self, student, package):
        payment = initiate(student, package)
        _age(payment, 1000)
        services.reconcile_payments()
        assert refreshed(payment).status == "pending"  # provider: still pending
        cache.clear()  # provider has no record at all
        services.reconcile_payments()
        assert refreshed(payment).status == "pending"  # not yet abandoned
        _age(payment, 90000)
        services.reconcile_payments()
        payment = refreshed(payment)
        assert payment.status == "failed" and payment.failure_reason == "abandoned"
        assert not Subscription.objects.exists()

    def test_provider_errors_change_nothing(self, student, package):
        payment = initiate(student, package)
        _age(payment, 90000)
        with mock.patch.object(
            mock_gateway.MockGateway,
            "query",
            return_value=VerificationResult(outcome=Outcome.ERROR, reason="timeout"),
        ):
            services.reconcile_payments()
        assert refreshed(payment).status == "pending"

    def test_failed_and_cancelled_at_provider(self, student, package):
        failed, cancelled = initiate(student, package), initiate(student, package)
        pay_mock(failed, "fail")
        pay_mock(cancelled, "cancel")
        _age(failed, 1000)
        _age(cancelled, 1000)
        services.reconcile_payments()
        assert refreshed(failed).status == "failed"
        assert refreshed(cancelled).status == "cancelled"

    def test_stuck_initiated_payment(self, student, package):
        # Row created, but the worker died before the session was recorded.
        payment = Payment.objects.create(
            merchant_reference=services.new_reference(),
            user=student,
            package=package,
            provider="mock",
            amount=package.price,
            currency=package.currency,
            validity_days=package.validity_days,
        )
        mock_gateway.open_session(payment.merchant_reference, payment.amount, payment.currency)
        pay_mock(payment)
        _age(payment, 1000)
        services.reconcile_payments()
        payment = refreshed(payment)
        assert payment.status == "success"
        transitions = [
            (e.payload["from"], e.payload["to"]) for e in events(payment, "status_changed")
        ]
        assert transitions[-2:] == [("initiated", "pending"), ("pending", "success")]

    def test_bounded_and_rotating(self, student, package):
        payments = [initiate(student, package) for _ in range(5)]
        for payment in payments:
            _age(payment, 1000)
        assert services.reconcile_payments(batch_size=2, max_batches=1) == 2
        assert services.reconcile_payments(batch_size=2, max_batches=1) == 2
        checked = Payment.objects.filter(last_checked_at__isnull=False).count()
        assert checked == 4  # the least recently checked go first
        assert services.reconcile_payments(batch_size=2, max_batches=5) == 5  # one pass each

    def test_disabled_provider_is_skipped(self, settings, student, package):
        payment = initiate(student, package)
        _age(payment, 90000)
        settings.PAYMENT_MOCK_ALLOWED = False
        services.reconcile_payments()
        assert refreshed(payment).status == "pending"

    def test_task(self, student, package):
        from apps.payments.tasks import reconcile_payments_task

        payment = initiate(student, package)
        pay_mock(payment)
        _age(payment, 1000)
        assert reconcile_payments_task.delay().get() == 1


# ======================================================================================
# Configuration
# ======================================================================================
GOOD = {
    "provider": "sslcommerz",
    "providers": {"mock": "x", "sslcommerz": "y"},
    "store_id": "realstore",
    "store_password": "real-password-value",
    "sandbox": False,
    "allow_sandbox": False,
    "callback_base_url": "https://api.example.com",
    "return_url": "https://example.com/return",
}


class TestConfiguration:
    def test_good_production_payment_settings(self):
        validate_payment_settings(**GOOD)

    @pytest.mark.parametrize(
        "override",
        [
            {"provider": "mock"},
            {"provider": "paypal"},
            {"store_id": ""},
            {"store_password": "change-me"},
            {"sandbox": True},
            {"callback_base_url": "http://api.example.com"},
            {"return_url": ""},
        ],
    )
    def test_unsafe_production_payment_settings(self, override):
        with pytest.raises(ImproperlyConfigured):
            validate_payment_settings(**{**GOOD, **override})

    def test_sandbox_only_with_explicit_flag(self):
        validate_payment_settings(**{**GOOD, "sandbox": True, "allow_sandbox": True})

    def test_mock_blocked_when_not_allowed(self, settings):
        settings.PAYMENT_MOCK_ALLOWED = False
        with pytest.raises(ImproperlyConfigured):
            get_gateway("mock")
        with pytest.raises(ImproperlyConfigured):
            get_gateway("bkash")  # future provider: not built yet

    def test_production_settings_force_mock_off(self):
        source = open("config/settings/prod.py", encoding="utf-8").read()
        assert "PAYMENT_MOCK_ALLOWED = False" in source
        assert "validate_payment_settings(" in source

    def test_system_checks(self, settings):
        from apps.payments.checks import check_payment_settings

        assert check_payment_settings(None) == []
        settings.PAYMENT_PROVIDER = "paypal"
        settings.PAYMENT_ABANDON_AFTER_SECONDS = 60
        ids = {m.id for m in check_payment_settings(None)}
        assert {"payments.E001", "payments.E002"} <= ids
        settings.PAYMENT_PROVIDER = "mock"
        settings.PAYMENT_MOCK_ALLOWED = False
        settings.PAYMENT_ABANDON_AFTER_SECONDS = 86400
        assert {m.id for m in check_payment_settings(None)} == {"payments.E003"}


# ======================================================================================
# Concurrency (PostgreSQL, real transactions)
# ======================================================================================
def _fresh_package(tag):
    return make_package(f"cc-{tag}-{next(_slugs)}", rules=all_paid(), price=Decimal("250.00"))


def _assert_one_grant(payment):
    payment = refreshed(payment)
    assert payment.status == "success"
    assert Subscription.objects.filter(user=payment.user).count() == 1
    subscription = Subscription.objects.get(user=payment.user)
    assert subscription.price_paid == Decimal("250.00")
    assert (
        AuditLog.objects.filter(
            action__startswith="subscription.", entity_id=str(subscription.pk)
        ).count()
        == 1
    )
    assert len(events(payment, "status_changed")) == 2


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_two_success_callbacks_grant_once(run):
    student, package = make_student(), _fresh_package(f"a{run}")
    payment = initiate(student, package)
    val_id = pay_mock(payment)
    results = _run_concurrently(*[lambda: mock_callback(payment, val_id=val_id)] * 3)
    assert all(r.status_code == 302 for r in results), results
    _assert_one_grant(payment)


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_callback_vs_ipn(run):
    student, package = make_student(), _fresh_package(f"b{run}")
    payment = initiate(student, package)
    val_id = pay_mock(payment)
    data = {"tran_id": payment.merchant_reference, "val_id": val_id}
    results = _run_concurrently(
        lambda: mock_callback(payment, val_id=val_id), lambda: post_form(ipn_url(), data)
    )
    assert [r.status_code for r in results] == [302, 200]
    _assert_one_grant(payment)


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_callback_vs_reconciliation(run):
    student, package = make_student(), _fresh_package(f"c{run}")
    payment = initiate(student, package)
    val_id = pay_mock(payment)
    _age(payment, 1000)
    results = _run_concurrently(
        lambda: mock_callback(payment, val_id=val_id), services.reconcile_payments
    )
    assert not any(isinstance(r, Exception) for r in results), results
    _assert_one_grant(payment)


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_two_reconciliation_workers(run):
    student, package = make_student(), _fresh_package(f"d{run}")
    payment = initiate(student, package)
    pay_mock(payment)
    _age(payment, 1000)
    results = _run_concurrently(services.reconcile_payments, services.reconcile_payments)
    assert not any(isinstance(r, Exception) for r in results), results
    _assert_one_grant(payment)


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_repeated_verification(run):
    student, package = make_student(), _fresh_package(f"e{run}")
    payment = initiate(student, package)
    pay_mock(payment)
    verified = get_gateway("mock").query(payment)
    results = _run_concurrently(
        *[lambda: services.apply_verification(payment.pk, verified, source="test")] * 4
    )
    assert all(isinstance(r, Payment) for r in results), results
    _assert_one_grant(payment)


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_late_success_racing_another_verification(run):
    student, package = make_student(), _fresh_package(f"g{run}")
    payment = close(initiate(student, package))
    val_id = pay_mock(payment, "success")
    verified = get_gateway("mock").query(payment)
    data = {"tran_id": payment.merchant_reference, "val_id": val_id}
    results = _run_concurrently(
        lambda: services.apply_verification(payment.pk, verified, source="test"),
        lambda: services.apply_verification(payment.pk, verified, source="test"),
        lambda: mock_callback(payment, val_id=val_id),
        lambda: post_form(ipn_url(), data),
    )
    assert not any(isinstance(r, Exception) for r in results), results
    payment = refreshed(payment)
    assert payment.status == "success"
    assert Subscription.objects.filter(user=student).count() == 1
    assert payment.subscription == Subscription.objects.get(user=student)
    assert len(recovery_events(payment)) == 1
    assert (
        AuditLog.objects.filter(
            action="payment.late_success_recover", entity_id=str(payment.pk)
        ).count()
        == 1
    )


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_late_success_racing_reconciliation(run):
    """Reconciliation abandons the payment (provider: no record) while the provider's
    real success arrives: whichever runs first, the end state is one success."""
    student, package = make_student(), _fresh_package(f"h{run}")
    payment = initiate(student, package)
    val_id = pay_mock(payment)
    _age(payment, 90000)
    not_found = VerificationResult(outcome=Outcome.NOT_FOUND, reason="not_found")
    with mock.patch.object(mock_gateway.MockGateway, "query", return_value=not_found):
        results = _run_concurrently(
            services.reconcile_payments, lambda: mock_callback(payment, val_id=val_id)
        )
        assert not any(isinstance(r, Exception) for r in results), results
        if refreshed(payment).status == "failed":  # reconciliation won: provider proves it later
            mock_callback(payment, val_id=val_id)
    payment = refreshed(payment)
    assert payment.status == "success"
    assert Subscription.objects.filter(user=student).count() == 1
    assert payment.subscription == Subscription.objects.get(user=student)
    assert len(events(payment, "status_changed")) in (2, 3)  # →pending, [→failed], →success


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_provider_transaction_reused_concurrently(run):
    package = _fresh_package(f"f{run}")
    first, second = initiate(make_student(), package), initiate(make_student(), package)
    val_a = pay_mock(first, bank_tran_id=f"SAMETX{run}")
    val_b = pay_mock(second, bank_tran_id=f"SAMETX{run}")
    results = _run_concurrently(
        lambda: mock_callback(first, val_id=val_a), lambda: mock_callback(second, val_id=val_b)
    )
    assert all(r.status_code == 302 for r in results), results
    statuses = sorted([refreshed(first).status, refreshed(second).status])
    assert statuses == ["failed", "success"]
    loser = first if first.status == "failed" else second
    assert loser.failure_reason == "duplicate_transaction" and loser.subscription_id is None
    assert Subscription.objects.filter(package=package).count() == 1
    assert Payment.objects.filter(provider_transaction_id=f"SAMETX{run}").count() == 1
