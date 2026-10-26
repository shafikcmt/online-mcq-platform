"""Manual subscription grant idempotency: ``Idempotency-Key`` on
``POST /api/v1/admin/subscriptions/grant/`` and the ``GrantRequest`` ledger.

A double click, a browser/proxy retry or a retry after a timeout must never grant twice;
two different keys stay two intentional grants.
"""

from datetime import UTC, timedelta
from decimal import Decimal
from unittest import mock

import pytest
from django.core.exceptions import ValidationError
from django.db import DatabaseError, IntegrityError, connection, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.audit.models import AuditLog
from apps.audit.services import AuditContext
from apps.subscriptions import services
from apps.subscriptions.exceptions import SubscriptionError
from apps.subscriptions.models import GrantRequest, PackageStatus, Subscription
from tests.test_subscriptions import (
    CTX,
    GRANT,
    PW,
    _run_concurrently,
    audits,
    code,
    errors,
    grant,
    idem,
    jwt_client,
    make_package,
    make_student,
)

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _media(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "media")


def make_admin(mobile="01612345678"):
    return User.objects.create_user(
        mobile, password=PW, full_name="Ops", role=Role.ADMIN, preferred_language="en"
    )


@pytest.fixture
def admin_user():
    return make_admin()


@pytest.fixture
def api(admin_user):
    client = APIClient()
    client.force_login(admin_user)
    return client


@pytest.fixture
def student():
    return make_student()


def post(client, body, key):
    return client.post(GRANT, body, format="json", **idem(key))


def grant_events():
    return AuditLog.objects.filter(action__in=["subscription.grant", "subscription.extend"])


def once(actor, user, package, key, **kwargs):
    return services.grant_subscription_once(
        user.pk, package.pk, key=key, ctx=AuditContext(actor=actor), **kwargs
    )


# ======================================================================================
# Basic behaviour
# ======================================================================================
class TestFirstRequest:
    def test_new_grant_creates_subscription_and_ledger_row(self, api, admin_user, student):
        package = make_package(validity_days=30)
        response = post(api, {"user": student.pk, "package": package.pk}, "k-1")
        assert response.status_code == 201, response.json()
        assert "Idempotent-Replayed" not in response
        sub = Subscription.objects.get(user=student)
        assert response.json()["id"] == sub.pk
        row = GrantRequest.objects.get()
        assert (row.actor_id, row.key, row.user_id, row.package_id) == (
            admin_user.pk,
            "k-1",
            student.pk,
            package.pk,
        )
        assert row.requested_price_paid is None and row.requested_starts_at is None
        assert row.applied_amount == Decimal("500.00")  # the package price at grant time
        assert (row.subscription_id, row.extended, row.status_code) == (sub.pk, False, 201)
        assert audits("subscription.grant").count() == 1

    def test_first_extension_extends_once(self, api, student):
        package = make_package(validity_days=30)
        sub = grant(student, package).subscription
        response = post(
            api, {"user": student.pk, "package": package.pk, "price_paid": "100"}, "ext-1"
        )
        assert response.status_code == 200 and response.json()["id"] == sub.pk
        fresh = Subscription.objects.get(pk=sub.pk)
        assert fresh.expires_at == sub.expires_at + timedelta(days=30)
        assert fresh.price_paid == Decimal("600.00")
        row = GrantRequest.objects.get()
        assert (row.extended, row.status_code, row.applied_amount) == (True, 200, Decimal("100"))
        assert row.requested_price_paid == Decimal("100")
        assert audits("subscription.extend").count() == 1


class TestKeyHeader:
    def test_missing_key_is_rejected_before_anything_changes(self, api, student):
        package = make_package()
        response = api.post(GRANT, {"user": student.pk, "package": package.pk}, format="json")
        assert response.status_code == 400 and code(response) == "idempotency_key_required"
        response = post(api, {"user": student.pk, "package": package.pk}, "   ")
        assert response.status_code == 400 and code(response) == "idempotency_key_required"
        assert not Subscription.objects.exists() and not GrantRequest.objects.exists()
        assert not grant_events().exists()

    @pytest.mark.parametrize(
        "key", ["a" * 65, "has space", "ünïcode", "semi;colon", "slash/", "tab\tkey", "ক"]
    )
    def test_invalid_key(self, api, student, key):
        package = make_package()
        response = post(api, {"user": student.pk, "package": package.pk}, key)
        assert response.status_code == 400 and code(response) == "idempotency_key_invalid"
        assert not Subscription.objects.exists() and not GrantRequest.objects.exists()

    @pytest.mark.parametrize("key", ["a", "A" * 64, "2026-10-26T10:00:00.123Z", "ui:grant_1.2-x"])
    def test_valid_key_formats(self, api, student, key):
        package = make_package()
        response = post(api, {"user": student.pk, "package": package.pk}, key)
        assert response.status_code == 201, response.json()
        assert GrantRequest.objects.get().key == key

    def test_key_error_is_translated(self, api, student):
        package = make_package()
        response = api.post(
            GRANT,
            {"user": student.pk, "package": package.pk},
            format="json",
            HTTP_ACCEPT_LANGUAGE="bn",
        )
        assert response.json()["error"]["message"] == (
            "সাবস্ক্রিপশন দেওয়ার প্রতিটি অনুরোধের সঙ্গে একটি Idempotency-Key হেডার পাঠান।"
        )


