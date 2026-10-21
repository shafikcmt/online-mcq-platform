"""Milestone 7G: admin subscription responses mask the student's mobile number, and the
list filters by the computed ``effective_status`` (the same rule as each row's
``effective_status``)."""

import json
from contextlib import contextmanager
from datetime import timedelta
from types import SimpleNamespace
from unittest import mock

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.subscriptions import selectors, services
from apps.subscriptions.models import Subscription
from tests.test_subscriptions import (
    CTX,
    GRANT,
    SUBSCRIPTIONS,
    grant,
    make_package,
    make_student,
)

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _media(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "media")


@pytest.fixture
def api():
    admin = User.objects.create_user(
        "01612345678", full_name="Ops", role=Role.ADMIN, preferred_language="en"
    )
    client = APIClient()
    client.force_login(admin)
    return client


@contextmanager
def list_clock(moment):
    """Freeze the subscriptions API's server clock (filters and effective_status)."""
    with mock.patch("apps.subscriptions.api.views.timezone", SimpleNamespace(now=lambda: moment)):
        yield


def ids(response):
    assert response.status_code == 200, response.content
    return {row["id"] for row in response.json()["results"]}


def assert_masked(payload, student):
    text = json.dumps(payload)
    assert "mobile_number" not in text
    assert student.mobile_number not in text
    assert student.mobile_number[1:] not in text  # without the leading "+"
    assert student.mobile_number[-10:] not in text  # the local digits
    assert "email" not in text


# ======================================================================================
# Privacy: masked mobile everywhere
# ======================================================================================
class TestMaskedMobile:
    def test_list_and_detail(self, api):
        student = make_student(full_name="Rahim", email="rahim@example.org")
        subscription = grant(student, make_package()).subscription
        rows = api.get(SUBSCRIPTIONS).json()
        detail = api.get(f"{SUBSCRIPTIONS}{subscription.pk}/").json()
        for user in (rows["results"][0]["user"], detail["user"]):
            assert user == {
                "id": student.pk,
                "full_name": "Rahim",
                "mobile_display": f"+88017*****{student.mobile_number[-3:]}",
            }
        assert_masked(rows, student)
        assert_masked(detail, student)

    def test_grant_extend_and_cancel_responses(self, api):
        student = make_student()
        package = make_package()
        created = api.post(GRANT, {"user": student.pk, "package": package.pk}, format="json")
        extended = api.post(GRANT, {"user": student.pk, "package": package.pk}, format="json")
        assert (created.status_code, extended.status_code) == (201, 200)
        cancelled = api.post(f"{SUBSCRIPTIONS}{created.json()['id']}/cancel/")
        assert cancelled.status_code == 200
        for response in (created, extended, cancelled):
            assert set(response.json()["user"]) == {"id", "full_name", "mobile_display"}
            assert "*****" in response.json()["user"]["mobile_display"]
            assert_masked(response.json(), student)


# ======================================================================================
# effective_status filter
# ======================================================================================
@pytest.fixture
def world():
    """One subscription in every effective status at ``now`` (+ a stored-expired one)."""
    now = timezone.now()
    gold, silver, bronze = make_package(), make_package("silver"), make_package("bronze")
    active = grant(make_student(full_name="Active"), gold).subscription
    scheduled = grant(
        make_student(full_name="Scheduled"), gold, starts_at=now + timedelta(days=2)
    ).subscription
    cancelled_sub = grant(make_student(full_name="Cancelled"), silver).subscription
    services.cancel_subscription(cancelled_sub.pk, ctx=CTX)
    # The expiry job marked this one expired (stored and effective). A grant cannot start
    # in the past, so the test moves the window back before the job runs.
    stored_expired = grant(make_student(full_name="Expired"), bronze).subscription
    Subscription.objects.filter(pk=stored_expired.pk).update(
        starts_at=now - timedelta(days=60), expires_at=now - timedelta(days=30)
    )
    assert services.expire_subscriptions() == 1
    # Ran out after the job's last run: stored active, effective expired.
    lapsed = grant(make_student(full_name="Lapsed"), bronze).subscription
    Subscription.objects.filter(pk=lapsed.pk).update(
        starts_at=now - timedelta(days=40), expires_at=now - timedelta(days=10)
    )
    return SimpleNamespace(
        now=timezone.now(),  # after every grant: the "active" one has started by now
        active=active,
        scheduled=scheduled,
        cancelled=cancelled_sub,
        lapsed=lapsed,
        stored_expired=stored_expired,
    )


