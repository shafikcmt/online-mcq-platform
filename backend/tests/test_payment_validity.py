"""Payment validity snapshot (technical-debt slice after 7H): a payment freezes the
package's validity at checkout with its amount and currency, every success path grants
that snapshot (never the package's current validity), the database refuses any change to
the snapshot, and migration payments.0002 backfills older rows from the package audit
history with reported fallbacks."""

import importlib
from datetime import timedelta
from decimal import Decimal
from unittest import mock

import pytest
from django.core.cache import cache
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.audit.models import AuditLog
from apps.payments import services
from apps.payments.models import Payment
from apps.subscriptions import services as subscription_services
from apps.subscriptions.models import Package, Subscription
from tests.test_payments import (
    _age,
    close,
    initiate,
    ipn_url,
    mock_callback,
    pay_mock,
    post_form,
    refreshed,
)
from tests.test_subscriptions import CTX, all_paid, make_package, make_student

pytestmark = pytest.mark.django_db

ADMIN = "/api/v1/admin/payments/"
backfill = importlib.import_module("apps.payments.migrations.0002_payment_validity_days")


@pytest.fixture(autouse=True)
def _payment_settings(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "media")
    settings.PAYMENT_PROVIDER = "mock"
    settings.PAYMENT_MOCK_ALLOWED = True
    settings.PAYMENT_CALLBACK_BASE_URL = "https://api.test"
    settings.PAYMENT_RETURN_URL = "https://app.test/payment-return"
    settings.PAYMENT_RECONCILE_MIN_AGE_SECONDS = 900
    settings.PAYMENT_ABANDON_AFTER_SECONDS = 86400
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def student():
    return make_student(full_name="Rahim Hossain")


@pytest.fixture
def package():
    return make_package("gold-validity", rules=all_paid(), validity_days=30)


@pytest.fixture
def admin_client():
    admin = User.objects.create_user(
        "01612345678", password="Strong-Pass-2026", full_name="Ops", role=Role.ADMIN
    )
    client = APIClient()
    client.force_login(admin)
    return client


def set_validity(package, days, **extra):
    """An admin edits the package (audited, like the panel does)."""
    return subscription_services.update_package(
        package.pk, {"validity_days": days, **extra}, ctx=CTX
    )


def period(subscription) -> timedelta:
    subscription.refresh_from_db()
    return subscription.expires_at - subscription.starts_at


def paid_subscription(payment) -> Subscription:
    payment = refreshed(payment)
    assert payment.status == "success", payment.status
    return payment.subscription


# ======================================================================================
# Initiation and database protection
# ======================================================================================
class TestSnapshot:
    def test_captured_at_initiation_with_amount_and_currency(self, student, package):
        payment = initiate(student, package)
        assert (payment.amount, payment.currency, payment.validity_days) == (
            Decimal("500.00"),
            "BDT",
            30,
        )
        set_validity(package, 90, price=Decimal("900.00"))
        payment = refreshed(payment)
        assert (payment.amount, payment.validity_days) == (Decimal("500.00"), 30)

    @pytest.mark.parametrize(
        "change",
        [{"validity_days": 31}, {"amount": Decimal("1.00")}, {"currency": "USD"}],
    )
    def test_database_refuses_snapshot_changes(self, student, package, change):
        payment = initiate(student, package)
        with pytest.raises(Exception, match="payment snapshot"), transaction.atomic():
            Payment.objects.filter(pk=payment.pk).update(**change)
        assert refreshed(payment).validity_days == 30

    def test_bookkeeping_updates_still_work(self, student, package):
        payment = initiate(student, package)
        now = timezone.now()
        Payment.objects.filter(pk=payment.pk).update(last_checked_at=now, failure_reason="x")
        payment = refreshed(payment)
        payment.save()  # a full save rewrites the same snapshot values: allowed
        assert refreshed(payment).last_checked_at == now

    @pytest.mark.parametrize("days", [None, 0, 3651])
    def test_database_bounds(self, student, package, days):
        with pytest.raises(IntegrityError), transaction.atomic():
            Payment.objects.create(
                merchant_reference=services.new_reference(),
                user=student,
                package=package,
                provider="mock",
                amount=package.price,
                currency=package.currency,
                validity_days=days,
            )


