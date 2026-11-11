"""Milestone 7H: the admin payments API returns allow-listed data only — a masked
student, package names, our reason codes, the provider transaction ID (detail only), a
four-field verification summary and the latest 50 events as short codes. Never the
stored provider answer, event payloads, source IPs, the provider session key, the
checkout URL, the idempotency key or contact data."""

import json
from datetime import timedelta
from decimal import Decimal
from unittest import mock

import pytest
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.audit.models import AuditLog
from apps.payments import selectors
from apps.payments.models import Payment, PaymentEvent
from apps.subscriptions.models import Package
from tests.test_payments import initiate, mock_callback, pay_mock, refreshed
from tests.test_subscriptions import all_paid, jwt_client, make_package, make_student

pytestmark = pytest.mark.django_db

ADMIN = "/api/v1/admin/payments/"

LIST_FIELDS = {
    "payment_id",
    "merchant_reference",
    "user",
    "package",
    "subscription_id",
    "provider",
    "amount",
    "currency",
    "status",
    "failure_reason",
    "gateway",
    "mode",
    "channel",
    "is_test",
    "created_at",
    "verified_at",
}
DETAIL_FIELDS = LIST_FIELDS | {
    "provider_transaction_id",
    "validity_days",
    "updated_at",
    "last_checked_at",
    "verification",
    "events",
    "events_total",
}
FORBIDDEN_KEYS = (
    "raw_verification",
    "payload",
    "source_ip",
    "provider_payment_id",
    "checkout_url",
    "idempotency_key",
    "mobile_number",
    "email",
    "val_id",
    "store_amount",
    "currency_rate",
    "failedreason",
    "sessionkey",
    "verify_sign",
    "verify_key",
    "store_passwd",
    "cus_phone",
    "cus_email",
    "card_no",
    "token",
    "cookie",
    "authorization",
)

# Planted values (never real data): each must stay out of every admin response.
SESSION_KEY = "PLANTEDSESSIONKEY7H0123456789"
IP = "203.0.113.77"
MARKER = "RAW_PROVIDER_MARKER_7H"
VAL_ID = "PLANTEDVALID7H42"
IDEMPOTENCY_KEY = "idem-planted-7h"
CARD_NUMBER = "4111XXXXXXXX1111"
FREE_TEXT_ERROR = f"Bank said: card {CARD_NUMBER} declined {MARKER}"


@pytest.fixture(autouse=True)
def _payment_settings(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "media")
    settings.PAYMENT_PROVIDER = "mock"
    settings.PAYMENT_MOCK_ALLOWED = True
    settings.PAYMENT_CALLBACK_BASE_URL = "https://api.test"
    settings.PAYMENT_RETURN_URL = "https://app.test/payment-return"
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def api():
    admin = User.objects.create_user(
        "01612345678", password="Strong-Pass-2026", full_name="Ops", role=Role.ADMIN
    )
    client = APIClient()
    client.force_login(admin)
    return client


@pytest.fixture
def student():
    return make_student(full_name="Rahim Hossain", email="rahim@example.org")


@pytest.fixture
def package():
    return make_package(
        "gold-7h", rules=all_paid(), price=Decimal("500.00"), name_bn="সোনা", name_en="Gold"
    )


def paid(student, package):
    payment = initiate(student, package)
    mock_callback(payment, val_id=pay_mock(payment))
    return refreshed(payment)


def ok(response):
    assert response.status_code == 200, response.content
    return response.json()


def refs(response):
    return [row["merchant_reference"] for row in ok(response)["results"]]


