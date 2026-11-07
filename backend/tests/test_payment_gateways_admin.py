"""Phase 3 of the dynamic gateway system: the gateway manager (database first, environment
fallback), per-channel offers and return URLs, sandbox testers and test subscriptions, and
the admin API with password re-confirmation. Providers are faked; nothing here talks to a
real bKash or SSLCommerz."""

import itertools
import json
from decimal import Decimal

import pytest
from cryptography.fernet import Fernet
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.audit.models import AuditLog
from apps.audit.services import AuditContext
from apps.dashboard import selectors as dashboard_selectors
from apps.payments import gateway_admin, gateway_manager, gateway_store, services
from apps.payments.gateways import Outcome
from apps.payments.models import (
    GatewayLogType,
    Payment,
    PaymentEvent,
    PaymentGateway,
    PaymentGatewayLog,
    PaymentStatus,
    PaymentTester,
)
from apps.subscriptions.models import Subscription, SubscriptionStatus
from apps.subscriptions.selectors import user_can_access_exam
from tests.test_subscriptions import all_paid, jwt_client, make_package, make_student

pytestmark = pytest.mark.django_db

ADMIN = "/api/v1/admin/payment-gateways/"
PAYMENTS = "/api/v1/payments/"
PASSWORD = "Strong-Pass-2026"  # test-only value
KEY = Fernet.generate_key().decode()
APP_RETURN = "mcqapp://payment-result"
WEB_RETURN = "https://site.test/payment-return"
_n = itertools.count(1)

SANDBOX_CREDS = {
    "app_key": "sbx-app-key-0001",
    "app_secret": "sbx-app-secret-0001",
    "username": "sbx-user-0001",
    "password": "sbx-pass-0001",
}
LIVE_CREDS = {
    "app_key": "live-app-key-0002",
    "app_secret": "live-app-secret-0002",
    "username": "live-user-0002",
    "password": "live-pass-0002",
}


class RecordingBkash:
    """Stands in for ``request_json``: records every call (url, headers) and answers like a
    working bKash, whichever host or merchant is used."""

    def __init__(self):
        self.calls = []
        self.fail_token = False
        self.status = "Initiated"

    def __call__(self, method, url, *, body=None, headers=None, timeout):
        from apps.payments.gateways.base import GatewayError

        endpoint = url.split("/tokenized/checkout", 1)[1]
        self.calls.append(
            {"endpoint": endpoint, "url": url, "body": body, "headers": headers or {}}
        )
        if endpoint == "/token/grant":
            if self.fail_token:
                raise GatewayError("http_401")
            return {"statusCode": "0000", "id_token": f"token-for-{(headers or {})['username']}"}
        if endpoint == "/create":
            return {
                "statusCode": "0000",
                "paymentID": f"TR{next(_n):06d}",
                "bkashURL": "https://checkout.bkash.test/abc",
            }
        if endpoint == "/payment/status":
            return {"statusCode": "0000", "transactionStatus": self.status, **self.extra}
        return {"statusCode": "2023"}

    extra: dict = {}

    def used(self, endpoint):
        return [c for c in self.calls if c["endpoint"] == endpoint]


@pytest.fixture(autouse=True)
def _env(settings):
    settings.SECRET_ENCRYPTION_KEY = KEY
    settings.PAYMENT_PROVIDER = "bkash"
    settings.PAYMENT_ENABLED_PROVIDERS = []
    settings.PAYMENT_MOCK_ALLOWED = True
    settings.PAYMENT_CALLBACK_BASE_URL = "https://api.test"
    settings.PAYMENT_RETURN_URL = APP_RETURN
    settings.PAYMENT_WEB_RETURN_URL = WEB_RETURN
    settings.BKASH_APP_KEY = settings.BKASH_APP_SECRET = ""
    settings.BKASH_USERNAME = settings.BKASH_PASSWORD = ""
    settings.BKASH_SANDBOX = True
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def bkash(monkeypatch):
    fake = RecordingBkash()
    fake.extra = {}
    monkeypatch.setattr("apps.payments.gateways.bkash.request_json", fake)
    return fake


@pytest.fixture
def admin_user():
    return User.objects.create_user(
        f"0161200{next(_n):04d}", password=PASSWORD, full_name="Ops", role=Role.ADMIN
    )


@pytest.fixture
def api(admin_user):
    client = APIClient()
    client.force_login(admin_user)
    return client


@pytest.fixture
def ctx(admin_user):
    return AuditContext(actor=admin_user, ip_address="203.0.113.9")


@pytest.fixture
def student():
    return make_student(full_name="Rahim Hossain", email="rahim@example.org")


@pytest.fixture
def package():
    return make_package(f"gold-{next(_n)}", rules=all_paid(), price=Decimal("500.00"))


def make_gateway(ctx, *, slug=None, mode="sandbox", enabled=True, creds=SANDBOX_CREDS, **fields):
    n = next(_n)
    gateway = PaymentGateway.objects.create(
        slug=slug or f"bkash-{n}",
        adapter=fields.pop("adapter", "bkash"),
        name_en=fields.pop("name_en", "bKash"),
        currencies=fields.pop("currencies", ["BDT"]),
        mode=mode,
        enabled=enabled,
        **fields,
    )
    if creds:
        gateway_store.save_credentials(gateway, mode, creds, ctx=ctx)
    return gateway


def post(api, url, body=None):
    return api.post(url, body or {}, format="json")


def error_code(response):
    return response.json()["error"]["code"]


def start(user, package, **kwargs):
    payment, _created = services.initiate_payment(user, package.pk, **kwargs)
    return payment


def make_tester(user, admin_user):
    PaymentTester.objects.create(user=user, added_by=admin_user)
    return user


def pay_success(payment, bkash, trx="TRX1"):
    """Drive a bKash payment to paid through the real verification path."""
    bkash.status = "Completed"
    bkash.extra = {
        "trxID": trx,
        "amount": f"{payment.amount:.2f}",
        "currency": payment.currency,
        "merchantInvoiceNumber": payment.merchant_reference,
        "paymentID": payment.provider_payment_id,
    }
    result = services.admin_reverify.__globals__["_query"](payment)
    assert result.outcome == Outcome.PAID, result
    return services.apply_verification(payment.pk, result, source="test")