# ======================================================================================
# Same key + same request: replay without mutation
# ======================================================================================
class TestReplay:
    @pytest.mark.parametrize("extension", [False, True])
    def test_replay_changes_nothing_and_keeps_the_status(self, api, student, extension):
        package = make_package(validity_days=30)
        if extension:
            grant(student, package)
        body = {"user": student.pk, "package": package.pk, "price_paid": "250"}
        first = post(api, body, "retry-me")
        assert first.status_code == (200 if extension else 201)
        sub = Subscription.objects.get(user=student)
        events = grant_events().count()
        for _ in range(3):
            again = post(api, body, "retry-me")
            assert again.status_code == first.status_code
            assert again["Idempotent-Replayed"] == "true"
            assert again.json() == first.json()
        fresh = Subscription.objects.get(pk=sub.pk)
        assert (fresh.expires_at, fresh.price_paid, fresh.updated_at) == (
            sub.expires_at,
            sub.price_paid,
            sub.updated_at,
        )
        assert Subscription.objects.filter(user=student).count() == 1
        assert GrantRequest.objects.count() == 1
        assert grant_events().count() == events  # no second grant/extend audit event
        assert AuditLog.objects.filter(action__startswith="subscription.").count() == events

    def test_replay_returns_the_current_subscription_state(self, api, student):
        package = make_package()
        body = {"user": student.pk, "package": package.pk}
        first = post(api, body, "k")
        services.cancel_subscription(first.json()["id"], ctx=CTX)
        replay = post(api, body, "k")
        assert replay.status_code == 201  # the original outcome …
        assert replay.json()["status"] == "cancelled"  # … with the subscription as it is now
        assert replay["Idempotent-Replayed"] == "true"
        assert Subscription.objects.count() == 1

    def test_equivalent_values_replay(self, api, student):
        """Same request written differently: 250 == 250.00, +06:00 == the same UTC instant."""
        package = make_package()
        start = timezone.now().replace(microsecond=0) + timedelta(days=2)
        dhaka = start.astimezone(timezone.get_fixed_timezone(360)).isoformat()
        utc = start.astimezone(UTC).isoformat()
        first = post(
            api,
            {"user": student.pk, "package": package.pk, "price_paid": "250", "starts_at": dhaka},
            "same",
        )
        assert first.status_code == 201, first.json()
        again = post(
            api,
            {"user": student.pk, "package": package.pk, "price_paid": "250.00", "starts_at": utc},
            "same",
        )
        assert again.status_code == 201 and again["Idempotent-Replayed"] == "true"
        assert GrantRequest.objects.get().requested_starts_at == start

    def test_explicit_null_price_counts_as_omitted(self, api, student):
        package = make_package()
        post(api, {"user": student.pk, "package": package.pk}, "n")
        again = post(api, {"user": student.pk, "package": package.pk, "price_paid": None}, "n")
        assert again.status_code == 201 and again["Idempotent-Replayed"] == "true"

    def test_replay_does_not_depend_on_the_current_package(self, api, student):
        """The comparison uses the request as sent, never resolved values: a package
        price change or deactivation after the grant does not break the replay."""
        package = make_package()
        body = {"user": student.pk, "package": package.pk}
        post(api, body, "p")
        services.update_package(package.pk, {"price": "999", "status": "inactive"}, ctx=CTX)
        again = post(api, body, "p")
        assert again.status_code == 201 and again["Idempotent-Replayed"] == "true"
        assert again.json()["price_paid"] == "500.00"