# ======================================================================================
# Every success path grants the snapshot
# ======================================================================================
class TestSuccessPathsUseSnapshot:
    def test_success_callback(self, student, package):
        payment = initiate(student, package)
        set_validity(package, 90)  # edited during checkout
        mock_callback(payment, val_id=pay_mock(payment))
        assert period(paid_subscription(payment)) == timedelta(days=30)

    def test_ipn(self, student, package):
        payment = initiate(student, package)
        set_validity(package, 90)
        val_id = pay_mock(payment)
        post_form(ipn_url(), {"tran_id": payment.merchant_reference, "val_id": val_id})
        assert period(paid_subscription(payment)) == timedelta(days=30)

    def test_late_success_recovery(self, student, package):
        payment = close(initiate(student, package))
        set_validity(package, 90)
        mock_callback(payment, val_id=pay_mock(payment, "success"))
        assert period(paid_subscription(payment)) == timedelta(days=30)

    def test_reconciliation(self, student, package):
        payment = initiate(student, package)
        set_validity(package, 90)
        pay_mock(payment)  # the callback never arrives
        _age(payment, 1000)
        services.reconcile_payments()
        assert period(paid_subscription(payment)) == timedelta(days=30)

    def test_admin_reverify(self, student, package, admin_client):
        payment = initiate(student, package)
        set_validity(package, 90)
        pay_mock(payment)
        response = admin_client.post(f"{ADMIN}{payment.public_id}/reverify/")
        assert response.status_code == 200
        assert response.json()["validity_days"] == 30
        assert period(paid_subscription(payment)) == timedelta(days=30)

    def test_inactive_package_still_honours_the_snapshot(self, student, package):
        payment = initiate(student, package)
        set_validity(package, 90, status="inactive")
        mock_callback(payment, val_id=pay_mock(payment))
        assert period(paid_subscription(payment)) == timedelta(days=30)

    def test_renewal_extends_by_each_payments_snapshot(self, student, package):
        first = initiate(student, package)
        mock_callback(first, val_id=pay_mock(first))
        subscription = paid_subscription(first)
        expires = subscription.expires_at
        second = initiate(student, package)  # bought at 30 days
        set_validity(package, 90)
        mock_callback(second, val_id=pay_mock(second))
        assert paid_subscription(second) == subscription
        subscription.refresh_from_db()
        assert subscription.expires_at == expires + timedelta(days=30)
        third = initiate(student, package)  # bought at the new 90 days
        mock_callback(third, val_id=pay_mock(third))
        subscription.refresh_from_db()
        assert subscription.expires_at == expires + timedelta(days=120)
        assert refreshed(third).validity_days == 90

    def test_audit_records_the_validity_applied(self, student, package):
        payment = initiate(student, package)
        set_validity(package, 90)
        mock_callback(payment, val_id=pay_mock(payment))
        entry = AuditLog.objects.get(action="subscription.grant")
        assert entry.metadata["values"]["validity_days"] == 30

    def test_admin_detail_shows_the_snapshot_list_does_not(self, student, package, admin_client):
        payment = initiate(student, package)
        set_validity(package, 90)
        detail = admin_client.get(f"{ADMIN}{payment.public_id}/").json()
        assert detail["validity_days"] == 30
        [row] = admin_client.get(ADMIN).json()["results"]
        assert "validity_days" not in row


# ======================================================================================
# grant_subscription contract
# ======================================================================================
class TestGrantContract:
    def test_manual_grant_uses_the_current_package_validity(self, student, package):
        set_validity(package, 45)
        grant = subscription_services.grant_subscription(student.pk, package.pk, ctx=CTX)
        assert period(grant.subscription) == timedelta(days=45)
        entry = AuditLog.objects.get(action="subscription.grant")
        assert entry.metadata["values"]["validity_days"] == 45

    def test_verified_payment_requires_validity(self, student, package):
        with pytest.raises(ValueError, match="validity_days"):
            subscription_services.grant_subscription(
                student.pk, package.pk, ctx=CTX, for_verified_payment=True
            )
        assert not Subscription.objects.exists()

    def test_explicit_validity_for_grant_and_extension(self, student, package):
        grant = subscription_services.grant_subscription(
            student.pk, package.pk, ctx=CTX, validity_days=10, for_verified_payment=True
        )
        assert period(grant.subscription) == timedelta(days=10)
        expires = grant.subscription.expires_at
        extension = subscription_services.grant_subscription(
            student.pk, package.pk, ctx=CTX, validity_days=7, for_verified_payment=True
        )
        assert extension.extended
        extension.subscription.refresh_from_db()
        assert extension.subscription.expires_at == expires + timedelta(days=7)
        entry = AuditLog.objects.get(action="subscription.extend")
        assert entry.metadata["values"]["validity_days"] == 7

    @pytest.mark.parametrize("days", [0, -1, 3651, True, 1.5, "30"])
    def test_invalid_validity(self, student, package, days):
        with pytest.raises(ValueError):
            subscription_services.grant_subscription(
                student.pk, package.pk, ctx=CTX, validity_days=days
            )
        assert not Subscription.objects.exists()


# ======================================================================================
# Migration payments.0002: audit-derived backfill
# ======================================================================================
def at(moment):
    return mock.patch("django.utils.timezone.now", return_value=moment)


class TestTimeline:
    def test_rules(self):
        t0 = timezone.now()
        timeline = backfill.PackageTimeline()
        timeline.add(t0, None, 30, created=True)
        timeline.add(t0 + timedelta(seconds=10), 30, 60)
        assert timeline.at(t0 - timedelta(seconds=1)) == (30, "earliest_known")
        assert timeline.at(t0) == (30, "audit")  # an event at the same moment counts
        assert timeline.at(t0 + timedelta(seconds=9)) == (30, "audit")
        assert timeline.at(t0 + timedelta(seconds=10)) == (60, "audit")
        only_update = backfill.PackageTimeline()
        only_update.add(t0, 45, 75)
        assert only_update.at(t0 - timedelta(seconds=1)) == (45, "earliest_known")
        unusable_from = backfill.PackageTimeline()
        unusable_from.add(t0, "junk", 75)
        assert unusable_from.at(t0 - timedelta(seconds=1)) == (None, None)