def plant(payment, student):
    """Worst case: raw provider data and a client IP stored on the payment and its
    events (bypassing the sanitizer on purpose)."""
    Payment.objects.filter(pk=payment.pk).update(
        provider_payment_id=SESSION_KEY,
        idempotency_key=IDEMPOTENCY_KEY,
        raw_verification={
            "status": "VALID",
            "risk_level": "0",
            "card_brand": "VISA",
            "validated_on": "2026-10-21 10:15:00",
            "val_id": VAL_ID,
            "store_amount": "487.50",
            "currency_rate": "1.0000",
            "failedreason": MARKER,
            "sessionkey": SESSION_KEY,
            "cus_phone": student.mobile_number,
            "cus_email": "rahim@example.org",
            "verify_sign": MARKER,
            "card_no": CARD_NUMBER,
        },
    )
    PaymentEvent.objects.create(
        payment=payment,
        event_type="callback_received",
        payload={
            "kind": "success",
            "signature_valid": True,
            "reason": FREE_TEXT_ERROR,
            "error": FREE_TEXT_ERROR,
            "outcome": MARKER,
            "source": "browser",
            "from": "hacked",
            "tran_id": payment.merchant_reference,
            "val_id": VAL_ID,
            "sessionkey": SESSION_KEY,
            "cus_phone": student.mobile_number,
            "headers": {"Cookie": MARKER},
            "marker": MARKER,
        },
        source_ip=IP,
    )


def assert_safe(body, student, payment):
    text = json.dumps(body)
    for key in FORBIDDEN_KEYS:
        assert f'"{key}"' not in text, key
    # Whole planted values only: a short fragment could appear by chance in a timestamp.
    for value in (SESSION_KEY, IP, MARKER, VAL_ID, IDEMPOTENCY_KEY, "487.50", CARD_NUMBER):
        assert value not in text, value
    assert student.mobile_number not in text
    assert student.mobile_number[-10:] not in text
    assert "rahim@example.org" not in text
    assert "checkout" not in text and payment.checkout_url not in text


# ======================================================================================
# Contracts
# ======================================================================================
class TestListContract:
    def test_exact_fields_masked_student_bilingual_package(self, api, student, package):
        payment = paid(student, package)
        [row] = ok(api.get(ADMIN))["results"]
        assert set(row) == LIST_FIELDS
        assert row["user"] == {
            "id": student.pk,
            "full_name": "Rahim Hossain",
            "mobile_display": f"+88017*****{student.mobile_number[-3:]}",
        }
        assert row["package"] == {
            "id": package.pk,
            "slug": "gold-7h",
            "name_bn": "সোনা",
            "name_en": "Gold",
        }
        assert row["payment_id"] == str(payment.public_id)
        assert row["subscription_id"] == payment.subscription_id
        assert (row["status"], row["amount"], row["currency"]) == ("success", "500.00", "BDT")
        assert row["failure_reason"] == "" and row["verified_at"]

    def test_transaction_id_is_detail_only(self, api, student, package):
        payment = paid(student, package)
        assert payment.provider_transaction_id
        assert payment.provider_transaction_id not in json.dumps(ok(api.get(ADMIN)))
        detail = ok(api.get(f"{ADMIN}{payment.public_id}/"))
        assert detail["provider_transaction_id"] == payment.provider_transaction_id

    def test_planted_values_never_listed(self, api, student, package):
        payment = paid(student, package)
        plant(payment, student)
        assert_safe(ok(api.get(ADMIN)), student, refreshed(payment))


