"""Phase 2 of the dynamic gateway system: models, encrypted credentials, the log, and the
sandbox → live rule (apps/payments/gateway_store.py)."""

import itertools
import json
from decimal import Decimal

import pytest
from cryptography.fernet import Fernet
from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured
from django.db import IntegrityError, connection, transaction

from apps.accounts.models import Role, User
from apps.audit.models import AuditLog
from apps.audit.services import AuditContext
from apps.core.secret_box import SecretBoxError
from apps.payments import gateway_store, services
from apps.payments.gateways import Outcome, VerificationResult
from apps.payments.models import (
    GatewayLogType,
    GatewayMode,
    Payment,
    PaymentEventImmutable,
    PaymentGateway,
    PaymentGatewayCredential,
    PaymentGatewayLog,
    PaymentStatus,
)
from tests.test_subscriptions import all_paid, make_package, make_student

pytestmark = pytest.mark.django_db

KEY = Fernet.generate_key().decode()
SECRET = "super-secret-app-secret-123456"  # test-only value
_n = itertools.count(1)


@pytest.fixture(autouse=True)
def _env(settings):
    settings.SECRET_ENCRYPTION_KEY = KEY
    settings.PAYMENT_PROVIDER = "mock"
    settings.PAYMENT_MOCK_ALLOWED = True
    settings.PAYMENT_CALLBACK_BASE_URL = "https://api.test"
    settings.PAYMENT_RETURN_URL = "https://app.test/payment-return"
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def admin():
    return User.objects.create_user(
        f"0161234{next(_n):04d}", password="Strong-Pass-2026", full_name="Ops", role=Role.ADMIN
    )


@pytest.fixture
def ctx(admin):
    return AuditContext(actor=admin, ip_address="203.0.113.7")


def make_gateway(**kwargs):
    n = next(_n)
    values = {"slug": f"bkash-{n}", "adapter": "bkash", "name_en": "bKash", "currencies": ["BDT"]}
    values.update(kwargs)
    return PaymentGateway.objects.create(**values)


def sandbox_success(gateway):
    """A real sandbox payment on `gateway`, verified as paid through the normal service."""
    student = make_student(full_name="Rahim", email="r@example.org")
    package = make_package(f"gold-{next(_n)}", rules=all_paid(), price=Decimal("500.00"))
    payment = Payment.objects.create(
        merchant_reference=services.new_reference(),
        user=student,
        package=package,
        provider="mock",
        gateway=gateway,
        mode=GatewayMode.SANDBOX,
        amount=package.price,
        currency=package.currency,
        validity_days=package.validity_days,
        status=PaymentStatus.PENDING,
    )
    services.apply_verification(
        payment.pk,
        VerificationResult(
            outcome=Outcome.PAID,
            provider="mock",
            merchant_reference=payment.merchant_reference,
            amount=payment.amount,
            currency=payment.currency,
            provider_transaction_id=f"TX{next(_n)}",
        ),
        source="test",
    )
    payment.refresh_from_db()
    assert payment.status == PaymentStatus.SUCCESS
    return payment


class TestModels:
    def test_defaults_are_safe(self):
        gateway = make_gateway()
        assert gateway.enabled is False
        assert gateway.mode == GatewayMode.SANDBOX
        assert gateway.web_enabled and gateway.app_enabled

    def test_many_configurations_per_adapter(self):
        make_gateway(slug="bkash-main")
        make_gateway(slug="bkash-second")
        assert PaymentGateway.objects.filter(adapter="bkash").count() == 2

    @pytest.mark.parametrize("slug", ["Bad Slug", "9start", "x", "has_underscore"])
    def test_bad_slug_refused(self, slug):
        with pytest.raises(IntegrityError), transaction.atomic():
            make_gateway(slug=slug)

    def test_amount_range_must_be_consistent(self):
        with pytest.raises(IntegrityError), transaction.atomic():
            make_gateway(min_amount=Decimal("500"), max_amount=Decimal("100"))

    def test_zero_minimum_refused(self):
        with pytest.raises(IntegrityError), transaction.atomic():
            make_gateway(min_amount=Decimal("0"))

    def test_localized_names_fall_back_to_english(self):
        gateway = make_gateway(name_bn="বিকাশ")
        assert gateway.name_for("bn") == "বিকাশ"
        assert gateway.name_for("en") == "bKash"
        assert make_gateway().name_for("bn") == "bKash"

    def test_new_adapter_needs_no_migration(self):
        # Any well-formed adapter code is storable; only a malformed one is refused.
        make_gateway(adapter="stripe_like")
        with pytest.raises(IntegrityError), transaction.atomic():
            make_gateway(adapter="Not Valid")

    def test_payment_mode_and_gateway_are_frozen(self, ctx):
        gateway = make_gateway()
        other = make_gateway()
        payment = sandbox_success(gateway)
        with pytest.raises(Exception, match="cannot change"), transaction.atomic():
            Payment.objects.filter(pk=payment.pk).update(gateway=other)
        with pytest.raises(Exception, match="cannot change"), transaction.atomic():
            Payment.objects.filter(pk=payment.pk).update(mode=GatewayMode.LIVE)

    def test_old_payments_have_no_gateway(self):
        student = make_student(full_name="Old", email="o@example.org")
        package = make_package(f"old-{next(_n)}", rules=all_paid(), price=Decimal("100.00"))
        payment, _ = services.initiate_payment(student, package.pk)
        assert payment.gateway is None and payment.mode == ""


