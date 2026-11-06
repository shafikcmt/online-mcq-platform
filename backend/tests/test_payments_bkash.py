"""Choosing between payment methods, and the bKash gateway (against a fake bKash).

The fake records every request, so the tests check not only the outcome but what was sent to
bKash: which endpoint, in which order, with which headers and amount. NOTHING here talks to
the real bKash: see docs/PAYMENT_METHODS.md for the sandbox checklist.
"""

from decimal import Decimal

import pytest
from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured
from rest_framework.test import APIClient

from apps.payments import services
from apps.payments.exceptions import PaymentError
from apps.payments.gateways import CallbackUrls, Customer, Outcome, get_gateway, offered_providers
from apps.payments.gateways.base import CallbackData, GatewayError
from apps.payments.gateways.bkash import BkashGateway
from apps.payments.models import Payment, PaymentEvent, PaymentStatus
from apps.subscriptions.models import Subscription
from config.settings.checks import validate_payment_settings
from tests.test_subscriptions import all_paid, jwt_client, make_package, make_student

pytestmark = pytest.mark.django_db

PAYMENTS = "/api/v1/payments/"
RETURN_URL = "https://app.test/payment-return"
URLS = CallbackUrls(
    success="https://api.test/api/v1/payments/callback/bkash/success/",
    fail="https://api.test/api/v1/payments/callback/bkash/fail/",
    cancel="https://api.test/api/v1/payments/callback/bkash/cancel/",
    ipn="https://api.test/api/v1/payments/ipn/bkash/",
)
CUSTOMER = Customer(name="Rahim", phone="+8801712345678", email="")
BKASH_PAYMENT_ID = "TR0011AbCdEf"
CHECKOUT_URL = "https://sandbox.pay.bka.sh/checkout/abc"


class FakeBkash:
    """Stands in for ``request_json``. ``replies[endpoint]`` is a dict (answered every time),
    an exception (raised), or a list of those (consumed in order, the last one repeats)."""

    def __init__(self):
        self.calls = []
        self.replies = {
            "/token/grant": {"statusCode": "0000", "id_token": "token-1", "expires_in": 3600},
            "/create": {
                "statusCode": "0000",
                "paymentID": BKASH_PAYMENT_ID,
                "bkashURL": CHECKOUT_URL,
            },
            "/payment/status": {"statusCode": "0000", "transactionStatus": "Initiated"},
            "/execute": {"statusCode": "2023", "statusMessage": "refused"},
        }

    def __call__(self, method, url, *, body=None, headers=None, timeout):
        assert url.startswith("https://tokenized.sandbox.bka.sh/v1.2.0-beta/tokenized/checkout")
        endpoint = url.split("/tokenized/checkout", 1)[1]
        self.calls.append(
            {"endpoint": endpoint, "method": method, "body": body, "headers": headers or {}}
        )
        reply = self.replies[endpoint]
        if isinstance(reply, list):
            reply = reply.pop(0) if len(reply) > 1 else reply[0]
        if isinstance(reply, Exception):
            raise reply
        return dict(reply)

    def endpoints(self):
        return [call["endpoint"] for call in self.calls]

    def called(self, endpoint):
        return [call for call in self.calls if call["endpoint"] == endpoint]


def status_answer(payment, status="Completed", **extra):
    return {
        "statusCode": "0000",
        "transactionStatus": status,
        "paymentID": payment.provider_payment_id or BKASH_PAYMENT_ID,
        "trxID": "TRX9A8B7C",
        "amount": f"{payment.amount:.2f}",
        "currency": payment.currency,
        "merchantInvoiceNumber": payment.merchant_reference,
        "intent": "sale",
        **extra,
    }