# ======================================================================================
# Admin API: access
# ======================================================================================
class TestAccess:
    URLS = [
        ("get", ADMIN),
        ("get", f"{ADMIN}adapters/"),
        ("get", f"{ADMIN}stats/"),
        ("get", "/api/v1/admin/payment-testers/"),
        ("post", ADMIN),
    ]

    @pytest.mark.parametrize(("method", "url"), URLS)
    def test_anonymous_refused(self, method, url):
        assert getattr(APIClient(), method)(url).status_code in (401, 403)

    @pytest.mark.parametrize(("method", "url"), URLS)
    def test_student_refused(self, method, url, student):
        assert getattr(jwt_client(student), method)(url).status_code in (401, 403)

    def test_student_cannot_reach_a_gateway_even_with_its_id(self, student, ctx):
        gateway = make_gateway(ctx)
        client = jwt_client(student)
        assert client.get(f"{ADMIN}{gateway.public_id}/").status_code in (401, 403)
        assert client.post(f"{ADMIN}{gateway.public_id}/credentials/", {}).status_code in (401, 403)


# ======================================================================================
# Admin API: adapters, create, update
# ======================================================================================
class TestAdaptersAndCreate:
    def test_adapters_list_marks_unimplemented(self, api):
        rows = {r["code"]: r for r in api.get(f"{ADMIN}adapters/").json()["results"]}
        assert rows["bkash"]["implemented"] and rows["sslcommerz"]["implemented"]
        assert not rows["nagad"]["implemented"] and not rows["rocket"]["implemented"]
        assert [f["name"] for f in rows["bkash"]["credentials"]] == [
            "app_key",
            "app_secret",
            "username",
            "password",
        ]
        assert all(f["kind"] == "secret" for f in rows["bkash"]["credentials"])
        assert "test_connection" in rows["bkash"]["capabilities"]
        assert "test_connection" not in rows["sslcommerz"]["capabilities"]

    def test_create_with_defaults(self, api):
        response = post(api, ADMIN, {"adapter": "bkash", "slug": "bkash-main"})
        assert response.status_code == 201
        body = response.json()
        assert body["enabled"] is False and body["mode"] == "sandbox"
        assert body["currencies"] == ["BDT"] and body["name_en"].startswith("bKash")
        assert body["options"] == {"api_version": "v1.2.0-beta", "timeout_seconds": 15}
        assert PaymentGatewayLog.objects.filter(event_type=GatewayLogType.CREATED).count() == 1
        assert AuditLog.objects.filter(action="payment_gateway.create").count() == 1

    def test_two_merchant_accounts_of_one_adapter(self, api):
        assert post(api, ADMIN, {"adapter": "bkash", "slug": "bkash-a"}).status_code == 201
        assert post(api, ADMIN, {"adapter": "bkash", "slug": "bkash-b"}).status_code == 201
        assert len(api.get(ADMIN).json()["results"]) == 2

    def test_duplicate_slug_refused(self, api):
        post(api, ADMIN, {"adapter": "bkash", "slug": "same-one"})
        assert post(api, ADMIN, {"adapter": "sslcommerz", "slug": "same-one"}).status_code == 400

    @pytest.mark.parametrize("adapter", ["nagad", "rocket"])
    def test_unimplemented_adapters_cannot_be_created(self, api, adapter):
        response = post(api, ADMIN, {"adapter": adapter, "slug": f"{adapter}-1"})
        assert response.status_code == 409 and error_code(response) == "adapter_not_implemented"
        assert not PaymentGateway.objects.exists()

    def test_unknown_adapter_and_bad_slug(self, api):
        assert post(api, ADMIN, {"adapter": "paypal", "slug": "pp"}).status_code == 400
        assert post(api, ADMIN, {"adapter": "bkash", "slug": "Bad Slug"}).status_code == 400

    def test_mock_cannot_be_created_where_it_is_not_allowed(self, api, settings):
        settings.PAYMENT_MOCK_ALLOWED = False
        response = post(api, ADMIN, {"adapter": "mock", "slug": "mock-1"})
        assert response.status_code == 409

    def test_options_are_checked_against_the_schema(self, api):
        bad = post(api, ADMIN, {"adapter": "bkash", "slug": "b1", "options": {"evil": "x"}})
        assert bad.status_code == 400
        too_big = post(
            api, ADMIN, {"adapter": "bkash", "slug": "b2", "options": {"timeout_seconds": 9999}}
        )
        assert too_big.status_code == 400

    def test_nothing_executable_is_accepted(self, api):
        response = post(
            api,
            ADMIN,
            {"adapter": "bkash", "slug": "b3", "options": {"code": "__import__('os')"}},
        )
        assert response.status_code == 400