class TestCredentials:
    def test_stored_encrypted_with_hint_only(self, ctx):
        gateway = make_gateway()
        changed = gateway_store.save_credentials(
            gateway, "sandbox", {"app_secret": SECRET, "app_key": "key-abcdef-123456"}, ctx=ctx
        )
        assert changed == ["app_key", "app_secret"]
        row = PaymentGatewayCredential.objects.get(gateway=gateway, field="app_secret")
        assert SECRET not in row.value_encrypted
        assert row.hint == SECRET[-4:]
        assert gateway_store.read_credentials(gateway, "sandbox")["app_secret"] == SECRET
        assert gateway_store.credential_hints(gateway, "sandbox")["app_secret"] == SECRET[-4:]

    def test_blank_value_keeps_the_old_one(self, ctx):
        gateway = make_gateway()
        gateway_store.save_credentials(gateway, "sandbox", {"app_secret": SECRET}, ctx=ctx)
        assert gateway_store.save_credentials(gateway, "sandbox", {"app_secret": ""}, ctx=ctx) == []
        assert gateway_store.read_credentials(gateway, "sandbox")["app_secret"] == SECRET

    def test_replace_value(self, ctx):
        gateway = make_gateway()
        gateway_store.save_credentials(gateway, "sandbox", {"app_secret": SECRET}, ctx=ctx)
        gateway_store.save_credentials(
            gateway, "sandbox", {"app_secret": "another-value-9999"}, ctx=ctx
        )
        assert gateway_store.read_credentials(gateway, "sandbox") == {
            "app_secret": "another-value-9999"
        }
        assert PaymentGatewayCredential.objects.count() == 1

    def test_sandbox_and_live_never_share(self, ctx):
        gateway = make_gateway()
        gateway_store.save_credentials(
            gateway, "sandbox", {"app_secret": "sandbox-value-1111"}, ctx=ctx
        )
        gateway_store.save_credentials(gateway, "live", {"app_secret": "live-value-2222"}, ctx=ctx)
        assert (
            gateway_store.read_credentials(gateway, "sandbox")["app_secret"] == "sandbox-value-1111"
        )
        assert gateway_store.read_credentials(gateway, "live")["app_secret"] == "live-value-2222"

    def test_two_gateways_of_one_adapter_are_independent(self, ctx):
        first, second = make_gateway(), make_gateway()
        gateway_store.save_credentials(
            first, "sandbox", {"app_secret": "first-merchant-1111"}, ctx=ctx
        )
        gateway_store.save_credentials(
            second, "sandbox", {"app_secret": "second-merchant-2222"}, ctx=ctx
        )
        assert (
            gateway_store.read_credentials(first, "sandbox")["app_secret"] == "first-merchant-1111"
        )
        assert (
            gateway_store.read_credentials(second, "sandbox")["app_secret"]
            == "second-merchant-2222"
        )

    @pytest.mark.parametrize("field", ["Bad Field", "", "9x", "a" * 41, "x;drop"])
    def test_bad_field_name_refused(self, ctx, field):
        gateway = make_gateway()
        with pytest.raises(gateway_store.GatewayStoreError) as error:
            gateway_store.save_credentials(gateway, "sandbox", {field: "value-12345678"}, ctx=ctx)
        assert error.value.code == "invalid_credential_field"

    def test_bad_mode_refused(self, ctx):
        with pytest.raises(gateway_store.GatewayStoreError):
            gateway_store.save_credentials(make_gateway(), "prod", {"a": "value-12345678"}, ctx=ctx)

    def test_oversized_secret_refused_and_nothing_saved(self, ctx):
        gateway = make_gateway()
        with pytest.raises(gateway_store.GatewayStoreError):
            gateway_store.save_credentials(
                gateway,
                "sandbox",
                {"app_key": "ok-value-123456", "app_secret": "x" * 2001},
                ctx=ctx,
            )
        assert not PaymentGatewayCredential.objects.exists()

    def test_without_encryption_key_nothing_is_stored(self, ctx, settings):
        settings.SECRET_ENCRYPTION_KEY = ""
        gateway = make_gateway()
        with pytest.raises(ImproperlyConfigured):
            gateway_store.save_credentials(gateway, "sandbox", {"app_secret": SECRET}, ctx=ctx)
        assert not PaymentGatewayCredential.objects.exists()
        assert not PaymentGatewayLog.objects.exists()

    def test_rotated_key_cannot_read(self, ctx, settings):
        gateway = make_gateway()
        gateway_store.save_credentials(gateway, "sandbox", {"app_secret": SECRET}, ctx=ctx)
        settings.SECRET_ENCRYPTION_KEY = Fernet.generate_key().decode()
        with pytest.raises(SecretBoxError):
            gateway_store.read_credentials(gateway, "sandbox")

    def test_remove_credential(self, ctx):
        gateway = make_gateway()
        gateway_store.save_credentials(gateway, "sandbox", {"app_secret": SECRET}, ctx=ctx)
        assert gateway_store.remove_credential(gateway, "sandbox", "app_secret", ctx=ctx) is True
        assert gateway_store.remove_credential(gateway, "sandbox", "app_secret", ctx=ctx) is False
        assert gateway_store.credential_hints(gateway, "sandbox") == {}

    def test_secret_never_appears_in_text_logs_or_audit(self, ctx, caplog):
        gateway = make_gateway()
        gateway_store.save_credentials(gateway, "sandbox", {"app_secret": SECRET}, ctx=ctx)
        row = PaymentGatewayCredential.objects.get()
        blob = json.dumps(
            [
                list(PaymentGatewayLog.objects.values("summary", "details")),
                list(AuditLog.objects.values("summary", "metadata", "action")),
                str(row),
                repr(row),
                str(gateway),
                caplog.text,
            ],
            default=str,
        )
        assert SECRET not in blob
        entry = PaymentGatewayLog.objects.get(event_type=GatewayLogType.CREDENTIAL_CHANGED)
        assert entry.details == {"mode": "sandbox", "fields": ["app_secret"]}
        assert entry.actor == ctx.actor and entry.source_ip == "203.0.113.7"
        assert AuditLog.objects.filter(action="payment_gateway.credentials").count() == 1