@pytest.fixture(autouse=True)
def _settings(settings):
    settings.PAYMENT_PROVIDER = "bkash"
    settings.PAYMENT_ENABLED_PROVIDERS = []
    settings.PAYMENT_MOCK_ALLOWED = True
    settings.PAYMENT_CALLBACK_BASE_URL = "https://api.test"
    settings.PAYMENT_RETURN_URL = RETURN_URL
    settings.BKASH_APP_KEY = "test-app-key"  # test-only values
    settings.BKASH_APP_SECRET = "test-app-secret"
    settings.BKASH_USERNAME = "test-user"
    settings.BKASH_PASSWORD = "test-pass"
    settings.BKASH_SANDBOX = True
    settings.BKASH_API_VERSION = "v1.2.0-beta"
    settings.BKASH_TIMEOUT_SECONDS = 5
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def bkash(monkeypatch):
    fake = FakeBkash()
    monkeypatch.setattr("apps.payments.gateways.bkash.request_json", fake)
    return fake


@pytest.fixture
def student():
    return make_student(full_name="Rahim Hossain")


@pytest.fixture
def package():
    return make_package("bk-gold", rules=all_paid(), price=Decimal("500.00"))


def start(student, package, **kwargs):
    payment, _created = services.initiate_payment(student, package.pk, **kwargs)
    return payment


def callback_data(payment_id=BKASH_PAYMENT_ID, status="success"):
    return {"paymentID": payment_id, "status": status}


# --------------------------------------------------------------------------------------
# Which methods are offered
# --------------------------------------------------------------------------------------
class TestOfferedProviders:
    def test_just_the_main_provider_by_default(self, settings):
        settings.PAYMENT_PROVIDER = "mock"
        assert offered_providers() == ["mock"]

    def test_the_list_sets_order_and_drops_duplicates_and_unknown_codes(self, settings):
        settings.PAYMENT_ENABLED_PROVIDERS = ["bkash", "mock", "bkash", "nagad"]
        assert offered_providers() == ["bkash", "mock"]

    def test_mock_is_dropped_where_it_is_not_allowed(self, settings):
        settings.PAYMENT_ENABLED_PROVIDERS = ["bkash", "mock"]
        settings.PAYMENT_MOCK_ALLOWED = False
        assert offered_providers() == ["bkash"]

    def test_unavailable_switches_everything_off(self, settings):
        settings.PAYMENT_PROVIDER = "unavailable"
        settings.PAYMENT_ENABLED_PROVIDERS = ["bkash", "sslcommerz"]
        assert offered_providers() == []


class TestMethodsEndpoint:
    def test_lists_the_offered_methods_in_order(self, settings, student):
        settings.PAYMENT_ENABLED_PROVIDERS = ["bkash", "sslcommerz"]
        response = jwt_client(student).get(f"{PAYMENTS}methods/", HTTP_ACCEPT_LANGUAGE="en")
        assert response.status_code == 200
        assert response.json()["results"] == [
            {"provider": "bkash", "label": "bKash"},
            {"provider": "sslcommerz", "label": "SSLCommerz"},
        ]

    def test_labels_follow_the_requested_language(self, settings, student):
        settings.PAYMENT_ENABLED_PROVIDERS = ["bkash"]
        response = jwt_client(student).get(f"{PAYMENTS}methods/", HTTP_ACCEPT_LANGUAGE="bn")
        assert response.json()["results"] == [{"provider": "bkash", "label": "বিকাশ"}]

    def test_empty_while_payments_are_off(self, settings, student):
        settings.PAYMENT_PROVIDER = "unavailable"
        assert jwt_client(student).get(f"{PAYMENTS}methods/").json() == {"results": []}

    def test_needs_a_signed_in_student(self):
        assert APIClient().get(f"{PAYMENTS}methods/").status_code == 401