class TestUpdate:
    def test_edit_display_and_limits(self, api, ctx):
        gateway = make_gateway(ctx, creds=None)
        response = api.patch(
            f"{ADMIN}{gateway.public_id}/",
            {
                "name_en": "bKash Personal",
                "name_bn": "বিকাশ",
                "description_en": "Pay with bKash",
                "logo_url": "https://cdn.test/bkash.png",
                "priority": 5,
                "currencies": ["BDT"],
                "min_amount": "10",
                "max_amount": "25000",
                "web_enabled": False,
            },
            format="json",
        )
        assert response.status_code == 200, response.json()
        body = response.json()
        assert body["name_bn"] == "বিকাশ" and body["priority"] == 5 and body["web_enabled"] is False
        assert body["min_amount"] == "10.00"
        log = PaymentGatewayLog.objects.get(event_type=GatewayLogType.CONFIG_CHANGED)
        assert "name_en" in log.details["fields"] and log.actor is not None
        assert AuditLog.objects.filter(action="payment_gateway.update").count() == 1

    def test_no_change_writes_nothing(self, api, ctx):
        gateway = make_gateway(ctx, creds=None)
        api.patch(f"{ADMIN}{gateway.public_id}/", {"name_en": gateway.name_en}, format="json")
        assert not PaymentGatewayLog.objects.filter(event_type=GatewayLogType.CONFIG_CHANGED)

    @pytest.mark.parametrize(
        "body",
        [
            {"slug": "renamed"},
            {"adapter": "sslcommerz"},
            {"mode": "live"},
            {"enabled": True},
            {"app_secret": "x"},
        ],
    )
    def test_only_schema_fields_can_be_patched(self, api, ctx, body):
        gateway = make_gateway(ctx, creds=None)
        assert api.patch(f"{ADMIN}{gateway.public_id}/", body, format="json").status_code == 400

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("web_return_url", "http://site.test/ret"),
            ("web_return_url", "javascript:alert(1)"),
            ("web_return_url", "mcqapp://x"),
            ("app_return_url", "javascript:alert(1)"),
            ("app_return_url", "data:text/html,x"),
            ("app_return_url", "http://insecure.test"),
            ("logo_url", "http://cdn.test/x.png"),
            ("priority", -1),
            ("priority", "high"),
            ("currencies", ["USD"]),
            ("currencies", []),
            ("min_amount", "-5"),
            ("min_amount", "abc"),
        ],
    )
    def test_invalid_values_refused(self, api, ctx, field, value):
        gateway = make_gateway(ctx, creds=None)
        response = api.patch(f"{ADMIN}{gateway.public_id}/", {field: value}, format="json")
        assert response.status_code == 400

    def test_max_below_min_refused(self, api, ctx):
        gateway = make_gateway(ctx, creds=None)
        response = api.patch(
            f"{ADMIN}{gateway.public_id}/", {"min_amount": "100", "max_amount": "50"}, format="json"
        )
        assert response.status_code == 400

    def test_separate_return_urls_for_website_and_app(self, api, ctx):
        gateway = make_gateway(ctx, creds=None)
        response = api.patch(
            f"{ADMIN}{gateway.public_id}/",
            {"web_return_url": "https://site.test/done", "app_return_url": "mcqapp://done"},
            format="json",
        )
        assert response.status_code == 200
        assert response.json()["app_return_url"] == "mcqapp://done"

    def test_unknown_gateway_is_404(self, api):
        assert api.get(f"{ADMIN}00000000-0000-4000-8000-000000000000/").status_code == 404


# ======================================================================================
# Admin API: credentials and password re-confirmation
# ======================================================================================
class TestCredentials:
    def url(self, gateway):
        return f"{ADMIN}{gateway.public_id}/credentials/"

    def test_saved_encrypted_and_never_returned(self, api, ctx):
        gateway = make_gateway(ctx, creds=None)
        response = post(
            api,
            self.url(gateway),
            {"mode": "sandbox", "values": SANDBOX_CREDS, "password": PASSWORD},
        )
        assert response.status_code == 200
        assert sorted(response.json()["changed"]) == sorted(SANDBOX_CREDS)
        creds = response.json()["gateway"]["credentials"]["sandbox"]
        assert creds["app_secret"] == {"set": True, "hint": "0001"}
        assert response.json()["gateway"]["credentials"]["live"]["app_secret"]["set"] is False
        everything = json.dumps(
            [
                response.json(),
                api.get(ADMIN).json(),
                api.get(f"{ADMIN}{gateway.public_id}/logs/").json(),
                list(AuditLog.objects.values("summary", "metadata")),
                list(PaymentGatewayLog.objects.values("summary", "details")),
            ],
            default=str,
        )
        for secret in SANDBOX_CREDS.values():
            assert secret not in everything

    @pytest.mark.parametrize("password", ["", "wrong-password", None, 123])
    def test_wrong_or_missing_password_refused_and_nothing_saved(self, api, ctx, password):
        gateway = make_gateway(ctx, creds=None)
        body = {"mode": "sandbox", "values": SANDBOX_CREDS}
        if password is not None:
            body["password"] = password
        response = post(api, self.url(gateway), body)
        assert response.status_code == 403
        assert error_code(response) == "password_confirmation_failed"
        assert gateway_store.credential_hints(gateway, "sandbox") == {}

    def test_repeated_wrong_passwords_lock_the_action(self, api, ctx):
        gateway = make_gateway(ctx, creds=None)
        body = {"mode": "sandbox", "values": SANDBOX_CREDS, "password": "nope"}
        for _ in range(gateway_admin.REAUTH_FAILURES):
            assert post(api, self.url(gateway), body).status_code == 403
        locked = post(api, self.url(gateway), {**body, "password": PASSWORD})
        assert locked.status_code == 429 and error_code(locked) == "reauth_locked"

    def test_right_password_resets_the_budget(self, api, ctx):
        gateway = make_gateway(ctx, creds=None)
        body = {"mode": "sandbox", "values": {"app_key": "k-0000000001"}}
        post(api, self.url(gateway), {**body, "password": "nope"})
        assert post(api, self.url(gateway), {**body, "password": PASSWORD}).status_code == 200
        for _ in range(gateway_admin.REAUTH_FAILURES - 1):
            post(api, self.url(gateway), {**body, "password": "nope"})
        assert post(api, self.url(gateway), {**body, "password": PASSWORD}).status_code == 200

    def test_unknown_credential_names_refused(self, api, ctx):
        gateway = make_gateway(ctx, creds=None)
        response = post(
            api,
            self.url(gateway),
            {"mode": "sandbox", "values": {"evil": "value-123456"}, "password": PASSWORD},
        )
        assert response.status_code == 400
        assert not gateway.credentials.exists()

    def test_blank_value_keeps_the_stored_secret(self, api, ctx):
        gateway = make_gateway(ctx)
        post(
            api,
            self.url(gateway),
            {"mode": "sandbox", "values": {"app_secret": ""}, "password": PASSWORD},
        )
        assert (
            gateway_store.read_credentials(gateway, "sandbox")["app_secret"]
            == SANDBOX_CREDS["app_secret"]
        )

    def test_sandbox_and_live_stay_separate(self, api, ctx):
        gateway = make_gateway(ctx)
        post(api, self.url(gateway), {"mode": "live", "values": LIVE_CREDS, "password": PASSWORD})
        assert (
            gateway_store.read_credentials(gateway, "sandbox")["app_key"]
            == SANDBOX_CREDS["app_key"]
        )
        assert gateway_store.read_credentials(gateway, "live")["app_key"] == LIVE_CREDS["app_key"]

    def test_no_encryption_key_is_a_clean_failure(self, api, ctx, settings):
        gateway = make_gateway(ctx, creds=None)
        settings.SECRET_ENCRYPTION_KEY = ""
        response = post(
            api,
            self.url(gateway),
            {"mode": "sandbox", "values": SANDBOX_CREDS, "password": PASSWORD},
        )
        assert response.status_code >= 400
        assert not gateway.credentials.exists()