class TestEffectiveStatusFilter:
    def test_each_value(self, api, world):
        url = f"{SUBSCRIPTIONS}?effective_status="
        with list_clock(world.now):
            assert ids(api.get(url + "active")) == {world.active.pk}
            assert ids(api.get(url + "scheduled")) == {world.scheduled.pk}
            assert ids(api.get(url + "cancelled")) == {world.cancelled.pk}
            assert ids(api.get(url + "expired")) == {world.lapsed.pk, world.stored_expired.pk}

    def test_filter_matches_each_rows_effective_status(self, api, world):
        with list_clock(world.now):
            for value in selectors.EffectiveStatus.values:
                rows = api.get(f"{SUBSCRIPTIONS}?effective_status={value}").json()["results"]
                assert rows and {row["effective_status"] for row in rows} == {value}

    def test_selector_matches_python_rule_at_boundaries(self, world):
        scheduled = Subscription.objects.get(pk=world.scheduled.pk)
        moments = [
            scheduled.starts_at - timedelta(microseconds=1),
            scheduled.starts_at,  # starts: now active
            scheduled.expires_at - timedelta(microseconds=1),
            scheduled.expires_at,  # expires_at itself: expired
            scheduled.expires_at + timedelta(days=1),
        ]
        rows = list(Subscription.objects.all())
        for moment in moments:
            for value in selectors.EffectiveStatus.values:
                matched = set(
                    Subscription.objects.filter(
                        selectors.effective_status_filter(value, moment)
                    ).values_list("pk", flat=True)
                )
                expected = {s.pk for s in rows if selectors.effective_status(s, moment) == value}
                assert matched == expected, (moment, value)

    def test_start_and_expiry_boundaries_through_the_api(self, api, world):
        scheduled = Subscription.objects.get(pk=world.scheduled.pk)
        url = f"{SUBSCRIPTIONS}?effective_status="
        cases = [
            (scheduled.starts_at - timedelta(microseconds=1), "scheduled"),
            (scheduled.starts_at, "active"),
            (scheduled.expires_at - timedelta(microseconds=1), "active"),
            (scheduled.expires_at, "expired"),
        ]
        for moment, expected in cases:
            with list_clock(moment):
                assert scheduled.pk in ids(api.get(url + expected)), (moment, expected)
                row = next(
                    r for r in api.get(SUBSCRIPTIONS).json()["results"] if r["id"] == scheduled.pk
                )
                assert row["effective_status"] == expected

    @pytest.mark.parametrize("value", ["paused", "ACTIVE ", "1", "inactive"])
    def test_invalid_value_400(self, api, world, value):
        response = api.get(f"{SUBSCRIPTIONS}?effective_status={value}")
        if value.strip().lower() in selectors.EffectiveStatus.values:
            assert response.status_code == 200  # query_choice trims and lower-cases
            return
        assert response.status_code == 400
        assert "effective_status" in response.json()["error"]["field_errors"]

    def test_combines_with_existing_filters(self, api, world):
        gold = world.active.package_id
        with list_clock(world.now):
            both = api.get(f"{SUBSCRIPTIONS}?effective_status=scheduled&package={gold}")
            assert ids(both) == {world.scheduled.pk}
            stored = api.get(f"{SUBSCRIPTIONS}?status=active&effective_status=expired")
            assert ids(stored) == {world.lapsed.pk}  # stored active, effectively expired
            assert ids(api.get(f"{SUBSCRIPTIONS}?active=true")) == {world.active.pk}
            assert ids(api.get(f"{SUBSCRIPTIONS}?user={world.active.user_id}")) == {world.active.pk}