class TestLog:
    def test_entries_cannot_be_changed_or_deleted(self, ctx):
        gateway = make_gateway()
        entry = gateway_store.log_event(gateway, GatewayLogType.CREATED, ctx=ctx, summary="x")
        entry.summary = "tampered"
        with pytest.raises(PaymentEventImmutable):
            entry.save()
        with pytest.raises(PaymentEventImmutable):
            entry.delete()
        with pytest.raises(PaymentEventImmutable):
            PaymentGatewayLog.objects.all().update(summary="x")
        with pytest.raises(PaymentEventImmutable):
            PaymentGatewayLog.objects.all().delete()

    def test_database_blocks_raw_update_and_delete(self, ctx):
        gateway = make_gateway()
        gateway_store.log_event(gateway, GatewayLogType.CREATED, ctx=ctx)
        for sql in (
            "UPDATE payments_paymentgatewaylog SET summary = 'x'",
            "DELETE FROM payments_paymentgatewaylog",
        ):
            with pytest.raises(Exception, match="append-only"), transaction.atomic():
                connection.cursor().execute(sql)

    def test_details_are_trimmed_and_scalar(self, ctx):
        gateway = make_gateway()
        entry = gateway_store.log_event(
            gateway,
            GatewayLogType.ERROR,
            details={"reason": "x" * 500, "fields": ["a"] * 100, "obj": object()},
        )
        assert len(entry.details["reason"]) == 200
        assert len(entry.details["fields"]) == 30
        assert isinstance(entry.details["obj"], str)