# ======================================================================================
# Admin API: mode, enable, test, logs, stats
# ======================================================================================
class TestModeAndEnable:
    def mode(self, api, gateway, mode, password=PASSWORD):
        return post(api, f"{ADMIN}{gateway.public_id}/mode/", {"mode": mode, "password": password})

    def test_live_needs_password(self, api, ctx):
        gateway = make_gateway(ctx)
        assert self.mode(api, gateway, "live", "wrong").status_code == 403

    def test_live_refused_until_credentials_and_a_sandbox_payment(
        self, api, ctx, bkash, student, package, admin_user
    ):
        gateway = make_gateway(ctx)
        refused = self.mode(api, gateway, "live")
        assert refused.status_code == 409 and error_code(refused) == "live_not_ready"
        blockers = refused.json()["error"]["details"]["blockers"]
        assert "no_successful_sandbox_payment" in blockers
        assert "missing_credential:app_key" in blockers

        gateway_store.save_credentials(gateway, "live", LIVE_CREDS, ctx=ctx)
        again = self.mode(api, gateway, "live")
        assert again.json()["error"]["details"]["blockers"] == ["no_successful_sandbox_payment"]

        make_tester(student, admin_user)
        payment = start(student, package, gateway=gateway.slug)
        pay_success(payment, bkash)
        assert gateway_store.sandbox_payment_succeeded(gateway)
        ok = self.mode(api, gateway, "live")
        assert ok.status_code == 200 and ok.json()["mode"] == "live"

    def test_back_to_sandbox_allowed(self, api, ctx):
        gateway = make_gateway(ctx, mode="live", creds=LIVE_CREDS)
        assert self.mode(api, gateway, "sandbox").json()["mode"] == "sandbox"

    def test_enable_needs_a_ready_gateway(self, api, ctx):
        gateway = make_gateway(ctx, enabled=False, creds=None)
        response = post(api, f"{ADMIN}{gateway.public_id}/enable/")
        assert response.status_code == 409 and error_code(response) == "gateway_not_ready"
        assert "missing_credential:app_key" in response.json()["error"]["details"]["issues"]
        gateway_store.save_credentials(gateway, "sandbox", SANDBOX_CREDS, ctx=ctx)
        assert post(api, f"{ADMIN}{gateway.public_id}/enable/").json()["enabled"] is True
        assert post(api, f"{ADMIN}{gateway.public_id}/disable/").json()["enabled"] is False
        events = list(PaymentGatewayLog.objects.values_list("event_type", flat=True))
        assert GatewayLogType.ENABLED in events and GatewayLogType.DISABLED in events

    def test_status_reports_why_not_ready(self, api, ctx):
        gateway = make_gateway(ctx, creds={"app_key": "only-the-key-1"})
        body = api.get(f"{ADMIN}{gateway.public_id}/").json()
        assert "missing_credential:app_secret" in body["issues"]


class TestConnectionTest:
    def test_bkash_passes_with_a_working_token(self, api, ctx, bkash):
        gateway = make_gateway(ctx)
        response = post(api, f"{ADMIN}{gateway.public_id}/test/")
        assert response.status_code == 200
        assert response.json()["result"] == {
            "supported": True,
            "ok": True,
            "message": "token_granted",
        }
        health = response.json()["gateway"]["health"]
        assert health["status"] == "ok" and health["last_connected_at"]
        assert bkash.used("/create") == []  # no payment was started

    def test_failure_is_recorded_not_hidden(self, api, ctx, bkash):
        gateway = make_gateway(ctx)
        bkash.fail_token = True
        body = post(api, f"{ADMIN}{gateway.public_id}/test/").json()
        assert body["result"]["ok"] is False
        assert body["gateway"]["health"]["status"] == "failed"
        assert body["gateway"]["health"]["last_connected_at"] is None

    def test_unsupported_adapter_is_never_a_pass(self, api, ctx):
        gateway = make_gateway(
            ctx,
            adapter="sslcommerz",
            slug="ssl-1",
            creds={"store_id": "teststore0001", "store_password": "storepass-0001"},
        )
        body = post(api, f"{ADMIN}{gateway.public_id}/test/").json()
        assert body["result"]["supported"] is False and body["result"]["ok"] is False
        assert body["gateway"]["health"]["status"] == "unsupported"

    def test_incomplete_gateway_fails_without_calling_the_provider(self, api, ctx, bkash):
        gateway = make_gateway(ctx, creds=None)
        body = post(api, f"{ADMIN}{gateway.public_id}/test/").json()
        assert body["result"]["ok"] is False and bkash.calls == []

    def test_cooldown(self, api, ctx, bkash):
        gateway = make_gateway(ctx)
        assert post(api, f"{ADMIN}{gateway.public_id}/test/").status_code == 200
        assert post(api, f"{ADMIN}{gateway.public_id}/test/").status_code == 429

    def test_logs_list_the_history(self, api, ctx, bkash):
        gateway = make_gateway(ctx)
        post(api, f"{ADMIN}{gateway.public_id}/test/")
        events = [
            r["event_type"] for r in api.get(f"{ADMIN}{gateway.public_id}/logs/").json()["results"]
        ]
        assert "connection_test" in events and "credential_changed" in events


