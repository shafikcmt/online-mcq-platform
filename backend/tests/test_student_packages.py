"""Milestone 8F: ``GET /packages/`` (student JWT) — the public package fields plus the
package id the app buys with and the student's own current subscription to it."""

from datetime import timedelta
from decimal import Decimal

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from apps.subscriptions import services
from apps.subscriptions.models import Package
from tests.test_subscriptions import CTX, all_paid, grant, jwt_client, make_package, make_student

pytestmark = pytest.mark.django_db

URL = "/api/v1/packages/"


@pytest.fixture(autouse=True)
def _settings(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "media")
    settings.PAYMENT_PROVIDER = "mock"
    settings.PAYMENT_MOCK_ALLOWED = True
    settings.PAYMENT_CALLBACK_BASE_URL = "https://api.test"
    settings.PAYMENT_RETURN_URL = "livemodeltest://payment-result"
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def student():
    return make_student(full_name="Rahim Hossain")


def packages(user, **headers):
    response = jwt_client(user).get(URL, **headers)
    assert response.status_code == 200, response.content
    return {row["slug"]: row for row in response.json()["results"]}


def test_requires_student_jwt(student):
    make_package("gold")
    assert APIClient().get(URL).status_code == 401
    assert jwt_client(student).get(URL).status_code == 200
    for method in ("post", "put", "patch", "delete"):
        assert getattr(jwt_client(student), method)(URL).status_code == 405


def test_public_fields_plus_id_and_only_active_packages(student):
    gold = make_package("gold", name_bn="গোল্ড", features_en=["All mocks"], price=Decimal("500.00"))
    old = make_package("old")
    Package.objects.filter(pk=old.pk).update(status="inactive")
    rows = packages(student, HTTP_ACCEPT_LANGUAGE="en")
    assert set(rows) == {"gold"}
    row = rows["gold"]
    public = (
        APIClient().get("/api/v1/public/packages/", HTTP_ACCEPT_LANGUAGE="en").json()["results"][0]
    )
    assert {key: row[key] for key in public} == public  # same public fields, same values
    assert row["id"] == gold.pk
    assert row["subscription"] is None
    assert packages(student, HTTP_ACCEPT_LANGUAGE="bn")["gold"]["name"] == "গোল্ড"


def test_current_subscription_and_its_end(student):
    gold = make_package("gold", rules=all_paid())
    silver = make_package("silver")
    first = grant(student, gold).subscription
    rows = packages(student)
    assert rows["gold"]["subscription"]["active_now"] is True
    assert rows["gold"]["subscription"]["expires_at"].startswith(
        first.expires_at.strftime("%Y-%m-%dT%H:%M")
    )
    assert rows["silver"]["subscription"] is None

    # A scheduled one (starts later) is current but not active yet.
    later = timezone.now() + timedelta(days=3)
    services.grant_subscription(student.pk, silver.pk, ctx=CTX, starts_at=later)
    assert packages(student)["silver"]["subscription"]["active_now"] is False


def test_cancelled_and_other_students_subscriptions_are_not_shown(student):
    gold = make_package("gold")
    other = make_student(full_name="Other")
    grant(other, gold)
    assert packages(student)["gold"]["subscription"] is None
    mine = grant(student, gold).subscription
    services.cancel_subscription(mine.pk, ctx=CTX)
    assert packages(student)["gold"]["subscription"] is None


def test_the_listed_id_starts_a_payment(student):
    make_package("gold", price=Decimal("300.00"))
    row = packages(student)["gold"]
    response = jwt_client(student).post(
        "/api/v1/payments/", {"package_id": row["id"]}, format="json"
    )
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["status"] == "pending" and body["amount"] == "300.00"
    assert body["checkout_url"]