# ======================================================================================
# Same key + different request: 409, nothing changes
# ======================================================================================
class TestKeyReuse:
    @pytest.mark.parametrize(
        "first, second",
        [
            ({}, {"user": "other"}),
            ({}, {"package": "other"}),
            ({}, {"price_paid": "500.00"}),  # omitted ≠ explicit, even if equal to the price
            ({"price_paid": "100"}, {}),
            ({"price_paid": "100"}, {"price_paid": "100.01"}),
            ({"price_paid": "0"}, {"price_paid": "100"}),
            ({}, {"starts_at": "start"}),  # omitted ≠ explicit
            ({"starts_at": "start"}, {}),
            ({"starts_at": "start"}, {"starts_at": "start+1s"}),
        ],
    )
    def test_reused_key_with_different_request_is_409(self, api, student, first, second):
        package, other_package = make_package("gold"), make_package("silver")
        other_student = make_student()
        start = timezone.now().replace(microsecond=0) + timedelta(days=3)
        values = {
            "other": None,
            "start": start.isoformat(),
            "start+1s": (start + timedelta(seconds=1)).isoformat(),
        }

        def body(changes):
            data = {"user": student.pk, "package": package.pk}
            for field, value in changes.items():
                if value == "other":
                    data[field] = other_student.pk if field == "user" else other_package.pk
                else:
                    data[field] = values.get(value, value)
            return data

        assert post(api, body(first), "reused").status_code == 201
        subs = list(Subscription.objects.values_list("pk", "expires_at", "price_paid", "status"))
        events = AuditLog.objects.count()
        response = post(api, body(second), "reused")
        assert response.status_code == 409 and code(response) == "idempotency_key_reused"
        assert "Idempotent-Replayed" not in response
        assert (
            list(Subscription.objects.values_list("pk", "expires_at", "price_paid", "status"))
            == subs
        )
        assert AuditLog.objects.count() == events
        assert GrantRequest.objects.count() == 1

    def test_reuse_message_in_bangla(self, api, student):
        package = make_package()
        post(api, {"user": student.pk, "package": package.pk}, "x")
        response = api.post(
            GRANT,
            {"user": student.pk, "package": package.pk, "price_paid": "1"},
            format="json",
            HTTP_ACCEPT_LANGUAGE="bn",
            **idem("x"),
        )
        assert response.status_code == 409
        assert response.json()["error"]["message"].startswith("এই Idempotency-Key আগেই")


# ======================================================================================
# Different keys, different admins
# ======================================================================================
class TestScope:
    def test_different_keys_are_separate_grants(self, api, student):
        package = make_package(validity_days=30, price=Decimal("100"))
        body = {"user": student.pk, "package": package.pk}
        first, second = post(api, body, "k-a"), post(api, body, "k-b")
        assert (first.status_code, second.status_code) == (201, 200)
        assert "Idempotent-Replayed" not in second
        sub = Subscription.objects.get(user=student)
        assert sub.price_paid == Decimal("200")
        assert sub.expires_at - sub.starts_at == timedelta(days=60)
        assert GrantRequest.objects.count() == 2
        assert audits("subscription.grant").count() == 1
        assert audits("subscription.extend").count() == 1

    def test_same_key_for_two_admins_does_not_collide(self, api, admin_user, student):
        other_admin = make_admin("01612345679")
        other = APIClient()
        other.force_login(other_admin)
        package = make_package(validity_days=30, price=Decimal("100"))
        body = {"user": student.pk, "package": package.pk}
        assert post(api, body, "shared").status_code == 201
        response = post(other, body, "shared")
        assert response.status_code == 200 and "Idempotent-Replayed" not in response
        assert Subscription.objects.get(user=student).price_paid == Decimal("200")
        rows = GrantRequest.objects.order_by("pk")
        assert [(r.actor_id, r.key) for r in rows] == [
            (admin_user.pk, "shared"),
            (other_admin.pk, "shared"),
        ]
        # Each admin replays only their own outcome.
        assert post(api, body, "shared").status_code == 201
        assert post(other, body, "shared").status_code == 200

    def test_database_enforces_actor_key_uniqueness(self, admin_user, student):
        package = make_package()
        outcome = once(admin_user, student, package, "dup")
        row = GrantRequest.objects.get(pk=outcome.grant_request_id)
        with pytest.raises(IntegrityError), transaction.atomic():
            GrantRequest.objects.create(
                actor=admin_user,
                key="dup",
                user=student,
                package=package,
                applied_amount=0,
                subscription=row.subscription,
                extended=True,
                status_code=200,
            )

    @pytest.mark.parametrize(
        "fields",
        [
            {"key": "bad key"},
            {"extended": True, "status_code": 201},
            {"extended": False, "status_code": 200},
            {"applied_amount": Decimal("-1")},
            {"requested_price_paid": Decimal("-1")},
        ],
    )
    def test_database_check_constraints(self, admin_user, student, fields):
        sub = grant(student, make_package()).subscription
        data = {
            "actor": admin_user,
            "key": "ok",
            "user": student,
            "package": sub.package,
            "applied_amount": Decimal("0"),
            "subscription": sub,
            "extended": False,
            "status_code": 201,
            **fields,
        }
        with pytest.raises(IntegrityError), transaction.atomic():
            GrantRequest.objects.create(**data)