# ======================================================================================
# Manager: what students are offered
# ======================================================================================
class TestOffers:
    def offers(self, user, channel="", **kw):
        return gateway_manager.available_offers(user, channel, **kw)

    def test_environment_fallback_when_the_database_is_empty(self, settings, student):
        settings.BKASH_APP_KEY, settings.BKASH_APP_SECRET = "k", "s"
        [offer] = self.offers(student)
        assert offer.adapter == "bkash" and offer.source == "env" and offer.gateway is None

    def test_database_wins_over_the_environment_for_its_adapter(self, ctx, student):
        make_gateway(ctx, enabled=False)
        assert self.offers(student) == []  # env bkash is NOT offered once the panel owns it

    def test_other_adapters_still_fall_back_to_the_environment(self, ctx, student, settings):
        settings.PAYMENT_ENABLED_PROVIDERS = ["bkash", "sslcommerz"]
        make_gateway(ctx, mode="live", creds=LIVE_CREDS, enabled=True)
        slugs = [o.slug for o in self.offers(student)]
        assert slugs[-1] == "sslcommerz" and len(slugs) == 2

    def test_unavailable_switches_everything_off(self, ctx, student, settings):
        make_gateway(ctx, mode="live", creds=LIVE_CREDS)
        settings.PAYMENT_PROVIDER = "unavailable"
        assert self.offers(student) == []

    def test_disabled_and_incomplete_gateways_are_not_offered(self, ctx, student):
        make_gateway(ctx, mode="live", creds=LIVE_CREDS, enabled=False)
        make_gateway(ctx, mode="live", creds={"app_key": "only-one-key-1"}, enabled=True)
        assert self.offers(student) == []

    def test_priority_order(self, ctx, student):
        make_gateway(ctx, slug="late", mode="live", creds=LIVE_CREDS, priority=50)
        make_gateway(ctx, slug="early", mode="live", creds=LIVE_CREDS, priority=1)
        assert [o.slug for o in self.offers(student)] == ["early", "late"]

    def test_website_and_app_availability_are_separate(self, ctx, student):
        make_gateway(ctx, slug="web-only", mode="live", creds=LIVE_CREDS, app_enabled=False)
        make_gateway(ctx, slug="app-only", mode="live", creds=LIVE_CREDS, web_enabled=False)
        assert [o.slug for o in self.offers(student, "web")] == ["web-only"]
        assert [o.slug for o in self.offers(student, "app")] == ["app-only"]
        assert {o.slug for o in self.offers(student, "")} == {"web-only", "app-only"}

    def test_amount_and_currency_limits(self, ctx, student):
        make_gateway(
            ctx,
            slug="mid",
            mode="live",
            creds=LIVE_CREDS,
            min_amount=Decimal("100"),
            max_amount=Decimal("1000"),
        )
        assert self.offers(student, amount=Decimal("500"), currency="BDT")
        assert not self.offers(student, amount=Decimal("50"), currency="BDT")
        assert not self.offers(student, amount=Decimal("5000"), currency="BDT")
        assert not self.offers(student, amount=Decimal("500"), currency="USD")

    def test_unreadable_credentials_make_it_not_ready(self, ctx, student, settings):
        gateway = make_gateway(ctx, mode="live", creds=LIVE_CREDS)
        settings.SECRET_ENCRYPTION_KEY = Fernet.generate_key().decode()
        assert self.offers(student) == []
        assert gateway_manager.gateway_issues(gateway) == ["credentials_unreadable"]

    def test_unimplemented_adapter_is_never_ready(self, ctx):
        gateway = PaymentGateway.objects.create(
            slug="nagad-1", adapter="nagad", name_en="Nagad", enabled=True, currencies=["BDT"]
        )
        assert gateway_manager.gateway_issues(gateway) == ["adapter_not_implemented"]


class TestSandboxIsForTestersOnly:
    def test_real_students_never_see_a_sandbox_gateway(self, ctx, student, package):
        make_gateway(ctx, mode="sandbox", creds=SANDBOX_CREDS)
        assert gateway_manager.available_offers(student) == []
        response = jwt_client(student).get(f"{PAYMENTS}methods/?channel=app")
        assert response.json() == {"results": []}
        with pytest.raises(services.PaymentError) as error:
            start(student, package)
        assert error.value.code == "payment_unavailable"

    def test_naming_the_sandbox_gateway_does_not_help(self, ctx, student, package):
        make_gateway(ctx, slug="sbx", mode="sandbox", creds=SANDBOX_CREDS)
        make_gateway(ctx, slug="live-one", mode="live", creds=LIVE_CREDS, adapter="bkash")
        with pytest.raises(services.PaymentError) as error:
            start(student, package, gateway="sbx")
        assert error.value.code == "provider_not_offered"
        assert not Payment.objects.exists()

    def test_tester_sees_it_marked_as_test(self, ctx, student, admin_user):
        make_gateway(ctx, slug="sbx", mode="sandbox", creds=SANDBOX_CREDS)
        make_tester(student, admin_user)
        [row] = jwt_client(student).get(f"{PAYMENTS}methods/").json()["results"]
        assert row["gateway"] == "sbx" and row["is_test"] is True
        assert "credentials" not in json.dumps(row)

    def test_removing_a_tester_takes_it_away(self, ctx, student, admin_user, api):
        make_gateway(ctx, slug="sbx", mode="sandbox", creds=SANDBOX_CREDS)
        make_tester(student, admin_user)
        assert api.delete(f"/api/v1/admin/payment-testers/{student.pk}/").status_code == 204
        assert gateway_manager.available_offers(student) == []

    def test_tester_admin_api(self, api, student, admin_user):
        added = post(api, "/api/v1/admin/payment-testers/", {"user_id": student.pk})
        assert added.status_code == 201
        assert "*" in added.json()["mobile_number"]
        assert student.mobile_number not in json.dumps(added.json())
        assert len(api.get("/api/v1/admin/payment-testers/").json()["results"]) == 1
        assert (
            post(api, "/api/v1/admin/payment-testers/", {"user_id": admin_user.pk}).status_code
            == 404
        )
        assert post(api, "/api/v1/admin/payment-testers/", {"user_id": "x"}).status_code == 400
        assert api.delete(f"/api/v1/admin/payment-testers/{student.pk}/").status_code == 204
        assert api.delete(f"/api/v1/admin/payment-testers/{student.pk}/").status_code == 404