class TestDetailContract:
    def test_exact_fields(self, api, student, package):
        payment = paid(student, package)
        detail = ok(api.get(f"{ADMIN}{payment.public_id}/"))
        assert set(detail) == DETAIL_FIELDS
        assert detail["verification"] == {
            "provider_status": "VALID",
            "risk_level": None,
            "card_brand": None,
            "validated_on": None,
        }
        assert detail["last_checked_at"] and detail["updated_at"]
        for event in detail["events"]:
            assert set(event) == {"event_type", "created_at", "summary"}

    def test_planted_values_never_in_detail(self, api, student, package):
        payment = paid(student, package)
        plant(payment, student)
        detail = ok(api.get(f"{ADMIN}{payment.public_id}/"))
        assert_safe(detail, student, refreshed(payment))
        assert detail["verification"] == {
            "provider_status": "VALID",
            "risk_level": "0",
            "card_brand": "VISA",
            "validated_on": "2026-10-21 10:15:00",
        }
        planted = detail["events"][-1]
        assert planted["event_type"] == "callback_received"
        # Free text, unknown codes and nested data dropped; valid short codes kept.
        assert planted["summary"] == {"kind": "success", "signature_valid": True}

    def test_open_payment_has_no_verification_or_subscription(self, api, student, package):
        payment = initiate(student, package)
        detail = ok(api.get(f"{ADMIN}{payment.public_id}/"))
        assert detail["status"] == "pending"
        assert detail["verification"] is None
        assert detail["subscription_id"] is None and detail["provider_transaction_id"] is None
        assert [e["event_type"] for e in detail["events"]] == ["initiated", "status_changed"]
        assert detail["events"][1]["summary"] == {"from": "initiated", "to": "pending"}
        assert detail["events_total"] == 2

    def test_unknown_payment(self, api):
        assert api.get(f"{ADMIN}00000000-0000-0000-0000-000000000000/").status_code == 404
        assert api.get(f"{ADMIN}not-a-uuid/").status_code == 404


class TestSummaries:
    def test_event_summary_allow_list(self):
        summary = selectors.event_summary(
            {
                "from": "pending",
                "to": "success",
                "reason": "late_provider_success",
                "previous_reason": "provider_cancelled",
                "outcome": "paid",
                "source": "admin_reverify",
                "kind": "ipn",
                "signature_valid": False,
                "error": "http_500",
                "amount": "500.00",
                "tran_id": "MCQ123",
            }
        )
        assert summary == {
            "from": "pending",
            "to": "success",
            "reason": "late_provider_success",
            "previous_reason": "provider_cancelled",
            "outcome": "paid",
            "source": "admin_reverify",
            "kind": "ipn",
            "signature_valid": False,
            "error": "http_500",
        }

    @pytest.mark.parametrize(
        "payload",
        [
            {"reason": "Has Spaces"},
            {"error": "x" * 65},
            {"error": "<script>"},
            {"from": "paid"},
            {"to": "SUCCESS"},
            {"outcome": "approved"},
            {"kind": "refund"},
            {"source": "http://evil"},
            {"signature_valid": "true"},
            {"reason": 5},
            {"reason": ""},
        ],
    )
    def test_event_summary_drops_invalid_values(self, payload):
        assert selectors.event_summary(payload) == {}

    def test_event_summary_non_dict(self):
        assert selectors.event_summary(["x"]) == {} and selectors.event_summary(None) == {}

    def test_verification_summary(self):
        assert selectors.verification_summary(None) is None
        assert selectors.verification_summary({}) is None
        assert selectors.verification_summary({"val_id": VAL_ID, "amount": "500"}) is None
        assert selectors.verification_summary(
            {"status": "validated", "risk_level": 1, "card_brand": "MOBILEBANKING"}
        ) == {
            "provider_status": "VALIDATED",
            "risk_level": "1",
            "card_brand": "MOBILEBANKING",
            "validated_on": None,
        }
        assert (
            selectors.verification_summary(
                {"status": f"VALID {MARKER} !", "card_brand": "<b>", "validated_on": "yesterday"}
            )
            is None
        )