@pytest.mark.django_db(transaction=True)
class TestMigrationUpgrade:
    """Roll payments back to 0001, create legacy rows (no snapshot column), migrate
    forward and check every backfill source and the report."""

    def test_backfill_from_audit_history(self, capsys):
        executor = MigrationExecutor(connection)
        executor.migrate([("payments", "0001_initial")])
        old = executor.loader.project_state([("payments", "0001_initial")]).apps
        OldPayment = old.get_model("payments", "Payment")
        t0 = timezone.now() - timedelta(days=10)
        tick = lambda n: t0 + timedelta(hours=n)  # noqa: E731
        student = make_student()
        refs = iter(range(10**6))

        def legacy(pkg, moment, status="pending", **extra):
            with at(moment):
                return OldPayment.objects.create(
                    merchant_reference=f"MCQLEGACY{next(refs):06d}",
                    user_id=student.pk,
                    package_id=pkg.pk,
                    provider="mock",
                    amount=pkg.price,
                    currency="BDT",
                    status=status,
                    **extra,
                ).pk

        def audited(slug, days, moment):
            with at(moment):
                return make_package(slug, validity_days=days)

        def edit(pkg, days, moment):
            with at(moment):
                set_validity(pkg, days)

        never = audited("never-edited", 30, tick(0))
        p_never = legacy(never, tick(1))
        multi = audited("multi", 30, tick(0))
        edit(multi, 60, tick(2))
        p_between = legacy(multi, tick(3))
        edit(multi, 90, tick(4))
        p_after_both = legacy(multi, tick(5), status="failed")
        later = audited("edited-later", 30, tick(0))
        p_before_edit = legacy(later, tick(1), status="cancelled")
        edit(later, 90, tick(2))
        tie = audited("tie", 30, tick(0))
        edit(tie, 60, tick(6))
        p_tie = legacy(tie, tick(6), status="initiated")  # same moment: the edit counts
        # No create audit (inserted directly), one recorded change 45 → 75.
        with at(tick(0)):
            bare = Package.objects.create(
                slug="bare", name_en="Bare", price=Decimal("100"), validity_days=45
            )
        p_bare_before = legacy(bare, tick(1))
        edit(bare, 75, tick(2))
        p_bare_after = legacy(bare, tick(3))
        # No validity history at all: the current package value.
        with at(tick(0)):
            silent = Package.objects.create(
                slug="silent", name_en="Silent", price=Decimal("100"), validity_days=20
            )
        p_silent = legacy(silent, tick(1))
        # Successful legacy payment: bought at 30, the package changed to 60 before it was
        # verified (so 60 was granted) → reported, never corrected.
        paid = audited("paid", 30, tick(0))
        with at(tick(1)):
            subscription = Subscription.objects.create(
                user=student,
                package=paid,
                starts_at=tick(1),
                expires_at=tick(1) + timedelta(days=60),
                price_paid=Decimal("500"),
            )
        p_success = legacy(paid, tick(1))
        edit(paid, 60, tick(2))
        OldPayment.objects.filter(pk=p_success).update(
            status="success",
            verified_at=tick(3),
            provider_transaction_id="LEGACYTXN1",
            subscription_id=subscription.pk,
        )
        before = (subscription.starts_at, subscription.expires_at, subscription.price_paid)
        audit_count = AuditLog.objects.count()

        executor = MigrationExecutor(connection)
        executor.migrate([("payments", "0002_payment_validity_days")])

        got = dict(Payment.objects.values_list("pk", "validity_days"))
        assert got == {
            p_never: 30,
            p_between: 60,
            p_after_both: 90,
            p_before_edit: 30,
            p_tie: 60,
            p_bare_before: 45,
            p_bare_after: 75,
            p_silent: 20,
            p_success: 30,
        }
        out = capsys.readouterr().out
        assert (
            "payments.0002 validity_days backfill: total=9 audit=7 earliest_known=1 "
            "current_package=1"
        ) in out
        assert "(reported, not corrected)=1" in out
        subscription.refresh_from_db()
        assert (subscription.starts_at, subscription.expires_at, subscription.price_paid) == before
        assert AuditLog.objects.count() == audit_count  # history untouched
        with pytest.raises(Exception, match="payment snapshot"), transaction.atomic():
            Payment.objects.filter(pk=p_never).update(validity_days=31)
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT is_nullable FROM information_schema.columns "
                "WHERE table_name = 'payments_payment' AND column_name = 'validity_days'"
            )
            assert cursor.fetchone() == ("NO",)
        # Reversible: back to 0001 and forward again gives the same values.
        executor = MigrationExecutor(connection)
        executor.migrate([("payments", "0001_initial")])
        executor = MigrationExecutor(connection)
        executor.migrate([("payments", "0002_payment_validity_days")])
        assert dict(Payment.objects.values_list("pk", "validity_days")) == got