# ======================================================================================
# Failed grants leave no ledger row; the key can be retried
# ======================================================================================
class TestFailures:
    def test_business_error_stores_nothing_and_key_can_be_retried(self, api, student):
        package = make_package(status=PackageStatus.INACTIVE)
        body = {"user": student.pk, "package": package.pk}
        response = post(api, body, "fix-and-retry")
        assert response.status_code == 400 and "package" in errors(response)
        assert not GrantRequest.objects.exists() and not grant_events().exists()
        services.update_package(package.pk, {"status": "active"}, ctx=CTX)
        response = post(api, body, "fix-and-retry")
        assert response.status_code == 201 and "Idempotent-Replayed" not in response
        assert GrantRequest.objects.count() == 1

    @pytest.mark.parametrize(
        "body",
        [
            {"user": 999999},
            {"package": 999999},
            {"price_paid": "-1"},
            {"starts_at": "2020-01-01T00:00:00Z"},
            {"starts_at": "2030-01-01T10:00:00"},  # no time zone
        ],
    )
    def test_validation_errors_store_nothing(self, api, student, body):
        package = make_package()
        response = post(api, {"user": student.pk, "package": package.pk, **body}, "v")
        assert response.status_code == 400
        assert not GrantRequest.objects.exists() and not Subscription.objects.exists()
        assert post(api, {"user": student.pk, "package": package.pk}, "v").status_code == 201

    def test_extension_with_start_time_fails_and_stores_nothing(self, api, student):
        package = make_package()
        sub = grant(student, package).subscription
        start = (timezone.now() + timedelta(days=1)).isoformat()
        response = post(api, {"user": student.pk, "package": package.pk, "starts_at": start}, "s")
        assert response.status_code == 400 and "starts_at" in errors(response)
        assert not GrantRequest.objects.exists()
        assert Subscription.objects.get(pk=sub.pk).expires_at == sub.expires_at

    @pytest.mark.parametrize("extension", [False, True])
    def test_failure_after_the_grant_rolls_everything_back(self, admin_user, student, extension):
        """The ledger insert fails after grant_subscription changed the subscription:
        the grant, its audit event and the ledger row all roll back together."""
        package = make_package(validity_days=30)
        before = grant(student, package).subscription if extension else None
        events = grant_events().count()
        with (
            mock.patch.object(
                GrantRequest.objects, "create", side_effect=DatabaseError("disk full")
            ),
            pytest.raises(DatabaseError),
        ):
            once(admin_user, student, package, "boom")
        assert not GrantRequest.objects.exists()
        assert grant_events().count() == events
        if extension:
            fresh = Subscription.objects.get(pk=before.pk)
            assert (fresh.expires_at, fresh.price_paid) == (before.expires_at, before.price_paid)
        else:
            assert not Subscription.objects.exists()
        # Retrying with the same key after the failure is a normal first request.
        outcome = once(admin_user, student, package, "boom")
        assert not outcome.replayed and outcome.status_code == (200 if extension else 201)
        assert GrantRequest.objects.count() == 1

    def test_service_requires_an_actor(self, student):
        with pytest.raises(ValueError):
            services.grant_subscription_once(
                student.pk, make_package().pk, key="k", ctx=AuditContext()
            )

    def test_service_reuse_raises_subscription_error(self, admin_user, student):
        package = make_package()
        once(admin_user, student, package, "svc")
        with pytest.raises(SubscriptionError) as exc:
            once(admin_user, student, package, "svc", price_paid=Decimal("1"))
        assert exc.value.code == "idempotency_key_reused"
        with pytest.raises(ValidationError):  # business errors are unchanged
            once(admin_user, make_student(is_active=False), package, "svc-2")


# ======================================================================================
# Permissions (unchanged: admin session + CSRF + admin role)
# ======================================================================================
def test_only_admins_can_grant(admin_user, student):
    package = make_package()
    body = {"user": student.pk, "package": package.pk}
    session_student = APIClient()
    session_student.force_login(student)
    csrf = APIClient(enforce_csrf_checks=True)
    csrf.force_login(admin_user)
    inactive_admin = make_admin("01612345670")
    inactive = APIClient()
    inactive.force_login(inactive_admin)
    User.objects.filter(pk=inactive_admin.pk).update(is_active=False)
    for client, expected in (
        (APIClient(), 401),  # anonymous
        (jwt_client(student), 401),  # student JWT: admin endpoints use sessions only
        (session_student, 403),  # student session: not an admin
        (csrf, 403),  # admin without a CSRF token
        (inactive, 401),  # deactivated admin
    ):
        for key in ("k", None):  # with or without a key: auth is checked first
            headers = idem(key) if key else {}
            response = client.post(GRANT, body, format="json", **headers)
            assert response.status_code == expected, (client, key)
    assert not Subscription.objects.exists() and not GrantRequest.objects.exists()


