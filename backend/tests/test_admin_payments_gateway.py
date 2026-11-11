# ruff: noqa: F811 -- pytest fixtures imported from the Phase 3 file are re-named as test arguments
"""The admin Payments list and detail show which merchant account, mode and channel a payment
used, mark test payments, and filter by them."""

import pytest

from apps.payments.models import Payment

# Fixtures and helpers of the Phase 3 file (imported so they apply here too).
from tests.test_payment_gateways_admin import (  # noqa: F401
    _env,
    admin_user,
    api,
    bkash,
    ctx,
    make_gateway,
    make_tester,
    package,
    start,
    student,
)

pytestmark = pytest.mark.django_db

LIST = "/api/v1/admin/payments/"


@pytest.fixture
def three(ctx, student, package, bkash):
    """A sandbox payment (website), a live payment (app), and an old one with no gateway."""
    make_tester(student, ctx.actor)
    sandbox = make_gateway(ctx, slug="bkash-test", mode="sandbox")
    live = make_gateway(ctx, slug="bkash-live", mode="live", creds=None)
    from apps.payments import gateway_store
    from tests.test_payment_gateways_admin import LIVE_CREDS

    gateway_store.save_credentials(live, "live", LIVE_CREDS, ctx=ctx)
    first = start(student, package, gateway=sandbox.slug, channel="web", idempotency_key="k1")
    # A live payment is a real student's; make the student a non-tester for it.
    from apps.payments.models import PaymentTester

    PaymentTester.objects.all().delete()
    second = start(student, package, gateway=live.slug, channel="app", idempotency_key="k2")
    old = Payment.objects.create(
        user=student,
        package=package,
        provider="mock",
        amount=package.price,
        currency=package.currency,
        validity_days=30,
        merchant_reference="MCQOLD00000000000000000000",
        status="failed",
    )
    return {"sandbox": first, "live": second, "old": old, "sg": sandbox, "lg": live}


def rows(response):
    assert response.status_code == 200, response.content
    return {row["merchant_reference"]: row for row in response.json()["results"]}


def test_each_row_says_which_account_mode_and_channel(api, three):
    data = rows(api.get(LIST))
    sandbox = data[three["sandbox"].merchant_reference]
    assert sandbox["gateway"]["slug"] == "bkash-test"
    assert (sandbox["mode"], sandbox["channel"], sandbox["is_test"]) == ("sandbox", "web", True)
    live = data[three["live"].merchant_reference]
    assert live["gateway"]["slug"] == "bkash-live"
    assert (live["mode"], live["channel"], live["is_test"]) == ("live", "app", False)
    old = data[three["old"].merchant_reference]
    assert old["gateway"] is None and old["mode"] == "" and old["is_test"] is False


def test_no_credential_or_secret_is_in_the_row(api, three):
    body = api.get(LIST).content.decode()
    assert "sbx-" not in body and "live-app" not in body and "value_encrypted" not in body


def test_filters_by_mode_channel_and_gateway(api, three):
    refs = lambda **q: set(rows(api.get(LIST, q)))  # noqa: E731
    assert refs(mode="sandbox") == {three["sandbox"].merchant_reference}
    assert refs(mode="live") == {three["live"].merchant_reference}
    assert refs(channel="app") == {three["live"].merchant_reference}
    assert refs(channel="web") == {three["sandbox"].merchant_reference}
    assert refs(gateway=three["lg"].pk) == {three["live"].merchant_reference}
    assert refs(gateway=three["sg"].pk, mode="live") == set()
    assert len(refs()) == 3


def test_a_bad_filter_value_is_a_clean_400(api, three):
    for query in ({"mode": "x"}, {"channel": "tv"}, {"gateway": "abc"}):
        assert api.get(LIST, query).status_code == 400


def test_the_detail_carries_the_same_facts(api, three):
    response = api.get(f"{LIST}{three['sandbox'].public_id}/")
    assert response.status_code == 200
    body = response.json()
    assert body["gateway"]["slug"] == "bkash-test"
    assert body["mode"] == "sandbox" and body["is_test"] is True


def test_students_cannot_read_the_admin_list(student, three):
    from rest_framework.test import APIClient

    client = APIClient()
    client.force_login(student)
    assert client.get(LIST).status_code in (401, 403)
