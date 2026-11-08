# ruff: noqa: F811 -- pytest fixtures imported from the Phase 3 file are re-named as test arguments
"""``PAYMENT_PROVIDER=database``: students are offered only the gateways managed in the Admin
Panel, no environment credentials are needed, and ``unavailable`` stays the kill switch."""

import pytest
from django.core.exceptions import ImproperlyConfigured

from apps.payments import gateway_admin, gateway_manager, services
from apps.payments.checks import check_payment_settings
from apps.payments.gateways import offered_providers
from apps.payments.models import Payment, PaymentStatus
from config.settings.checks import validate_payment_settings

# Fixtures and helpers of the Phase 3 file (imported so they apply here too).
from tests.test_payment_gateways_admin import (  # noqa: F401
    ADMIN,
    _env,
    admin_user,
    api,
    bkash,
    ctx,
    make_gateway,
    make_tester,
    package,
    pay_success,
    start,
    student,
)
from tests.test_subscriptions import jwt_client

pytestmark = pytest.mark.django_db

GOOD = dict(
    providers={"bkash": 1, "sslcommerz": 1, "mock": 1},
    store_id="",
    store_password="",
    sandbox=False,
    allow_sandbox=False,
    callback_base_url="https://admin.example.test",
    return_url="https://site.example.test/payment-return",
    enabled=[],
    bkash_credentials=("", "", "", ""),
    bkash_sandbox=False,
)


@pytest.fixture
def database_mode(settings):
    settings.PAYMENT_PROVIDER = "database"
    settings.PAYMENT_ENABLED_PROVIDERS = []


# --------------------------------------------------------------------------------------
# What is offered
# --------------------------------------------------------------------------------------
def test_no_environment_method_is_ever_offered(settings, database_mode):
    settings.PAYMENT_ENABLED_PROVIDERS = ["bkash", "sslcommerz"]
    settings.BKASH_APP_KEY = "env-key"
    assert offered_providers() == []


def test_only_database_gateways_are_offered(database_mode, student, ctx):
    make_tester(student, ctx.actor)  # the sample gateway is in sandbox mode
    make_gateway(ctx, slug="bkash-main")
    offers = gateway_manager.available_offers(student, "web")
    assert [offer.slug for offer in offers] == ["bkash-main"]
    assert all(offer.source == "db" for offer in offers)


def test_an_adapter_without_a_gateway_row_is_not_offered_from_the_environment(
    settings, database_mode, student, ctx
):
    """The difference from the environment mode: no fallback at all."""
    settings.SSLCOMMERZ_STORE_ID = "env-store"
    settings.SSLCOMMERZ_STORE_PASSWORD = "env-password"
    make_tester(student, ctx.actor)
    make_gateway(ctx, slug="bkash-main")
    assert {offer.adapter for offer in gateway_manager.available_offers(student, "web")} == {
        "bkash"
    }


def test_with_no_gateway_nothing_is_offered_and_a_purchase_is_refused_cleanly(
    database_mode, student, package
):
    assert gateway_manager.available_offers(student, "web") == []
    with pytest.raises(services.PaymentError) as refused:
        services.initiate_payment(student, package.pk)
    assert refused.value.status == 503 and refused.value.code == "payment_unavailable"
    assert not Payment.objects.exists()
    response = jwt_client(student).get("/api/v1/payments/methods/")
    assert response.status_code == 200 and response.json() == {"results": []}


def test_unavailable_still_switches_everything_off(settings, student, ctx, package):
    make_tester(student, ctx.actor)
    make_gateway(ctx, slug="bkash-main")
    settings.PAYMENT_PROVIDER = "unavailable"
    assert gateway_manager.available_offers(student, "web") == []
    with pytest.raises(services.PaymentError) as refused:
        services.initiate_payment(student, package.pk, gateway="bkash-main")
    assert refused.value.code == "payment_unavailable"
    settings.PAYMENT_PROVIDER = "database"  # and back on: the gateway is offered again
    assert gateway_manager.available_offers(student, "web")


def test_a_payment_runs_end_to_end_through_a_database_gateway(
    database_mode, student, ctx, package, bkash
):
    make_tester(student, ctx.actor)
    gateway = make_gateway(ctx, slug="bkash-main")
    payment = start(student, package, gateway=gateway.slug, channel="web")
    assert payment.gateway_id == gateway.pk
    paid = pay_success(payment, bkash)
    assert paid.status == PaymentStatus.SUCCESS


# --------------------------------------------------------------------------------------
# Startup checks
# --------------------------------------------------------------------------------------
def test_production_starts_with_database_mode_and_no_environment_credentials():
    validate_payment_settings(provider="database", **GOOD)


def test_the_callback_and_return_addresses_are_still_required():
    with pytest.raises(ImproperlyConfigured, match="PAYMENT_CALLBACK_BASE_URL"):
        validate_payment_settings(
            provider="database", **{**GOOD, "callback_base_url": "http://insecure.test"}
        )
    with pytest.raises(ImproperlyConfigured, match="PAYMENT_RETURN_URL"):
        validate_payment_settings(provider="database", **{**GOOD, "return_url": ""})


def test_other_providers_still_need_their_environment_credentials():
    for provider, name in (("bkash", "BKASH_APP_KEY"), ("sslcommerz", "SSLCOMMERZ_STORE_ID")):
        with pytest.raises(ImproperlyConfigured, match=name):
            validate_payment_settings(provider=provider, **GOOD)
    validate_payment_settings(provider="unavailable", **GOOD)


def test_a_typo_is_still_refused_but_database_is_a_known_value(settings):
    settings.PAYMENT_PROVIDER = "databse"
    assert any(error.id == "payments.E002" for error in check_payment_settings(None))
    settings.PAYMENT_PROVIDER = "database"
    assert not any(error.id == "payments.E002" for error in check_payment_settings(None))


# --------------------------------------------------------------------------------------
# What the panel is told
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("unavailable", "unavailable"),
        ("database", "database"),
        ("bkash", "environment"),
        ("sslcommerz", "environment"),
        ("mock", "environment"),
    ],
)
def test_the_stats_report_the_server_switch(api, settings, value, expected):
    settings.PAYMENT_PROVIDER = value
    assert gateway_admin.payment_switch() == expected
    body = api.get(f"{ADMIN}stats/").json()
    assert body["payment_switch"] == expected
    # Only the stable code: no credential, no provider list.
    assert set(body) == {"real", "sandbox", "gateways", "payment_switch"}