# ======================================================================================
# Concurrency (real transactions and threads)
# ======================================================================================
@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
@pytest.mark.parametrize("extension", [False, True])
def test_concurrent_same_key_grants_once(run, extension):
    admin = make_admin(f"0161234{run}{int(extension)}00")
    student = make_student()
    package = make_package(f"c{run}{int(extension)}", validity_days=10, price=Decimal("100"))
    if extension:
        grant(student, package)
    before = Subscription.objects.filter(user=student).first()
    # Waiters lock the student row, re-check the key and replay: grant_subscription runs
    # once (not "grant, fail on the unique key, roll back" for every waiter).
    with mock.patch.object(
        services, "grant_subscription", wraps=services.grant_subscription
    ) as spy:
        results = _run_concurrently(*[lambda: once(admin, student, package, "double-click")] * 4)
    assert spy.call_count == 1
    assert all(isinstance(r, services.ManualGrantOutcome) for r in results), results
    assert sum(not r.replayed for r in results) == 1  # exactly one mutation …
    assert {r.subscription_id for r in results} == {Subscription.objects.get(user=student).pk}
    assert {r.status_code for r in results} == {200 if extension else 201}  # … the rest replay
    assert GrantRequest.objects.count() == 1
    sub = Subscription.objects.get(user=student)
    if extension:
        assert sub.price_paid == before.price_paid + Decimal("100")
        assert sub.expires_at == before.expires_at + timedelta(days=10)
        assert audits("subscription.extend").count() == 1
    else:
        assert sub.price_paid == Decimal("100")
        assert sub.expires_at - sub.starts_at == timedelta(days=10)
        assert audits("subscription.grant").count() == 1
        assert not audits("subscription.extend").exists()


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_concurrent_same_key_for_different_students(run):
    """Different student rows are locked, so only the (actor, key) unique constraint
    can catch this race: one grant wins, the other gets 409 and changes nothing."""
    admin = make_admin(f"016123459{run}0")
    first, second = make_student(), make_student()
    package = make_package(f"r{run}")
    results = _run_concurrently(
        lambda: once(admin, first, package, "same"),
        lambda: once(admin, second, package, "same"),
    )
    winners = [r for r in results if isinstance(r, services.ManualGrantOutcome)]
    losers = [r for r in results if isinstance(r, SubscriptionError)]
    assert len(winners) == 1 and len(losers) == 1, results
    assert losers[0].code == "idempotency_key_reused"
    assert Subscription.objects.count() == 1 and GrantRequest.objects.count() == 1
    assert audits("subscription.grant").count() == 1


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(2))
def test_concurrent_different_keys_both_grant(run):
    admin = make_admin(f"016123458{run}0")
    student = make_student()
    package = make_package(f"d{run}", validity_days=10, price=Decimal("100"))
    results = _run_concurrently(
        lambda: once(admin, student, package, "key-a"),
        lambda: once(admin, student, package, "key-b"),
    )
    assert all(isinstance(r, services.ManualGrantOutcome) for r in results), results
    assert sorted(r.status_code for r in results) == [200, 201]
    assert not any(r.replayed for r in results)
    sub = Subscription.objects.get(user=student)
    assert sub.price_paid == Decimal("200")
    assert sub.expires_at - sub.starts_at == timedelta(days=20)
    assert GrantRequest.objects.count() == 2
    assert grant_events().count() == 2


@pytest.mark.django_db(transaction=True)
def test_concurrent_http_double_click():
    """The same race through the real endpoint (session auth, view, serializer)."""
    admin = make_admin("01612345600")
    student = make_student()
    package = make_package("http", validity_days=30)

    def click():
        client = APIClient()
        client.force_login(admin)
        response = post(client, {"user": student.pk, "package": package.pk}, "click")
        connection.close()
        return response.status_code, response.get("Idempotent-Replayed")

    results = _run_concurrently(click, click, click)
    assert sorted(results, key=str) == sorted(
        [(201, None), (201, "true"), (201, "true")], key=str
    ), results
    assert Subscription.objects.count() == 1 and GrantRequest.objects.count() == 1
    assert audits("subscription.grant").count() == 1