# ======================================================================================
# Timeline
# ======================================================================================
class TestTimeline:
    def test_latest_fifty_oldest_first_with_total(self, api, student, package):
        payment = initiate(student, package)  # 2 events
        start = timezone.now()
        for i in range(1, 61):
            # Distinct, increasing times (the display order is by time, then id).
            with mock.patch("django.utils.timezone.now", return_value=start + timedelta(seconds=i)):
                PaymentEvent.objects.create(
                    payment=payment,
                    event_type="reconciliation",
                    payload={"reason": f"step_{i:02d}"},
                )
        detail = ok(api.get(f"{ADMIN}{payment.public_id}/"))
        assert detail["events_total"] == 62
        reasons = [e["summary"]["reason"] for e in detail["events"]]
        assert reasons == [f"step_{i:02d}" for i in range(11, 61)]
        times = [e["created_at"] for e in detail["events"]]
        assert times == sorted(times)

    def test_same_time_events_keep_id_order(self, api, student, package):
        payment = initiate(student, package)
        moment = timezone.now() + timedelta(minutes=1)
        with mock.patch("django.utils.timezone.now", return_value=moment):
            for i in range(3):
                PaymentEvent.objects.create(
                    payment=payment, event_type="reconciliation", payload={"reason": f"tie_{i}"}
                )
        events = ok(api.get(f"{ADMIN}{payment.public_id}/"))["events"]
        assert [e["summary"].get("reason") for e in events][-3:] == ["tie_0", "tie_1", "tie_2"]

    def test_detail_queries_do_not_grow_with_events(self, api, student, package):
        payment = initiate(student, package)
        url = f"{ADMIN}{payment.public_id}/"
        api.get(url)
        with CaptureQueriesContext(connection) as few:
            ok(api.get(url))
        for _ in range(60):
            PaymentEvent.objects.create(payment=payment, event_type="reconciliation", payload={})
        with CaptureQueriesContext(connection) as many:
            ok(api.get(url))
        assert len(many) <= len(few) + 1  # + the total count once the cap is reached


# ======================================================================================
# Filters and ordering
# ======================================================================================
class TestFilters:
    def test_subscription_filter_with_renewal(self, api, student, package):
        first = paid(student, package)
        second = paid(student, package)  # renewal: extends the same subscription
        assert first.subscription_id == second.subscription_id
        other = paid(make_student(), package)
        initiate(student, package)  # open: no subscription
        url = f"{ADMIN}?subscription={first.subscription_id}"
        assert set(refs(api.get(url))) == {first.merchant_reference, second.merchant_reference}
        assert refs(api.get(f"{ADMIN}?subscription={other.subscription_id}")) == [
            other.merchant_reference
        ]
        assert ok(api.get(f"{ADMIN}?subscription=999999"))["count"] == 0
        combined = f"{ADMIN}?subscription={first.subscription_id}&user={student.pk}&status=success"
        assert ok(api.get(combined))["count"] == 2

    @pytest.mark.parametrize("value", ["abc", "0", "-3", "1.5"])
    def test_invalid_subscription(self, api, value):
        response = api.get(f"{ADMIN}?subscription={value}")
        assert response.status_code == 400
        assert "subscription" in response.json()["error"]["field_errors"]

    def test_search_is_exact_reference_or_transaction_id(self, api, student, package):
        payment = paid(student, package)
        initiate(make_student(), package)
        assert refs(api.get(ADMIN, {"search": payment.merchant_reference.lower()})) == [
            payment.merchant_reference
        ]
        assert refs(api.get(ADMIN, {"search": payment.provider_transaction_id})) == [
            payment.merchant_reference
        ]
        for partial in (payment.merchant_reference[:-2], "Rahim", student.mobile_number[-8:]):
            assert ok(api.get(ADMIN, {"search": partial}))["count"] == 0