# ======================================================================================
# Payments through database gateways
# ======================================================================================
class TestPaymentThroughAGateway:
    def test_uses_the_gateways_own_credentials_and_records_them(self, ctx, student, package, bkash):
        make_gateway(ctx, slug="main", mode="live", creds=LIVE_CREDS)
        payment = start(student, package)
        assert payment.status == PaymentStatus.PENDING
        assert payment.gateway.slug == "main" and payment.mode == "live"
        create = bkash.used("/create")[0]
        assert create["headers"]["X-APP-Key"] == LIVE_CREDS["app_key"]
        assert "tokenized.pay.bka.sh" in create["url"]

    def test_sandbox_uses_the_sandbox_host_and_credentials(
        self, ctx, student, package, bkash, admin_user
    ):
        make_gateway(ctx, slug="sbx", mode="sandbox", creds=SANDBOX_CREDS)
        make_tester(student, admin_user)
        payment = start(student, package)
        assert payment.mode == "sandbox"
        create = bkash.used("/create")[0]
        assert create["headers"]["X-APP-Key"] == SANDBOX_CREDS["app_key"]
        assert "sandbox" in create["url"]

    def test_two_merchant_accounts_are_chosen_by_slug_with_separate_tokens(
        self, ctx, student, package, bkash
    ):
        other = {k: v.replace("live", "second") for k, v in LIVE_CREDS.items()}
        make_gateway(ctx, slug="first", mode="live", creds=LIVE_CREDS, priority=1)
        make_gateway(ctx, slug="second", mode="live", creds=other, priority=2)
        default = start(student, package)
        chosen = start(student, package, gateway="second")
        assert default.gateway.slug == "first" and chosen.gateway.slug == "second"
        keys = [c["headers"]["X-APP-Key"] for c in bkash.used("/create")]
        assert keys == [LIVE_CREDS["app_key"], other["app_key"]]
        tokens = {c["headers"]["Authorization"] for c in bkash.used("/create")}
        assert len(tokens) == 2  # never one merchant's token for the other

    def test_adapter_code_picks_the_first_gateway_of_that_adapter(
        self, ctx, student, package, bkash
    ):
        make_gateway(ctx, slug="first", mode="live", creds=LIVE_CREDS, priority=1)
        assert start(student, package, provider="bkash").gateway.slug == "first"

    def test_gateway_limits_apply_with_the_real_package_price(self, ctx, student, package, bkash):
        make_gateway(ctx, mode="live", creds=LIVE_CREDS, max_amount=Decimal("100"))
        with pytest.raises(services.PaymentError) as error:
            start(student, package)  # 500 > 100
        assert error.value.code == "provider_not_offered"

    def test_idempotency_cannot_switch_gateway(self, ctx, student, package, bkash):
        make_gateway(ctx, slug="first", mode="live", creds=LIVE_CREDS, priority=1)
        make_gateway(ctx, slug="second", mode="live", creds=LIVE_CREDS, priority=2)
        first = start(student, package, gateway="first", idempotency_key="key-1")
        with pytest.raises(services.PaymentError):
            start(student, package, gateway="second", idempotency_key="key-1")
        again, created = services.initiate_payment(
            student, package.pk, gateway="first", idempotency_key="key-1"
        )
        assert again.pk == first.pk and created is False

    def test_unreadable_credentials_fail_the_start_cleanly(
        self, ctx, student, package, bkash, settings
    ):
        make_gateway(ctx, mode="live", creds=LIVE_CREDS)
        # offered while readable ...
        payment_offer = gateway_manager.available_offers(student)
        assert payment_offer
        # ... and if the key vanishes between offer and use, the payment fails, no crash.
        settings.SECRET_ENCRYPTION_KEY = Fernet.generate_key().decode()
        with pytest.raises(services.PaymentError):
            start(student, package)  # not offered any more
        assert bkash.calls == []

    def test_disabling_a_gateway_stops_new_payments_but_not_old_ones(
        self, ctx, student, package, bkash
    ):
        gateway = make_gateway(ctx, mode="live", creds=LIVE_CREDS)
        payment = start(student, package)
        gateway.enabled = False
        gateway.save()
        with pytest.raises(services.PaymentError):
            start(make_student(full_name="Other"), package)
        # the payment in flight is still verified with its own gateway
        bkash.status = "Completed"
        bkash.extra = {
            "trxID": "TRX-LATE",
            "amount": "500.00",
            "currency": "BDT",
            "merchantInvoiceNumber": payment.merchant_reference,
            "paymentID": payment.provider_payment_id,
        }
        client = APIClient()
        response = client.get(
            f"{PAYMENTS}callback/bkash/success/",
            {"paymentID": payment.provider_payment_id, "status": "success"},
        )
        assert response.status_code == 302
        payment.refresh_from_db()
        assert payment.status == PaymentStatus.SUCCESS

    def test_a_payment_keeps_its_mode_when_the_gateway_goes_live(
        self, ctx, student, package, bkash, admin_user
    ):
        """Sandbox payment in flight, gateway switched to live: it must still be checked
        against the SANDBOX host with the SANDBOX credentials."""
        gateway = make_gateway(ctx, mode="sandbox", creds=SANDBOX_CREDS)
        gateway_store.save_credentials(gateway, "live", LIVE_CREDS, ctx=ctx)
        make_tester(student, admin_user)
        payment = start(student, package)
        PaymentGateway.objects.filter(pk=gateway.pk).update(mode="live")
        bkash.calls.clear()
        services.admin_reverify.__globals__["_query"](payment)
        status_call = bkash.used("/payment/status")[0]
        assert "sandbox" in status_call["url"]
        assert status_call["headers"]["X-APP-Key"] == SANDBOX_CREDS["app_key"]

    def test_provider_secrets_never_reach_the_event_log(self, ctx, student, package, bkash):
        make_gateway(ctx, mode="live", creds=LIVE_CREDS)
        payment = start(student, package)
        blob = json.dumps(list(PaymentEvent.objects.filter(payment=payment).values("payload")))
        for secret in LIVE_CREDS.values():
            assert secret not in blob