# --------------------------------------------------------------------------------------
# Choosing a method when buying
# --------------------------------------------------------------------------------------
class TestChoosingAMethod:
    def test_the_first_offered_method_is_the_default(self, settings, bkash, student, package):
        settings.PAYMENT_ENABLED_PROVIDERS = ["bkash", "mock"]
        payment = start(student, package)
        assert payment.provider == "bkash"
        assert payment.status == PaymentStatus.PENDING

    def test_a_method_can_be_chosen(self, settings, student, package):
        settings.PAYMENT_ENABLED_PROVIDERS = ["bkash", "mock"]
        assert start(student, package, provider="mock").provider == "mock"

    def test_a_method_that_is_not_offered_is_refused_and_nothing_is_written(
        self, settings, student, package
    ):
        settings.PAYMENT_ENABLED_PROVIDERS = ["bkash"]
        with pytest.raises(PaymentError) as caught:
            start(student, package, provider="mock")
        assert caught.value.code == "provider_not_offered"
        assert Payment.objects.count() == 0

    def test_the_api_answers_400_for_a_method_that_is_not_offered(self, settings, student, package):
        settings.PAYMENT_ENABLED_PROVIDERS = ["bkash"]
        response = jwt_client(student).post(
            PAYMENTS, {"package_id": package.pk, "provider": "mock"}, format="json"
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "provider_not_offered"

    def test_the_api_passes_the_chosen_method_on(self, settings, student, package):
        settings.PAYMENT_ENABLED_PROVIDERS = ["bkash", "mock"]
        response = jwt_client(student).post(
            PAYMENTS, {"package_id": package.pk, "provider": "mock"}, format="json"
        )
        assert response.status_code == 201
        assert response.json()["provider"] == "mock"

    def test_a_repeated_key_cannot_switch_the_method(self, settings, student, package):
        settings.PAYMENT_ENABLED_PROVIDERS = ["mock", "bkash"]
        first = start(student, package, provider="mock", idempotency_key="key-1")
        again, created = services.initiate_payment(
            student, package.pk, idempotency_key="key-1", provider="mock"
        )
        assert (again.pk, created) == (first.pk, False)
        with pytest.raises(PaymentError) as caught:
            services.initiate_payment(
                student, package.pk, idempotency_key="key-1", provider="bkash"
            )
        assert caught.value.code == "idempotency_key_reused"


# --------------------------------------------------------------------------------------
# The bKash gateway
# --------------------------------------------------------------------------------------
class TestBkashInitiate:
    def test_creates_a_payment_with_our_reference_amount_and_callback(
        self, bkash, student, package
    ):
        payment = start(student, package)
        assert bkash.endpoints() == ["/token/grant", "/create"]
        create = bkash.called("/create")[0]
        assert create["body"] == {
            "mode": "0011",
            "payerReference": "".join(ch for ch in student.mobile_number if ch.isdigit()),
            "callbackURL": "https://api.test/api/v1/payments/callback/bkash/success/",
            "amount": "500.00",
            "currency": "BDT",
            "intent": "sale",
            "merchantInvoiceNumber": payment.merchant_reference,
        }
        assert create["headers"] == {"Authorization": "token-1", "X-APP-Key": "test-app-key"}
        assert payment.checkout_url == CHECKOUT_URL
        assert payment.provider_payment_id == BKASH_PAYMENT_ID

    def test_the_grant_sends_the_credentials_the_way_bkash_expects(self, bkash, student, package):
        start(student, package)
        grant = bkash.called("/token/grant")[0]
        assert grant["body"] == {"app_key": "test-app-key", "app_secret": "test-app-secret"}
        assert grant["headers"] == {"username": "test-user", "password": "test-pass"}

    def test_the_token_is_reused_not_fetched_for_every_call(self, bkash, student, package):
        start(student, package)
        start(student, make_package("bk-silver", rules=all_paid(), price=Decimal("300.00")))
        assert bkash.endpoints().count("/token/grant") == 1
        assert bkash.endpoints().count("/create") == 2

    def test_a_refused_token_is_replaced_once_and_the_call_repeated(self, bkash, student, package):
        bkash.replies["/token/grant"] = [
            {"statusCode": "0000", "id_token": "old-token"},
            {"statusCode": "0000", "id_token": "new-token"},
        ]
        bkash.replies["/create"] = [
            GatewayError("http_401"),
            {"statusCode": "0000", "paymentID": BKASH_PAYMENT_ID, "bkashURL": CHECKOUT_URL},
        ]
        payment = start(student, package)
        assert payment.status == PaymentStatus.PENDING
        creates = bkash.called("/create")
        assert [call["headers"]["Authorization"] for call in creates] == ["old-token", "new-token"]

    def test_the_token_is_not_kept_in_the_database_or_the_events(self, bkash, student, package):
        payment = start(student, package)
        stored = repr(list(Payment.objects.filter(pk=payment.pk).values())) + repr(
            list(PaymentEvent.objects.filter(payment=payment).values())
        )
        assert "token-1" not in stored
        assert "test-app-secret" not in stored

    @pytest.mark.parametrize(
        "answer",
        [
            {"statusCode": "2001", "statusMessage": "no"},
            {"statusCode": "0000", "paymentID": BKASH_PAYMENT_ID},  # no URL
            {
                "statusCode": "0000",
                "paymentID": BKASH_PAYMENT_ID,
                "bkashURL": "http://insecure.example/pay",
            },
            {"statusCode": "0000", "bkashURL": CHECKOUT_URL},  # no payment id
        ],
    )
    def test_an_unusable_answer_fails_the_payment_cleanly(self, bkash, student, package, answer):
        bkash.replies["/create"] = answer
        payment = start(student, package)
        assert payment.status == PaymentStatus.FAILED
        assert payment.checkout_url == ""

    def test_a_network_problem_fails_the_payment_cleanly(self, bkash, student, package):
        bkash.replies["/create"] = GatewayError("timeout")
        assert start(student, package).status == PaymentStatus.FAILED

    def test_without_credentials_nothing_is_sent(self, settings, bkash, student, package):
        settings.BKASH_APP_SECRET = ""
        payment = start(student, package)
        assert payment.status == PaymentStatus.FAILED
        assert bkash.calls == []


class TestBkashCallbackAndVerify:
    @pytest.fixture
    def payment(self, bkash, student, package):
        return start(student, package)

    def test_the_callback_is_parsed_but_carries_no_authority(self):
        data = BkashGateway().handle_callback(
            {"paymentID": BKASH_PAYMENT_ID, "status": "SUCCESS", "evil": "x"}
        )
        assert data.provider_payment_id == BKASH_PAYMENT_ID
        assert data.reported_status == "success"
        assert data.merchant_reference == ""
        assert "evil" not in data.raw

    def test_a_completed_payment_is_paid_without_executing_again(self, bkash, payment):
        bkash.replies["/payment/status"] = status_answer(payment, "Completed")
        result = get_gateway("bkash").verify(
            payment, BkashGateway().handle_callback(callback_data())
        )
        assert result.outcome == Outcome.PAID
        assert (result.provider_transaction_id, result.amount, result.currency) == (
            "TRX9A8B7C",
            Decimal("500.00"),
            "BDT",
        )
        assert result.merchant_reference == payment.merchant_reference
        assert bkash.called("/execute") == []

    def test_an_authorized_payment_is_executed_and_then_paid(self, bkash, payment):
        bkash.replies["/payment/status"] = status_answer(payment, "Authorized")
        bkash.replies["/execute"] = status_answer(payment, "Completed")
        result = BkashGateway().verify(payment, BkashGateway().handle_callback(callback_data()))
        assert result.outcome == Outcome.PAID
        assert bkash.endpoints()[-2:] == ["/payment/status", "/execute"]
        assert bkash.called("/execute")[0]["body"] == {"paymentID": BKASH_PAYMENT_ID}

    def test_a_callback_that_does_not_claim_success_never_executes(self, bkash, payment):
        bkash.replies["/payment/status"] = status_answer(payment, "Authorized")
        result = BkashGateway().verify(
            payment, BkashGateway().handle_callback(callback_data(status="failure"))
        )
        assert result.outcome == Outcome.PENDING
        assert bkash.called("/execute") == []

    def test_a_timed_out_execute_is_followed_by_a_fresh_status_check(self, bkash, payment):
        bkash.replies["/payment/status"] = [
            status_answer(payment, "Authorized"),
            status_answer(payment, "Completed"),
        ]
        bkash.replies["/execute"] = GatewayError("timeout")
        result = BkashGateway().verify(payment, BkashGateway().handle_callback(callback_data()))
        assert result.outcome == Outcome.PAID  # the money had moved after all
        assert bkash.endpoints()[-3:] == ["/payment/status", "/execute", "/payment/status"]

    def test_a_refused_execute_leaves_the_payment_for_the_status_check_to_decide(
        self, bkash, payment
    ):
        bkash.replies["/payment/status"] = [
            status_answer(payment, "Authorized"),
            status_answer(payment, "Failed"),
        ]
        bkash.replies["/execute"] = {"statusCode": "2023", "statusMessage": "insufficient balance"}
        result = BkashGateway().verify(payment, BkashGateway().handle_callback(callback_data()))
        assert result.outcome == Outcome.FAILED

    @pytest.mark.parametrize(
        ("status", "outcome"),
        [
            ("Initiated", Outcome.PENDING),
            ("Authorized", Outcome.PENDING),
            ("Failed", Outcome.FAILED),
            ("Cancelled", Outcome.CANCELLED),
            ("Weird", Outcome.ERROR),
        ],
    )
    def test_query_maps_every_status_and_never_executes(self, bkash, payment, status, outcome):
        bkash.replies["/payment/status"] = status_answer(payment, status)
        assert BkashGateway().query(payment).outcome == outcome
        assert bkash.called("/execute") == []

    def test_an_error_answer_changes_nothing(self, bkash, payment):
        bkash.replies["/payment/status"] = {"statusCode": "2062", "statusMessage": "x"}
        result = BkashGateway().query(payment)
        assert (result.outcome, result.reason) == (Outcome.ERROR, "status_2062")

    def test_a_network_problem_is_an_error_not_an_exception(self, bkash, payment):
        bkash.replies["/payment/status"] = GatewayError("timeout")
        assert BkashGateway().query(payment).outcome == Outcome.ERROR
        assert (
            BkashGateway()
            .verify(payment, CallbackData(provider_payment_id=BKASH_PAYMENT_ID))
            .outcome
            == Outcome.ERROR
        )

    def test_a_payment_without_a_bkash_id_is_not_found(self, bkash, student, package):
        payment = Payment.objects.create(
            merchant_reference="MCQ" + "A" * 24,
            user=student,
            package=package,
            provider="bkash",
            amount=Decimal("500.00"),
            currency="BDT",
            validity_days=30,
        )
        assert BkashGateway().query(payment).outcome == Outcome.NOT_FOUND
        assert bkash.calls == []


# --------------------------------------------------------------------------------------
# The whole path through the payment service: only a server-checked answer grants anything
# --------------------------------------------------------------------------------------
class TestBkashEndToEnd:
    def test_a_successful_callback_activates_the_package(self, bkash, student, package):
        payment = start(student, package)
        bkash.replies["/payment/status"] = status_answer(payment, "Authorized")
        bkash.replies["/execute"] = status_answer(payment, "Completed")
        result = services.process_callback("bkash", "success", callback_data())
        assert result.pk == payment.pk
        payment.refresh_from_db()
        assert payment.status == PaymentStatus.SUCCESS
        assert payment.provider_transaction_id == "TRX9A8B7C"
        assert Subscription.objects.filter(user=student, package=package).exists()

    def test_a_replayed_callback_asks_bkash_nothing(self, bkash, student, package):
        payment = start(student, package)
        bkash.replies["/payment/status"] = status_answer(payment, "Completed")
        services.process_callback("bkash", "success", callback_data())
        calls = len(bkash.calls)
        services.process_callback("bkash", "success", callback_data())
        assert len(bkash.calls) == calls

    def test_a_callback_claiming_success_cannot_grant_when_bkash_says_otherwise(
        self, bkash, student, package
    ):
        payment = start(student, package)
        bkash.replies["/payment/status"] = status_answer(payment, "Initiated")
        services.process_callback("bkash", "success", callback_data(status="success"))
        payment.refresh_from_db()
        assert payment.status == PaymentStatus.PENDING
        assert not Subscription.objects.filter(user=student).exists()

    @pytest.mark.parametrize(
        "tamper",
        [
            {"amount": "1.00"},
            {"currency": "USD"},
            {"merchantInvoiceNumber": "MCQSOMEONEELSE"},
            {"merchantInvoiceNumber": ""},
        ],
    )
    def test_a_completed_answer_that_does_not_match_our_record_grants_nothing(
        self, bkash, student, package, tamper
    ):
        payment = start(student, package)
        bkash.replies["/payment/status"] = status_answer(payment, "Completed", **tamper)
        services.process_callback("bkash", "success", callback_data())
        payment.refresh_from_db()
        assert payment.status != PaymentStatus.SUCCESS
        assert not Subscription.objects.filter(user=student).exists()

    def test_an_unknown_bkash_payment_id_is_ignored(self, bkash, student, package):
        start(student, package)
        before = len(bkash.calls)
        assert (
            services.process_callback("bkash", "success", callback_data(payment_id="TR0011Unknown"))
            is None
        )
        assert len(bkash.calls) == before

    def test_the_payment_is_not_found_through_another_providers_id(self, bkash, student, package):
        payment = start(student, package)
        assert (
            services.process_callback(
                "sslcommerz", "success", {"paymentID": payment.provider_payment_id}
            )
            is None
        )

    def test_the_browser_is_sent_back_to_the_return_page(self, bkash, student, package):
        payment = start(student, package)
        bkash.replies["/payment/status"] = status_answer(payment, "Completed")
        response = APIClient().get(
            f"{PAYMENTS}callback/bkash/success/?paymentID={BKASH_PAYMENT_ID}&status=success"
        )
        assert response.status_code == 302
        assert response["Location"].startswith(RETURN_URL)
        assert "status=success" in response["Location"]
        assert str(payment.public_id) in response["Location"]

    def test_reconciliation_finishes_a_payment_the_student_never_returned_from(
        self, bkash, student, package, settings
    ):
        from datetime import timedelta

        from django.utils import timezone

        payment = start(student, package)
        Payment.objects.filter(pk=payment.pk).update(created_at=timezone.now() - timedelta(hours=2))
        bkash.replies["/payment/status"] = status_answer(payment, "Completed")
        services.reconcile_payments()
        payment.refresh_from_db()
        assert payment.status == PaymentStatus.SUCCESS
        assert bkash.called("/execute") == []  # a background job never takes money


# --------------------------------------------------------------------------------------
# Production refuses a half-configured provider
# --------------------------------------------------------------------------------------
GOOD = {
    "provider": "bkash",
    "providers": {"mock": "x", "sslcommerz": "y", "bkash": "z"},
    "store_id": "",
    "store_password": "",
    "sandbox": False,
    "allow_sandbox": False,
    "callback_base_url": "https://api.example.com",
    "return_url": "https://example.com/return",
    "bkash_credentials": ("real-key", "real-secret", "real-user", "real-pass"),
    "bkash_sandbox": False,
}


class TestProductionSettings:
    def test_a_fully_configured_bkash_is_accepted(self):
        validate_payment_settings(**GOOD)

    @pytest.mark.parametrize(
        "override",
        [
            {"bkash_credentials": ("", "real-secret", "real-user", "real-pass")},
            {"bkash_credentials": ("real-key", "change-me", "real-user", "real-pass")},
            {"bkash_credentials": ("real-key", "real-secret", "real-user", "")},
            {"bkash_sandbox": True},
            {"enabled": ["bkash", "mock"]},
            {"enabled": ["bkash", "nagad"]},
            {"enabled": ["bkash", "sslcommerz"]},  # sslcommerz without its store id/password
        ],
    )
    def test_unsafe_combinations_are_refused(self, override):
        with pytest.raises(ImproperlyConfigured):
            validate_payment_settings(**{**GOOD, **override})

    def test_two_methods_each_with_credentials_are_accepted(self):
        validate_payment_settings(
            **{
                **GOOD,
                "enabled": ["bkash", "sslcommerz"],
                "store_id": "real",
                "store_password": "real-password-value",
            }
        )

    def test_sandbox_is_allowed_only_with_the_explicit_flag(self):
        validate_payment_settings(**{**GOOD, "bkash_sandbox": True, "allow_sandbox": True})

    def test_the_system_check_reports_an_unregistered_method(self, settings):
        from apps.payments.checks import check_payment_settings

        settings.PAYMENT_ENABLED_PROVIDERS = ["bkash", "nagad"]
        assert [m.id for m in check_payment_settings(None)] == ["payments.E005"]