class TestOrdering:
    def test_verified_at_nulls_last_both_directions(self, api, student, package):
        first = paid(student, package)
        second = paid(make_student(), package)
        open_one = initiate(make_student(), package)
        later = timezone.now() + timedelta(minutes=5)
        Payment.objects.filter(pk=second.pk).update(verified_at=later)
        assert refs(api.get(ADMIN, {"ordering": "verified_at"})) == [
            first.merchant_reference,
            second.merchant_reference,
            open_one.merchant_reference,
        ]
        assert refs(api.get(ADMIN, {"ordering": "-verified_at"})) == [
            second.merchant_reference,
            first.merchant_reference,
            open_one.merchant_reference,
        ]

    def test_other_orderings_and_unknown(self, api, student, package):
        cheap = make_package("cheap-7h", rules=all_paid(), price=Decimal("100.00"))
        a = initiate(student, package)
        b = initiate(student, cheap)
        assert refs(api.get(ADMIN)) == [b.merchant_reference, a.merchant_reference]
        assert refs(api.get(ADMIN, {"ordering": "created_at"})) == [
            a.merchant_reference,
            b.merchant_reference,
        ]
        assert refs(api.get(ADMIN, {"ordering": "amount"}))[0] == b.merchant_reference
        assert refs(api.get(ADMIN, {"ordering": "-amount"}))[0] == a.merchant_reference
        assert ok(api.get(ADMIN, {"ordering": "-updated_at"}))["count"] == 2
        for bad in ("status", "user__mobile_number", "raw_verification", "-provider_payment_id"):
            assert api.get(ADMIN, {"ordering": bad}).status_code == 400

    def test_list_queries_constant(self, api, student, package):
        paid(student, package)
        with CaptureQueriesContext(connection) as one:
            ok(api.get(ADMIN))
        for _ in range(4):
            paid(make_student(), make_package(f"q-{_}", rules=all_paid(), price=Decimal("50.00")))
        with CaptureQueriesContext(connection) as five:
            assert ok(api.get(ADMIN))["count"] == 5
        assert len(five) == len(one)


# ======================================================================================
# Permissions, re-verify response, no mutations
# ======================================================================================
class TestPermissions:
    def urls(self, payment):
        return (ADMIN, f"{ADMIN}{payment.public_id}/")

    def test_anonymous_and_students_blocked(self, student, package):
        payment = paid(student, package)
        session = APIClient()
        session.force_login(student)
        for url in self.urls(payment):
            assert APIClient().get(url).status_code == 401
            assert jwt_client(student).get(url).status_code == 401
            assert session.get(url).status_code == 403
        reverify = f"{ADMIN}{payment.public_id}/reverify/"
        assert APIClient().post(reverify).status_code == 401
        assert jwt_client(student).post(reverify).status_code == 401
        assert session.post(reverify).status_code == 403

    def test_admin_allowed_read_only(self, api, student, package):
        payment = paid(student, package)
        for url in self.urls(payment):
            assert api.get(url).status_code == 200
            for method in ("put", "patch", "delete"):
                assert (
                    getattr(api, method)(url, {"status": "failed"}, format="json").status_code
                    == 405
                )
        assert refreshed(payment).status == "success"


class TestReverifyResponse:
    def test_safe_contract_and_unchanged_behaviour(self, api, student, package):
        payment = initiate(student, package)
        plant(payment, student)
        url = f"{ADMIN}{payment.public_id}/reverify/"
        body = ok(api.post(url))
        assert set(body) == DETAIL_FIELDS and body["status"] == "pending"
        assert_safe(body, student, refreshed(payment))
        pay_mock(payment)  # the provider now says paid
        body = ok(api.post(url))
        assert set(body) == DETAIL_FIELDS and body["status"] == "success"
        assert body["subscription_id"] == refreshed(payment).subscription_id
        assert body["provider_transaction_id"] == refreshed(payment).provider_transaction_id
        assert_safe(body, student, refreshed(payment))
        assert AuditLog.objects.filter(action="payment.reverify").count() == 2
        types = [e["event_type"] for e in body["events"]]
        assert types.count("admin_reverify") == 2 and types[-1] == "status_changed"
        assert body["events"][-1]["summary"] == {"from": "pending", "to": "success"}

    def test_inactive_package_verified_payment_still_honoured(self, api, student, package):
        payment = initiate(student, package)
        Package.objects.filter(pk=package.pk).update(status="inactive")
        pay_mock(payment)
        body = ok(api.post(f"{ADMIN}{payment.public_id}/reverify/"))
        assert body["status"] == "success" and body["subscription_id"]