# ======================================================================================
# Sandbox payments: test subscriptions only
# ======================================================================================
class TestSandboxPaymentsAreTests:
    @pytest.fixture
    def sandbox_setup(self, ctx, student, package, bkash, admin_user):
        make_gateway(ctx, slug="sbx", mode="sandbox", creds=SANDBOX_CREDS)
        make_tester(student, admin_user)
        return start(student, package)

    def test_success_creates_a_test_subscription(self, sandbox_setup, bkash, student, package):
        payment = pay_success(sandbox_setup, bkash)
        assert payment.status == PaymentStatus.SUCCESS
        assert payment.subscription.is_test is True
        assert payment.subscription.user_id == student.pk

    def test_a_real_subscription_is_never_touched_by_a_sandbox_payment(
        self, ctx, student, package, bkash, admin_user
    ):
        from apps.subscriptions.services import grant_subscription

        real = grant_subscription(student.pk, package.pk, ctx=ctx).subscription
        before = (real.expires_at, real.price_paid)
        make_gateway(ctx, slug="sbx", mode="sandbox", creds=SANDBOX_CREDS)
        make_tester(student, admin_user)
        payment = pay_success(start(student, package), bkash)
        real.refresh_from_db()
        assert (real.expires_at, real.price_paid) == before and real.is_test is False
        assert payment.subscription_id != real.pk and payment.subscription.is_test
        assert Subscription.objects.filter(user=student, package=package).count() == 2

    def test_a_live_payment_never_extends_a_test_subscription(
        self, ctx, student, package, bkash, admin_user
    ):
        make_gateway(ctx, slug="sbx", mode="sandbox", creds=SANDBOX_CREDS)
        make_tester(student, admin_user)
        test_sub = pay_success(start(student, package), bkash).subscription
        before = test_sub.expires_at
        make_gateway(ctx, slug="live", mode="live", creds=LIVE_CREDS, priority=1)
        live_payment = pay_success(start(student, package, gateway="live"), bkash, trx="TRX-LIVE")
        test_sub.refresh_from_db()
        assert test_sub.expires_at == before
        assert live_payment.subscription.is_test is False
        assert live_payment.subscription_id != test_sub.pk

    def test_test_subscriptions_are_hidden_from_the_normal_admin_list(
        self, sandbox_setup, bkash, api
    ):
        pay_success(sandbox_setup, bkash)
        listed = api.get("/api/v1/admin/subscriptions/").json()
        assert listed["count"] == 0
        only_tests = api.get("/api/v1/admin/subscriptions/?is_test=true").json()
        assert only_tests["count"] == 1 and only_tests["results"][0]["is_test"] is True

    def test_sandbox_money_is_kept_out_of_the_business_numbers(self, sandbox_setup, bkash):
        pay_success(sandbox_setup, bkash)
        stats = gateway_admin.stats()
        assert stats["sandbox"]["success"] == 1
        assert stats["sandbox"]["collected"] == "500.00"
        assert stats["real"]["success"] == 0 and stats["real"]["total"] == 0

    def test_dashboard_ignores_sandbox_payments_and_test_subscriptions(self, sandbox_setup, bkash):
        pay_success(sandbox_setup, bkash)
        data = dashboard_selectors.admin_dashboard(timezone.now())
        assert data["subscriptions"]["active_now"] == 0
        assert data["payments"]["success_this_month"] == 0
        assert data["payments"]["revenue_this_month"] == []
        assert sum(data["payments"]["by_status"].values()) == 0

    def test_admin_can_revoke_a_test_subscription(self, sandbox_setup, bkash, api, student):
        subscription = pay_success(sandbox_setup, bkash).subscription
        response = post(api, f"/api/v1/admin/test-subscriptions/{subscription.pk}/revoke/")
        assert response.status_code == 200 and response.json()["status"] == "cancelled"
        subscription.refresh_from_db()
        assert subscription.status == SubscriptionStatus.CANCELLED
        again = post(api, f"/api/v1/admin/test-subscriptions/{subscription.pk}/revoke/")
        assert again.status_code == 409
        assert AuditLog.objects.filter(action="subscription.cancel").count() == 1

    def test_revoke_refuses_real_subscriptions(self, ctx, api, student, package):
        from apps.subscriptions.services import grant_subscription

        real = grant_subscription(student.pk, package.pk, ctx=ctx).subscription
        response = post(api, f"/api/v1/admin/test-subscriptions/{real.pk}/revoke/")
        assert response.status_code == 404
        real.refresh_from_db()
        assert real.status == SubscriptionStatus.ACTIVE

    def test_sandbox_success_is_evidence_for_live(self, sandbox_setup, bkash):
        gateway = sandbox_setup.gateway
        assert not gateway_store.sandbox_payment_succeeded(gateway)
        pay_success(sandbox_setup, bkash)
        assert gateway_store.sandbox_payment_succeeded(gateway)

    def test_revoking_does_not_remove_the_evidence(self, sandbox_setup, bkash, api):
        payment = pay_success(sandbox_setup, bkash)
        post(api, f"/api/v1/admin/test-subscriptions/{payment.subscription_id}/revoke/")
        assert gateway_store.sandbox_payment_succeeded(payment.gateway)

    def test_payment_response_marks_it_as_a_test(self, sandbox_setup, bkash, student):
        body = jwt_client(student).get(f"{PAYMENTS}{sandbox_setup.public_id}/").json()
        assert body["is_test"] is True

    def test_tester_can_use_the_test_subscription_and_nobody_else_gets_one(
        self, sandbox_setup, bkash, student
    ):
        from tests.test_exams import make_category, make_exam, make_subject

        pay_success(sandbox_setup, bkash)
        subject = make_subject("s-sbx", category=make_category("c-sbx"))
        exam = make_exam(subject, access_type="paid")
        other = make_student(full_name="Other Student")
        assert user_can_access_exam(student, exam) is True  # the tester, for testing
        assert user_can_access_exam(other, exam) is False  # no real student gets anything
        assert not Subscription.objects.filter(user=other).exists()