class TestLiveRule:
    REQUIRED = ("app_key", "app_secret")

    def _live_credentials(self, gateway, ctx):
        gateway_store.save_credentials(
            gateway,
            "live",
            {"app_key": "live-key-0000001", "app_secret": "live-secret-00001"},
            ctx=ctx,
        )

    def test_blocked_without_credentials_and_sandbox_payment(self, ctx):
        gateway = make_gateway()
        with pytest.raises(gateway_store.GatewayStoreError) as error:
            gateway_store.change_mode(gateway, "live", ctx=ctx, required_live_fields=self.REQUIRED)
        assert error.value.code == "live_not_ready"
        assert set(error.value.blockers) == {
            "missing_credential:app_key",
            "missing_credential:app_secret",
            "no_successful_sandbox_payment",
        }
        gateway.refresh_from_db()
        assert gateway.mode == "sandbox"

    def test_credentials_alone_are_not_enough(self, ctx):
        gateway = make_gateway()
        self._live_credentials(gateway, ctx)
        with pytest.raises(gateway_store.GatewayStoreError) as error:
            gateway_store.change_mode(gateway, "live", ctx=ctx, required_live_fields=self.REQUIRED)
        assert error.value.blockers == ["no_successful_sandbox_payment"]

    def test_sandbox_payment_alone_is_not_enough(self, ctx):
        gateway = make_gateway()
        sandbox_success(gateway)
        with pytest.raises(gateway_store.GatewayStoreError) as error:
            gateway_store.change_mode(gateway, "live", ctx=ctx, required_live_fields=self.REQUIRED)
        assert all(b.startswith("missing_credential:") for b in error.value.blockers)

    def test_other_gateways_sandbox_payment_does_not_count(self, ctx):
        gateway, other = make_gateway(), make_gateway()
        sandbox_success(other)
        self._live_credentials(gateway, ctx)
        with pytest.raises(gateway_store.GatewayStoreError):
            gateway_store.change_mode(gateway, "live", ctx=ctx, required_live_fields=self.REQUIRED)

    def test_failed_or_pending_sandbox_payment_does_not_count(self, ctx):
        gateway = make_gateway()
        student = make_student(full_name="X", email="x@example.org")
        package = make_package(f"p-{next(_n)}", rules=all_paid(), price=Decimal("500.00"))
        for status in (PaymentStatus.PENDING, PaymentStatus.FAILED):
            Payment.objects.create(
                merchant_reference=services.new_reference(),
                user=student,
                package=package,
                provider="mock",
                gateway=gateway,
                mode="sandbox",
                amount=package.price,
                currency=package.currency,
                validity_days=package.validity_days,
                status=status,
            )
        assert gateway_store.sandbox_payment_succeeded(gateway) is False

    def test_proof_is_per_gateway(self, ctx):
        gateway = make_gateway()
        sandbox_success(gateway)
        assert gateway_store.sandbox_payment_succeeded(gateway) is True
        other = make_gateway(mode="live")
        assert gateway_store.sandbox_payment_succeeded(other) is False

    def test_allowed_when_everything_is_in_place(self, ctx):
        gateway = make_gateway()
        self._live_credentials(gateway, ctx)
        sandbox_success(gateway)
        updated = gateway_store.change_mode(
            gateway, "live", ctx=ctx, required_live_fields=self.REQUIRED
        )
        assert updated.mode == "live" and gateway.mode == "live"
        entry = PaymentGatewayLog.objects.get(event_type=GatewayLogType.MODE_CHANGED)
        assert entry.details == {"from": "sandbox", "to": "live"}
        assert AuditLog.objects.filter(action="payment_gateway.mode").count() == 1

    def test_back_to_sandbox_is_always_allowed(self, ctx):
        gateway = make_gateway(mode="live")
        gateway_store.change_mode(gateway, "sandbox", ctx=ctx, required_live_fields=self.REQUIRED)
        gateway.refresh_from_db()
        assert gateway.mode == "sandbox"

    def test_same_mode_is_a_no_op(self, ctx):
        gateway = make_gateway()
        gateway_store.change_mode(gateway, "sandbox", ctx=ctx)
        assert not PaymentGatewayLog.objects.exists()

    def test_unknown_mode_refused(self, ctx):
        with pytest.raises(gateway_store.GatewayStoreError):
            gateway_store.change_mode(make_gateway(), "production", ctx=ctx)