# ======================================================================================
# Return URLs: website and app are separate
# ======================================================================================
class TestReturnUrls:
    def callback(self, payment, kind="success"):
        return APIClient().get(
            f"{PAYMENTS}callback/bkash/{kind}/",
            {"paymentID": payment.provider_payment_id, "status": kind},
        )

    def test_app_payment_returns_to_the_app(self, ctx, student, package, bkash):
        make_gateway(ctx, mode="live", creds=LIVE_CREDS)
        payment = start(student, package, channel="app")
        response = self.callback(payment, "cancel")
        assert response.status_code == 302
        assert response["Location"].startswith(APP_RETURN)

    def test_website_payment_returns_to_the_website(self, ctx, student, package, bkash):
        make_gateway(ctx, mode="live", creds=LIVE_CREDS)
        payment = start(student, package, channel="web")
        assert self.callback(payment, "cancel")["Location"].startswith(WEB_RETURN)

    def test_gateway_specific_urls_win(self, ctx, student, package, bkash):
        make_gateway(
            ctx,
            mode="live",
            creds=LIVE_CREDS,
            web_return_url="https://own.test/web",
            app_return_url="ownapp://done",
        )
        web = start(student, package, channel="web")
        assert self.callback(web, "cancel")["Location"].startswith("https://own.test/web")
        other = make_student(full_name="Other")
        app = start(other, package, channel="app")
        assert self.callback(app, "cancel")["Location"].startswith("ownapp://done")

    def test_web_falls_back_to_the_general_url_when_unset(
        self, ctx, student, package, bkash, settings
    ):
        settings.PAYMENT_WEB_RETURN_URL = ""
        make_gateway(ctx, mode="live", creds=LIVE_CREDS)
        payment = start(student, package, channel="web")
        assert self.callback(payment, "cancel")["Location"].startswith(APP_RETURN)

    def test_the_return_target_never_comes_from_the_request(self, ctx, student, package, bkash):
        make_gateway(ctx, mode="live", creds=LIVE_CREDS)
        payment = start(student, package, channel="web")
        response = APIClient().get(
            f"{PAYMENTS}callback/bkash/cancel/",
            {
                "paymentID": payment.provider_payment_id,
                "status": "cancel",
                "return_url": "https://evil.test",
                "redirect": "https://evil.test",
            },
        )
        assert "evil" not in response["Location"]

    def test_unknown_channel_is_refused(self, ctx, student, package, bkash):
        make_gateway(ctx, mode="live", creds=LIVE_CREDS)
        with pytest.raises(services.PaymentError) as error:
            start(student, package, channel="kiosk")
        assert error.value.code == "invalid_channel"
        response = jwt_client(student).get(f"{PAYMENTS}methods/?channel=kiosk")
        assert response.status_code == 400

    def test_initiate_api_accepts_gateway_and_channel(self, ctx, student, package, bkash):
        make_gateway(ctx, slug="main", mode="live", creds=LIVE_CREDS)
        response = jwt_client(student).post(
            PAYMENTS,
            {"package_id": package.pk, "gateway": "main", "channel": "web"},
            format="json",
        )
        assert response.status_code == 201, response.json()
        payment = Payment.objects.get(public_id=response.json()["payment_id"])
        assert payment.channel == "web" and payment.gateway.slug == "main"
        assert "credentials" not in json.dumps(response.json())

    def test_methods_endpoint_filters_by_channel_and_amount(self, ctx, student, package):
        make_gateway(ctx, slug="web-only", mode="live", creds=LIVE_CREDS, app_enabled=False)
        make_gateway(
            ctx, slug="small", mode="live", creds=LIVE_CREDS, max_amount=Decimal("100"), priority=1
        )
        client = jwt_client(student)
        web = client.get(f"{PAYMENTS}methods/?channel=web&package_id={package.pk}").json()
        assert [r["gateway"] for r in web["results"]] == ["web-only"]  # small gateway: 500 > 100
        app = client.get(f"{PAYMENTS}methods/?channel=app").json()
        assert [r["gateway"] for r in app["results"]] == ["small"]


# ======================================================================================
# Stats and the old behaviour
# ======================================================================================
class TestStatsAndCompatibility:
    def test_stats_split_gateways_and_modes(self, api, ctx, student, package, bkash):
        make_gateway(ctx, slug="main", mode="live", creds=LIVE_CREDS)
        pay_success(start(student, package), bkash)
        body = api.get(f"{ADMIN}stats/").json()
        assert body["real"]["success"] == 1
        [row] = body["gateways"]
        assert (
            row["slug"] == "main" and row["live"]["success"] == 1 and row["sandbox"]["total"] == 0
        )

    def test_environment_only_deployment_is_unchanged(self, student, package, settings, bkash):
        settings.BKASH_APP_KEY, settings.BKASH_APP_SECRET = "env-key", "env-secret"
        settings.BKASH_USERNAME, settings.BKASH_PASSWORD = "env-user", "env-pass"
        payment = start(student, package)
        assert payment.gateway is None and payment.mode == ""
        assert bkash.used("/create")[0]["headers"]["X-APP-Key"] == "env-key"

    def test_older_payments_without_a_gateway_still_reconcile(
        self, student, package, settings, bkash
    ):
        settings.BKASH_APP_KEY, settings.BKASH_APP_SECRET = "env-key", "env-secret"
        settings.BKASH_USERNAME, settings.BKASH_PASSWORD = "env-user", "env-pass"
        payment = start(student, package)
        result = services.admin_reverify.__globals__["_query"](payment)
        assert result.outcome in (Outcome.PENDING, Outcome.ERROR, Outcome.NOT_FOUND)
