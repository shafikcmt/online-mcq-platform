"""Milestone 4A: packages, access rules, subscriptions and ``user_can_access_exam``."""

import itertools
import json
import threading
import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.audit.models import AuditLog
from apps.audit.services import AuditContext
from apps.catalog import services as catalog
from apps.catalog.exceptions import CatalogInUse
from apps.exams import services as exam_services
from apps.exams.exceptions import ExamStateError
from apps.subscriptions import selectors, services
from apps.subscriptions.exceptions import SubscriptionError
from apps.subscriptions.models import (
    Package,
    PackageAccessRule,
    PackageStatus,
    Subscription,
    SubscriptionStatus,
)
from apps.subscriptions.selectors import active_grants, user_can_access_exam
from tests.test_exams import make_category, make_exam, make_subject

pytestmark = pytest.mark.django_db

PW = "Strong-Pass-2026"  # test-only value
CTX = AuditContext()
PACKAGES = "/api/v1/admin/packages/"
SUBSCRIPTIONS = "/api/v1/admin/subscriptions/"
GRANT = f"{SUBSCRIPTIONS}grant/"
ME = "/api/v1/me/subscriptions/"
PUBLIC = "/api/v1/public/packages/"

_phones = itertools.count(10_000_000)


def idem(key=None) -> dict:
    """The Idempotency-Key header every grant request needs (a fresh key by default)."""
    return {"HTTP_IDEMPOTENCY_KEY": key or uuid.uuid4().hex}


# --------------------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def _media(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "media")


def make_student(**fields):
    fields.setdefault("full_name", "Student")
    return User.objects.create_user(f"017{next(_phones):08d}", password=PW, **fields)


@pytest.fixture
def student():
    return make_student()


@pytest.fixture
def admin_user():
    return User.objects.create_user(
        "01612345678", password=PW, full_name="Ops", role=Role.ADMIN, preferred_language="en"
    )


@pytest.fixture
def api(admin_user):
    client = APIClient()
    client.force_login(admin_user)
    return client


def jwt_client(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(user)['access']}")
    return client


def make_package(slug="gold", rules=None, **fields):
    fields.setdefault("name_en", slug.title())
    fields.setdefault("price", Decimal("500.00"))
    fields.setdefault("validity_days", 30)
    package = services.create_package(Package(slug=slug, **fields), ctx=CTX)
    if rules is not None:
        services.set_access_rules(package.pk, rules, ctx=CTX)
    return package


def all_paid():
    return [{"rule_type": "all_paid_exams"}]


def paid_exam(subject, **extra):
    return make_exam(subject, access_type="paid", **extra)


def grant(user, package, **kwargs):
    return services.grant_subscription(user.pk, package.pk, ctx=CTX, **kwargs)


def audits(action):
    return AuditLog.objects.filter(action=action)


def errors(response):
    return response.json()["error"]["field_errors"]


def code(response):
    return response.json()["error"]["code"]


def field_codes(exc: ValidationError, field: str) -> list[str]:
    return [e.code for e in exc.error_dict[field]]


@pytest.fixture
def subject():
    return make_subject()


# ======================================================================================
# Package
# ======================================================================================
class TestPackage:
    def test_create_normalizes_and_generates_slug(self):
        package = services.create_package(
            Package(
                name_bn="  গোল্ড   প্যাকেজ ",
                name_en=" Gold  Plan ",
                description_en=" Line 1\r\nLine 2 ",
                features_en=["  All exams ", "", "   ", "Merit list"],
                price=Decimal("499.5"),
                validity_days=30,
            ),
            ctx=CTX,
        )
        package.refresh_from_db()
        assert package.slug == "gold-plan"
        assert (package.name_bn, package.name_en) == ("গোল্ড প্যাকেজ", "Gold Plan")
        assert package.description_en == "Line 1\nLine 2"
        assert package.features_en == ["All exams", "Merit list"]
        assert package.features_bn == []
        assert package.currency == "BDT" and package.status == PackageStatus.ACTIVE
        assert package.price == Decimal("499.50")
        assert audits("package.create").count() == 1

    def test_one_name_is_enough_and_both_blank_rejected(self):
        assert make_package("bn-only", name_en="", name_bn="বাংলা").name_bn == "বাংলা"
        with pytest.raises(ValidationError) as exc:
            services.create_package(
                Package(name_bn=" ", name_en="​", slug="x", price=1, validity_days=1),
                ctx=CTX,
            )
        assert field_codes(exc.value, "name_bn") == ["name_required"]
        assert audits("package.create").count() == 1  # only the bn-only package

    def test_slug_generated_unique_and_entered_duplicate_rejected(self):
        first = services.create_package(Package(name_en="Gold", price=1, validity_days=1), ctx=CTX)
        second = services.create_package(Package(name_en="Gold", price=1, validity_days=1), ctx=CTX)
        assert (first.slug, second.slug) == ("gold", "gold-2")
        with pytest.raises(ValidationError) as exc:
            services.create_package(
                Package(name_en="Other", slug="gold", price=1, validity_days=1), ctx=CTX
            )
        assert "slug" in exc.value.error_dict

    @pytest.mark.parametrize("slug", ["Bad Slug", "ক", "a--b", "-a"])
    def test_slug_must_be_ascii_format(self, slug):
        with pytest.raises(ValidationError) as exc:
            make_package(slug)
        assert "slug" in exc.value.error_dict

    def test_bangla_digits_in_slug_normalized(self):
        assert make_package("plan-১২").slug == "plan-12"

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("price", Decimal("-0.01")),
            ("validity_days", 0),
            ("validity_days", 3651),
            ("currency", "USD"),
            ("status", "deleted"),
            ("features_en", "not a list"),
            ("features_en", [1, 2]),
            ("features_bn", ["x"] * 21),
            ("features_bn", ["x" * 201]),
        ],
    )
    def test_invalid_values_rejected(self, field, value):
        with pytest.raises(ValidationError) as exc:
            make_package(**{field: value})
        assert field in exc.value.error_dict
        assert not Package.objects.exists() and not AuditLog.objects.exists()

    def test_price_zero_allowed(self):
        assert make_package(price=Decimal("0")).price == 0

    @pytest.mark.parametrize(
        "sql",
        [
            "UPDATE subscriptions_package SET price = -1",
            "UPDATE subscriptions_package SET validity_days = 0",
            "UPDATE subscriptions_package SET validity_days = 4000",
            "UPDATE subscriptions_package SET currency = 'USD'",
            "UPDATE subscriptions_package SET status = 'gone'",
            "UPDATE subscriptions_package SET name_bn = '', name_en = ''",
            "UPDATE subscriptions_package SET slug = 'Bad Slug'",
        ],
    )
    def test_database_constraints(self, sql):
        make_package()
        with pytest.raises(IntegrityError), transaction.atomic(), connection.cursor() as cur:
            cur.execute(sql)

    def test_update_audits_changes_and_noop_writes_nothing(self):
        package = make_package()
        services.update_package(package.pk, {"name_en": " Gold ", "price": Decimal("500")}, ctx=CTX)
        assert not audits("package.update").exists()
        services.update_package(
            package.pk,
            {"price": Decimal("650"), "status": "inactive", "description_en": "Secret text"},
            ctx=CTX,
        )
        entry = audits("package.update").get()
        assert entry.metadata["changed_fields"] == ["description_en", "price", "status"]
        assert entry.metadata["changes"] == {
            "price": {"from": "500.00", "to": "650.00"},
            "status": {"from": "active", "to": "inactive"},
        }
        assert "Secret text" not in json.dumps(entry.metadata)

    def test_update_failure_writes_nothing(self):
        package = make_package()
        with pytest.raises(ValidationError):
            services.update_package(package.pk, {"validity_days": 0}, ctx=CTX)
        package.refresh_from_db()
        assert package.validity_days == 30 and not audits("package.update").exists()

    def test_ordering_is_deterministic(self):
        b = make_package("b", sort_order=1)
        a = make_package("a", sort_order=1)
        c = make_package("c", sort_order=0)
        assert list(Package.objects.values_list("pk", flat=True)) == [c.pk, b.pk, a.pk]

    def test_delete_unused_package_keeps_categories_and_exams(self, subject):
        exam = paid_exam(subject)
        package = make_package(
            rules=[
                {"rule_type": "category", "category": subject.category_id},
                {"rule_type": "exam", "exam": exam.pk},
            ]
        )
        services.delete_package(package.pk, ctx=CTX)
        assert not Package.objects.exists() and not PackageAccessRule.objects.exists()
        exam.refresh_from_db()
        subject.category.refresh_from_db()
        entry = audits("package.delete").get()
        assert entry.metadata["snapshot"]["slug"] == "gold"

    def test_used_package_cannot_be_deleted(self, student):
        package = make_package()
        grant(student, package)
        services.cancel_subscription(Subscription.objects.get().pk, ctx=CTX)
        with pytest.raises(SubscriptionError) as exc:
            services.delete_package(package.pk, ctx=CTX)
        assert exc.value.code == "in_use"
        assert exc.value.details == {"subscription_count": 1}
        assert Package.objects.exists() and not audits("package.delete").exists()

    def test_price_change_does_not_touch_existing_subscriptions(self, student):
        package = make_package(price=Decimal("500"), validity_days=30)
        subscription = grant(student, package).subscription
        expires = subscription.expires_at
        services.update_package(package.pk, {"price": Decimal("900"), "validity_days": 5}, ctx=CTX)
        subscription.refresh_from_db()
        assert subscription.price_paid == Decimal("500") and subscription.expires_at == expires


# ======================================================================================
# Access rules
# ======================================================================================
class TestAccessRules:
    def test_mixed_rules_saved_and_audited_with_counts_only(self, subject):
        exam = paid_exam(subject)
        package = make_package(
            rules=[
                {"rule_type": "all_paid_exams"},
                {"rule_type": "category", "category": subject.category_id},
                {"rule_type": "exam", "exam": exam.pk},
            ]
        )
        assert package.access_rules.count() == 3
        entry = audits("package.access_rules_update").get()
        assert entry.metadata["values"] == {
            "rule_count": 3,
            "all_paid_exams": True,
            "category_count": 1,
            "exam_count": 1,
        }

    @pytest.mark.parametrize(
        "item",
        [
            {"rule_type": "all_paid_exams", "category": "C"},
            {"rule_type": "all_paid_exams", "exam": "E"},
            {"rule_type": "category"},
            {"rule_type": "category", "category": "C", "exam": "E"},
            {"rule_type": "exam"},
            {"rule_type": "exam", "exam": "E", "category": "C"},
        ],
    )
    def test_invalid_shapes_rejected(self, subject, item):
        exam = paid_exam(subject)
        ids = {"C": subject.category_id, "E": exam.pk}
        item = {k: ids.get(v, v) for k, v in item.items()}
        package = make_package()
        with pytest.raises(ValidationError) as exc:
            services.set_access_rules(package.pk, [item], ctx=CTX)
        assert field_codes(exc.value, "rules") == ["invalid_rule"]

    @pytest.mark.parametrize(
        "rules",
        [
            [{"rule_type": "all_paid_exams"}, {"rule_type": "all_paid_exams"}],
            [{"rule_type": "category", "category": "C"}] * 2,
            [{"rule_type": "exam", "exam": "E"}] * 2,
        ],
    )
    def test_duplicate_rules_rejected(self, subject, rules):
        exam = paid_exam(subject)
        ids = {"C": subject.category_id, "E": exam.pk}
        rules = [{k: ids.get(v, v) for k, v in r.items()} for r in rules]
        package = make_package()
        with pytest.raises(ValidationError) as exc:
            services.set_access_rules(package.pk, rules, ctx=CTX)
        assert field_codes(exc.value, "rules") == ["duplicate_rule"]

    @pytest.mark.parametrize(
        "sql",
        [
            "INSERT INTO subscriptions_packageaccessrule (package_id, rule_type, created_at,"
            " updated_at) SELECT package_id, rule_type, now(), now()"
            " FROM subscriptions_packageaccessrule WHERE rule_type = 'all_paid_exams'",
            "INSERT INTO subscriptions_packageaccessrule (package_id, rule_type, category_id,"
            " created_at, updated_at) SELECT package_id, rule_type, category_id, now(), now()"
            " FROM subscriptions_packageaccessrule WHERE rule_type = 'category'",
            "INSERT INTO subscriptions_packageaccessrule (package_id, rule_type, exam_id,"
            " created_at, updated_at) SELECT package_id, rule_type, exam_id, now(), now()"
            " FROM subscriptions_packageaccessrule WHERE rule_type = 'exam'",
            "UPDATE subscriptions_packageaccessrule SET category_id = NULL"
            " WHERE rule_type = 'category'",
            "UPDATE subscriptions_packageaccessrule SET exam_id = NULL WHERE rule_type = 'exam'",
            "UPDATE subscriptions_packageaccessrule SET rule_type = 'subject'",
        ],
    )
    def test_database_guards(self, subject, sql):
        exam = paid_exam(subject)
        make_package(
            rules=[
                {"rule_type": "all_paid_exams"},
                {"rule_type": "category", "category": subject.category_id},
                {"rule_type": "exam", "exam": exam.pk},
            ]
        )
        with pytest.raises(IntegrityError), transaction.atomic(), connection.cursor() as cur:
            cur.execute(sql)

    def test_missing_targets_and_free_exam_rejected(self, subject):
        free = make_exam(subject)
        package = make_package()
        for rules, expected in [
            ([{"rule_type": "category", "category": 999_999}], "does_not_exist"),
            ([{"rule_type": "exam", "exam": 999_999}], "does_not_exist"),
            ([{"rule_type": "exam", "exam": free.pk}], "exam_not_paid"),
        ]:
            with pytest.raises(ValidationError) as exc:
                services.set_access_rules(package.pk, rules, ctx=CTX)
            assert field_codes(exc.value, "rules") == [expected]
        assert not PackageAccessRule.objects.exists()

    def test_replacement_is_atomic(self, subject):
        exam = paid_exam(subject)
        package = make_package(rules=all_paid())
        with pytest.raises(ValidationError):
            services.set_access_rules(
                package.pk,
                [{"rule_type": "exam", "exam": exam.pk}, {"rule_type": "exam", "exam": 999_999}],
                ctx=CTX,
            )
        assert list(package.access_rules.values_list("rule_type", flat=True)) == ["all_paid_exams"]
        assert audits("package.access_rules_update").count() == 1

    def test_same_rules_in_other_order_is_a_noop(self, subject):
        exam = paid_exam(subject)
        rules = [{"rule_type": "all_paid_exams"}, {"rule_type": "exam", "exam": exam.pk}]
        package = make_package(rules=rules)
        services.set_access_rules(package.pk, list(reversed(rules)), ctx=CTX)
        assert audits("package.access_rules_update").count() == 1

    def test_clearing_rules(self):
        package = make_package(rules=all_paid())
        services.set_access_rules(package.pk, [], ctx=CTX)
        assert not package.access_rules.exists()
        entry = audits("package.access_rules_update").order_by("id").last()
        assert entry.metadata["changes"]["rule_count"] == {"from": 1, "to": 0}

    def test_rule_limit_is_configurable(self, settings, subject):
        settings.PACKAGE_MAX_ACCESS_RULES = 1
        package = make_package()
        with pytest.raises(ValidationError) as exc:
            services.set_access_rules(
                package.pk,
                [{"rule_type": "all_paid_exams"}, {"rule_type": "category", "category": 1}],
                ctx=CTX,
            )
        assert field_codes(exc.value, "rules") == ["too_many_rules"]

    def test_referenced_category_and_exam_cannot_be_deleted(self, subject):
        category = make_category("lonely")
        exam = paid_exam(subject)
        make_package(
            rules=[
                {"rule_type": "category", "category": category.pk},
                {"rule_type": "exam", "exam": exam.pk},
            ]
        )
        with pytest.raises(CatalogInUse):
            catalog.delete_category(category.pk, ctx=CTX)
        with pytest.raises(ExamStateError) as exc:
            exam_services.delete_exam(exam.pk, ctx=CTX)
        assert exc.value.code == "in_use"
        assert not audits("category.delete").exists() and not audits("exam.delete").exists()
        exam.refresh_from_db()
        category.refresh_from_db()

    def test_referenced_delete_via_api_returns_409(self, api, subject):
        category = make_category("lonely")
        exam = paid_exam(subject)
        make_package(
            rules=[
                {"rule_type": "category", "category": category.pk},
                {"rule_type": "exam", "exam": exam.pk},
            ]
        )
        response = api.delete(f"/api/v1/admin/categories/{category.pk}/")
        assert response.status_code == 409 and code(response) == "in_use"
        response = api.delete(f"/api/v1/admin/exams/{exam.pk}/")
        assert response.status_code == 409 and code(response) == "in_use"


# ======================================================================================
# Subscriptions: grant / extend / cancel
# ======================================================================================
class TestGrant:
    def test_new_subscription_window_price_snapshot_and_audit(self, student):
        package = make_package(price=Decimal("500"), validity_days=30)
        before = timezone.now()
        result = grant(student, package)
        sub = result.subscription
        assert not result.extended
        assert before <= sub.starts_at <= timezone.now()
        assert sub.expires_at - sub.starts_at == timedelta(days=30)
        assert sub.status == SubscriptionStatus.ACTIVE and sub.price_paid == Decimal("500")
        entry = audits("subscription.grant").get()
        assert entry.entity_type == "subscriptions.subscription"
        assert entry.metadata["values"]["user_id"] == student.pk
        assert entry.metadata["values"]["price_paid"] == "500.00"
        assert entry.metadata["values"]["validity_days"] == 30

    def test_custom_price_and_negative_rejected(self, student):
        package = make_package()
        assert grant(student, package, price_paid=Decimal("0")).subscription.price_paid == 0
        other = make_package("silver")
        with pytest.raises(ValidationError) as exc:
            grant(student, other, price_paid=Decimal("-1"))
        assert "price_paid" in exc.value.error_dict

    def test_future_start_is_scheduled(self, student):
        package = make_package(validity_days=10)
        start = timezone.now() + timedelta(days=2)
        sub = grant(student, package, starts_at=start).subscription
        assert (sub.starts_at, sub.expires_at) == (start, start + timedelta(days=10))
        assert selectors.effective_status(sub) == "scheduled"

    def test_start_in_past_or_too_far_rejected(self, student):
        package = make_package()
        for start, expected in [
            (timezone.now() - timedelta(minutes=1), "start_in_past"),
            (timezone.now() + timedelta(days=366), "start_too_late"),
        ]:
            with pytest.raises(ValidationError) as exc:
                grant(student, package, starts_at=start)
            assert field_codes(exc.value, "starts_at") == [expected]
        assert (
            not Subscription.objects.exists()
            and not AuditLog.objects.filter(action__startswith="subscription.").exists()
        )

    def test_only_active_students_and_active_packages(self, student, admin_user):
        package = make_package()
        inactive_student = make_student(is_active=False)
        for user_id in (admin_user.pk, inactive_student.pk):
            with pytest.raises(ValidationError) as exc:
                services.grant_subscription(user_id, package.pk, ctx=CTX)
            assert field_codes(exc.value, "user") == ["not_student"]
        with pytest.raises(ValidationError) as exc:
            services.grant_subscription(999_999, package.pk, ctx=CTX)
        assert field_codes(exc.value, "user") == ["does_not_exist"]
        with pytest.raises(ValidationError) as exc:
            services.grant_subscription(student.pk, 999_999, ctx=CTX)
        assert field_codes(exc.value, "package") == ["does_not_exist"]
        services.update_package(package.pk, {"status": "inactive"}, ctx=CTX)
        with pytest.raises(ValidationError) as exc:
            grant(student, package)
        assert field_codes(exc.value, "package") == ["package_inactive"]
        assert not Subscription.objects.exists()

    def test_same_package_extends_from_current_expiry(self, student):
        package = make_package(price=Decimal("500"), validity_days=30)
        first = grant(student, package).subscription
        result = grant(student, package, price_paid=Decimal("450"))
        assert result.extended and result.subscription.pk == first.pk
        sub = Subscription.objects.get()
        assert sub.expires_at == first.expires_at + timedelta(days=30)
        assert sub.starts_at == first.starts_at and sub.price_paid == Decimal("950")
        entry = audits("subscription.extend").get()
        assert entry.metadata["changes"]["price_paid"] == {"from": "500.00", "to": "950.00"}
        assert entry.metadata["changes"]["expires_at"]["to"] == sub.expires_at.isoformat()

    def test_extending_a_scheduled_subscription(self, student):
        package = make_package(validity_days=10)
        start = timezone.now() + timedelta(days=5)
        grant(student, package, starts_at=start)
        grant(student, package)
        sub = Subscription.objects.get()
        assert (sub.starts_at, sub.expires_at) == (start, start + timedelta(days=20))

    def test_start_time_not_allowed_when_extending(self, student):
        package = make_package()
        grant(student, package)
        with pytest.raises(ValidationError) as exc:
            grant(student, package, starts_at=timezone.now() + timedelta(days=1))
        assert field_codes(exc.value, "starts_at") == ["extension_start_not_allowed"]
        assert not audits("subscription.extend").exists()

    def test_stale_active_row_is_expired_and_a_new_period_starts(self, student):
        package = make_package(validity_days=30)
        old = grant(student, package).subscription
        Subscription.objects.filter(pk=old.pk).update(
            starts_at=timezone.now() - timedelta(days=40),
            expires_at=timezone.now() - timedelta(days=10),
        )
        result = grant(student, package)
        old.refresh_from_db()
        assert not result.extended and result.subscription.pk != old.pk
        assert old.status == SubscriptionStatus.EXPIRED
        new = result.subscription
        assert new.expires_at - new.starts_at == timedelta(days=30)
        assert new.starts_at >= timezone.now() - timedelta(minutes=1)

    @pytest.mark.parametrize("old_status", ["expired", "cancelled"])
    def test_after_expired_or_cancelled_a_new_row_is_created(self, student, old_status):
        package = make_package()
        old = grant(student, package).subscription
        Subscription.objects.filter(pk=old.pk).update(status=old_status)
        result = grant(student, package)
        assert not result.extended and Subscription.objects.count() == 2
        old.refresh_from_db()
        assert old.status == old_status

    def test_different_package_runs_in_parallel(self, student):
        gold, silver = make_package("gold"), make_package("silver")
        a, b = grant(student, gold).subscription, grant(student, silver).subscription
        assert a.pk != b.pk
        assert set(selectors.active_subscriptions(student)) == {a, b}

    def test_one_active_row_per_user_and_package_in_database(self, student):
        package = make_package()
        sub = grant(student, package).subscription
        with pytest.raises(IntegrityError), transaction.atomic():
            Subscription.objects.create(
                user=student,
                package=package,
                starts_at=sub.starts_at,
                expires_at=sub.expires_at,
                price_paid=0,
            )

    @pytest.mark.parametrize(
        "sql",
        [
            "UPDATE subscriptions_subscription SET expires_at = starts_at",
            "UPDATE subscriptions_subscription SET price_paid = -1",
            "UPDATE subscriptions_subscription SET status = 'paused'",
        ],
    )
    def test_subscription_database_constraints(self, student, sql):
        grant(student, make_package())
        with pytest.raises(IntegrityError), transaction.atomic(), connection.cursor() as cur:
            cur.execute(sql)

    def test_package_and_user_are_protected(self, student):
        package = make_package()
        grant(student, package)
        with pytest.raises(IntegrityError), transaction.atomic(), connection.cursor() as cur:
            cur.execute("SET CONSTRAINTS ALL IMMEDIATE")  # Django FKs are deferred
            cur.execute("DELETE FROM subscriptions_package")
        from django.db.models import ProtectedError

        with pytest.raises(ProtectedError):
            student.delete()


class TestCancel:
    def test_cancel_removes_access_immediately(self, student, subject):
        exam = paid_exam(subject)
        sub = grant(student, make_package(rules=all_paid())).subscription
        assert user_can_access_exam(student, exam)
        services.cancel_subscription(sub.pk, ctx=CTX)
        sub.refresh_from_db()
        assert sub.status == SubscriptionStatus.CANCELLED
        assert not user_can_access_exam(student, exam)
        entry = audits("subscription.cancel").get()
        assert entry.metadata["changes"] == {"status": {"from": "active", "to": "cancelled"}}

    def test_repeat_cancel_and_expired_are_conflicts(self, student):
        package = make_package()
        sub = grant(student, package).subscription
        services.cancel_subscription(sub.pk, ctx=CTX)
        with pytest.raises(SubscriptionError) as exc:
            services.cancel_subscription(sub.pk, ctx=CTX)
        assert exc.value.code == "already_cancelled"
        other = grant(student, make_package("silver")).subscription
        Subscription.objects.filter(pk=other.pk).update(
            starts_at=timezone.now() - timedelta(days=5), expires_at=timezone.now()
        )
        with pytest.raises(SubscriptionError) as exc:
            services.cancel_subscription(other.pk, ctx=CTX)
        assert exc.value.code == "subscription_expired"
        Subscription.objects.filter(pk=other.pk).update(status="expired")
        with pytest.raises(SubscriptionError) as exc:
            services.cancel_subscription(other.pk, ctx=CTX)
        assert exc.value.code == "subscription_expired"
        assert audits("subscription.cancel").count() == 1
        other.refresh_from_db()
        assert other.status == "expired"

    def test_scheduled_subscription_can_be_cancelled(self, student):
        sub = grant(
            student, make_package(), starts_at=timezone.now() + timedelta(days=1)
        ).subscription
        assert services.cancel_subscription(sub.pk, ctx=CTX).status == "cancelled"


# ======================================================================================
# user_can_access_exam
# ======================================================================================
class TestAccess:
    def test_free_exam_needs_no_subscription(self, student, subject, admin_user):
        from django.contrib.auth.models import AnonymousUser

        exam = make_exam(subject)
        assert user_can_access_exam(student, exam)
        assert not user_can_access_exam(AnonymousUser(), exam)
        assert not user_can_access_exam(None, exam)
        assert not user_can_access_exam(admin_user, exam)
        assert not user_can_access_exam(make_student(is_active=False), exam)

    def test_paid_exam_without_subscription_denied(self, student, subject):
        make_package(rules=all_paid())
        assert not user_can_access_exam(student, paid_exam(subject))

    def test_all_paid_rule(self, student, subject):
        exam = paid_exam(subject)
        other = paid_exam(make_subject("bio", category=make_category("life")))
        grant(student, make_package(rules=all_paid()))
        assert user_can_access_exam(student, exam) and user_can_access_exam(student, other)

    def test_category_rule(self, student, subject):
        exam = paid_exam(subject)
        other = paid_exam(make_subject("bio", category=make_category("life")))
        grant(
            student,
            make_package(rules=[{"rule_type": "category", "category": subject.category_id}]),
        )
        assert user_can_access_exam(student, exam)
        assert not user_can_access_exam(student, other)

    def test_exact_exam_rule(self, student, subject):
        exam, sibling = paid_exam(subject), paid_exam(subject)
        grant(student, make_package(rules=[{"rule_type": "exam", "exam": exam.pk}]))
        assert user_can_access_exam(student, exam)
        assert not user_can_access_exam(student, sibling)

    def test_package_without_rules_grants_nothing(self, student, subject):
        grant(student, make_package())
        assert not user_can_access_exam(student, paid_exam(subject))

    def test_other_users_subscription_does_not_count(self, student, subject):
        grant(make_student(), make_package(rules=all_paid()))
        assert not user_can_access_exam(student, paid_exam(subject))

    def test_expired_window_denied_even_if_status_still_active(self, student, subject):
        exam = paid_exam(subject)
        sub = grant(student, make_package(rules=all_paid())).subscription
        Subscription.objects.filter(pk=sub.pk).update(
            starts_at=timezone.now() - timedelta(days=31),
            expires_at=timezone.now() - timedelta(seconds=1),
        )
        sub.refresh_from_db()
        assert sub.status == SubscriptionStatus.ACTIVE
        assert not user_can_access_exam(student, exam)
        assert selectors.effective_status(sub) == "expired"

    def test_window_boundaries(self, student, subject):
        exam = paid_exam(subject)
        start = timezone.now() + timedelta(hours=1)
        sub = grant(student, make_package(rules=all_paid()), starts_at=start).subscription
        tick = timedelta(microseconds=1)
        assert not user_can_access_exam(student, exam, at=start - tick)
        assert user_can_access_exam(student, exam, at=start)
        assert user_can_access_exam(student, exam, at=sub.expires_at - tick)
        assert not user_can_access_exam(student, exam, at=sub.expires_at)
        assert not user_can_access_exam(student, exam)  # not started yet

    @pytest.mark.parametrize("stored", ["cancelled", "expired"])
    def test_cancelled_or_expired_status_denied_inside_window(self, student, subject, stored):
        exam = paid_exam(subject)
        sub = grant(student, make_package(rules=all_paid())).subscription
        Subscription.objects.filter(pk=sub.pk).update(status=stored)
        assert not user_can_access_exam(student, exam)

    def test_inactive_package_keeps_existing_access(self, student, subject):
        exam = paid_exam(subject)
        package = make_package(rules=all_paid())
        grant(student, package)
        services.update_package(package.pk, {"status": "inactive"}, ctx=CTX)
        assert user_can_access_exam(student, exam)
        assert not Package.objects.filter(status=PackageStatus.ACTIVE).exists()

    def test_multiple_subscriptions(self, student, subject):
        exam = paid_exam(subject)
        expired = grant(student, make_package("a", rules=all_paid())).subscription
        Subscription.objects.filter(pk=expired.pk).update(status="expired")
        assert not user_can_access_exam(student, exam)
        grant(student, make_package("b", rules=[{"rule_type": "exam", "exam": exam.pk}]))
        assert user_can_access_exam(student, exam)

    def test_rule_change_applies_to_existing_subscribers(self, student, subject):
        exam = paid_exam(subject)
        package = make_package(rules=all_paid())
        grant(student, package)
        services.set_access_rules(package.pk, [], ctx=CTX)
        assert not user_can_access_exam(student, exam)

    def test_query_counts(self, student, subject):
        free, paid = make_exam(subject), paid_exam(subject)
        grant(student, make_package(rules=all_paid()))
        with CaptureQueriesContext(connection) as queries:
            assert user_can_access_exam(student, free)
        assert len(queries) == 0
        with CaptureQueriesContext(connection) as queries:
            assert user_can_access_exam(student, paid)
        assert len(queries) == 1

    def test_active_grants_matches_single_checks_in_one_query(self, student, subject):
        life = make_category("life")
        exams = [
            paid_exam(subject),
            paid_exam(subject),
            paid_exam(make_subject("bio", category=life)),
            make_exam(subject),
        ]
        grant(
            student,
            make_package(
                rules=[
                    {"rule_type": "category", "category": life.pk},
                    {"rule_type": "exam", "exam": exams[0].pk},
                ]
            ),
        )
        with CaptureQueriesContext(connection) as queries:
            grants = active_grants(student)
        assert len(queries) == 1
        assert [grants.covers(e) for e in exams] == [True, False, True, True]
        assert [grants.covers(e) for e in exams] == [
            user_can_access_exam(student, e) for e in exams
        ]
        assert active_grants(make_student(is_active=False)) is None


# ======================================================================================
# Admin API
# ======================================================================================
class TestAdminAPI:
    def test_permissions_and_csrf(self, admin_user, student):
        package = make_package()
        sub = grant(student, package).subscription
        session_student = APIClient()
        session_student.force_login(student)
        csrf = APIClient(enforce_csrf_checks=True)
        csrf.force_login(admin_user)
        reads = [
            PACKAGES,
            f"{PACKAGES}{package.pk}/",
            f"{PACKAGES}{package.pk}/access-rules/",
            SUBSCRIPTIONS,
            f"{SUBSCRIPTIONS}{sub.pk}/",
        ]
        writes = [
            ("post", PACKAGES, {"name_en": "X", "price": "1", "validity_days": 1}),
            ("patch", f"{PACKAGES}{package.pk}/", {"price": "2"}),
            ("delete", f"{PACKAGES}{package.pk}/", None),
            ("patch", f"{PACKAGES}{package.pk}/access-rules/", {"rules": []}),
            ("post", GRANT, {"user": student.pk, "package": package.pk}),
            ("post", f"{SUBSCRIPTIONS}{sub.pk}/cancel/", None),
        ]
        for url in reads:
            assert APIClient().get(url).status_code == 401
            assert jwt_client(student).get(url).status_code == 401
            assert session_student.get(url).status_code == 403
            assert csrf.get(url).status_code == 200
        for method, url, body in writes:
            assert getattr(APIClient(), method)(url, body, format="json").status_code == 401
            assert getattr(jwt_client(student), method)(url, body, format="json").status_code == 401
            assert getattr(session_student, method)(url, body, format="json").status_code == 403
            assert getattr(csrf, method)(url, body, format="json").status_code == 403
        assert not AuditLog.objects.exclude(
            action__in=["package.create", "subscription.grant"]
        ).exists()

    def test_package_crud(self, api):
        response = api.post(
            PACKAGES,
            {
                "name_bn": "গোল্ড",
                "name_en": "Gold",
                "features_en": ["All paid exams"],
                "price": "499.00",
                "validity_days": 30,
                "id": 999,
            },
            format="json",
        )
        assert response.status_code == 201, response.json()
        body = response.json()
        assert body["slug"] == "gold" and body["id"] != 999
        assert body["currency"] == "BDT" and body["status"] == "active"
        assert body["rule_count"] == 0 and body["subscription_count"] == 0
        detail = f"{PACKAGES}{body['id']}/"
        response = api.patch(detail, {"status": "inactive", "price": "550"}, format="json")
        assert response.status_code == 200 and response.json()["price"] == "550.00"
        assert api.put(detail, {}, format="json").status_code == 405
        assert api.delete(detail).status_code == 204
        assert api.get(detail).status_code == 404

    def test_package_numbers_typed_with_bangla_digits(self, api):
        """docs/LOCALIZATION.md §11: Bangla-digit input is accepted for prices and counts
        (the Admin Panel sends what was typed; Python's Decimal/int read any Unicode digit)."""
        response = api.post(
            PACKAGES,
            {"name_en": "Gold", "price": "৪৯৯.৫০", "validity_days": "৩০", "sort_order": "২"},
            format="json",
        )
        assert response.status_code == 201, response.json()
        body = response.json()
        assert (body["price"], body["validity_days"], body["sort_order"]) == ("499.50", 30, 2)
        package = Package.objects.get(pk=body["id"])
        assert (package.price, package.validity_days) == (Decimal("499.50"), 30)

    @pytest.mark.parametrize(
        "payload",
        [
            {"price": "-1"},
            {"validity_days": 0},
            {"currency": "USD"},
            {"status": "gone"},
            {"features_en": "x"},
            {"name_en": "", "name_bn": ""},
        ],
    )
    def test_package_validation(self, api, payload):
        data = {"name_en": "Gold", "price": "1", "validity_days": 1, **payload}
        response = api.post(PACKAGES, data, format="json")
        assert response.status_code == 400 and code(response) == "validation_error"
        assert not Package.objects.exists()

    def test_package_list_filters(self, api):
        make_package("a", status="inactive")
        make_package("b", is_featured=True, name_bn="বাংলা")
        assert [p["slug"] for p in api.get(f"{PACKAGES}?status=active").json()["results"]] == ["b"]
        assert [p["slug"] for p in api.get(f"{PACKAGES}?is_featured=true").json()["results"]] == [
            "b"
        ]
        assert [p["slug"] for p in api.get(f"{PACKAGES}?search=বাংলা").json()["results"]] == ["b"]
        assert api.get(f"{PACKAGES}?status=x").status_code == 400
        assert api.get(f"{PACKAGES}?ordering=secret").status_code == 400

    def test_delete_used_package_returns_409(self, api, student):
        package = make_package()
        grant(student, package)
        response = api.delete(f"{PACKAGES}{package.pk}/")
        assert response.status_code == 409 and code(response) == "in_use"
        assert response.json()["error"]["details"] == {"subscription_count": 1}

    def test_access_rules_endpoint(self, api, subject):
        exam = paid_exam(subject)
        package = make_package()
        url = f"{PACKAGES}{package.pk}/access-rules/"
        response = api.patch(
            url,
            {
                "rules": [
                    {"rule_type": "all_paid_exams"},
                    {"rule_type": "category", "category": subject.category_id, "exam": None},
                    {"rule_type": "exam", "exam": exam.pk},
                ]
            },
            format="json",
        )
        assert response.status_code == 200, response.json()
        rules = response.json()["rules"]
        assert [r["rule_type"] for r in rules] == ["all_paid_exams", "category", "exam"]
        assert rules[1]["category"]["slug"] == subject.category.slug and rules[1]["exam"] is None
        assert rules[2]["exam"]["id"] == exam.pk and rules[2]["exam"]["access_type"] == "paid"
        assert api.get(url).json() == response.json()
        bad = api.patch(url, {"rules": [{"rule_type": "exam"}]}, format="json")
        assert bad.status_code == 400 and "rules" in errors(bad)
        assert api.patch(url, {"rules": [{"rule_type": "x"}]}, format="json").status_code == 400
        assert api.patch(url, {}, format="json").status_code == 400
        assert api.get(f"{PACKAGES}999999/access-rules/").status_code == 404
        assert api.get(f"{PACKAGES}{package.pk}/").json()["rule_count"] == 3

    def test_grant_extend_and_cancel(self, api, student):
        package = make_package(validity_days=30)
        response = api.post(
            GRANT, {"user": student.pk, "package": package.pk}, format="json", **idem()
        )
        assert response.status_code == 201, response.json()
        body = response.json()
        assert body["user"]["id"] == student.pk and body["package"]["slug"] == "gold"
        assert body["status"] == "active" and body["effective_status"] == "active"
        assert body["price_paid"] == "500.00" and body["currency"] == "BDT"
        response = api.post(
            GRANT,
            {"user": student.pk, "package": package.pk, "price_paid": "0"},
            format="json",
            **idem(),
        )
        assert response.status_code == 200 and response.json()["id"] == body["id"]
        assert response.json()["price_paid"] == "500.00"
        cancel = f"{SUBSCRIPTIONS}{body['id']}/cancel/"
        response = api.post(cancel)
        assert response.status_code == 200 and response.json()["status"] == "cancelled"
        response = api.post(cancel)
        assert response.status_code == 409 and code(response) == "already_cancelled"
        assert api.post(f"{SUBSCRIPTIONS}999999/cancel/").status_code == 404

    @pytest.mark.parametrize(
        "payload",
        [
            {"starts_at": "2030-01-01T10:00:00"},  # no time zone
            {"price_paid": "-1"},
            {"user": "abc"},
            {"package": None},
        ],
    )
    def test_grant_validation(self, api, student, payload):
        package = make_package()
        data = {"user": student.pk, "package": package.pk, **payload}
        response = api.post(GRANT, data, format="json", **idem())
        assert response.status_code == 400
        assert not Subscription.objects.exists()

    def test_grant_business_errors_are_field_errors(self, api, student, admin_user):
        package = make_package(status="inactive")
        response = api.post(
            GRANT, {"user": student.pk, "package": package.pk}, format="json", **idem()
        )
        assert response.status_code == 400 and "package" in errors(response)
        active = make_package("silver")
        response = api.post(
            GRANT, {"user": admin_user.pk, "package": active.pk}, format="json", **idem()
        )
        assert response.status_code == 400 and "user" in errors(response)

    def test_subscription_status_cannot_be_patched(self, api, student):
        sub = grant(student, make_package()).subscription
        detail = f"{SUBSCRIPTIONS}{sub.pk}/"
        for method in ("patch", "put", "delete"):
            assert (
                getattr(api, method)(detail, {"status": "active"}, format="json").status_code == 405
            )
        assert api.post(SUBSCRIPTIONS, {}, format="json").status_code == 405

    def test_subscription_list_filters(self, api, student):
        other = make_student()
        gold, silver = make_package("gold"), make_package("silver")
        a = grant(student, gold).subscription
        b = grant(other, silver).subscription
        c = grant(student, silver).subscription
        Subscription.objects.filter(pk=c.pk).update(
            starts_at=timezone.now() - timedelta(days=40), expires_at=timezone.now()
        )

        def ids(query):
            response = api.get(f"{SUBSCRIPTIONS}?{query}")
            assert response.status_code == 200, response.json()
            return {row["id"] for row in response.json()["results"]}

        assert ids("") == {a.pk, b.pk, c.pk}
        assert ids(f"user={student.pk}") == {a.pk, c.pk}
        assert ids(f"package={silver.pk}") == {b.pk, c.pk}
        assert ids("active=true") == {a.pk, b.pk}
        assert ids("active=false") == {c.pk}
        assert ids("status=active") == {a.pk, b.pk, c.pk}
        expired_row = api.get(f"{SUBSCRIPTIONS}{c.pk}/").json()
        assert expired_row["status"] == "active" and expired_row["effective_status"] == "expired"
        assert api.get(f"{SUBSCRIPTIONS}?status=paused").status_code == 400
        assert api.get(f"{SUBSCRIPTIONS}?user=x").status_code == 400
        assert api.get(f"{SUBSCRIPTIONS}?ordering=-expires_at").status_code == 200


# ======================================================================================
# Student API: /me/subscriptions
# ======================================================================================
class TestMySubscriptions:
    def test_only_own_rows_and_safe_fields(self, student, admin_user):
        package = make_package(name_bn="গোল্ড", name_en="Gold", price=Decimal("777"))
        mine = grant(student, package).subscription
        grant(make_student(), package)
        client = jwt_client(student)
        response = client.get(f"{ME}?user=999&id={mine.pk + 1}", HTTP_ACCEPT_LANGUAGE="bn")
        assert response.status_code == 200
        rows = response.json()["results"]
        assert len(rows) == 1
        row = rows[0]
        assert set(row) == {"package", "status", "effective_status", "starts_at", "expires_at"}
        assert row["package"] == {"slug": "gold", "name": "গোল্ড"}
        assert row["effective_status"] == "active"
        # The price never leaks. "777.00" (not "777"): a timestamp's microseconds may
        # contain "777" by chance, but never "777.00".
        assert "777.00" not in json.dumps(response.json())

    def test_effective_status_values(self, student):
        a = grant(student, make_package("a")).subscription
        grant(student, make_package("b"), starts_at=timezone.now() + timedelta(days=1))
        c = grant(student, make_package("c")).subscription
        d = grant(student, make_package("d")).subscription
        services.cancel_subscription(c.pk, ctx=CTX)
        Subscription.objects.filter(pk=d.pk).update(
            starts_at=timezone.now() - timedelta(days=9), expires_at=timezone.now()
        )
        rows = jwt_client(student).get(ME).json()["results"]
        statuses = {row["package"]["slug"]: row["effective_status"] for row in rows}
        assert statuses == {"a": "active", "b": "scheduled", "c": "cancelled", "d": "expired"}
        assert a.pk

    def test_authentication_required(self, student, admin_user):
        assert APIClient().get(ME).status_code == 401
        session = APIClient()
        session.force_login(admin_user)
        assert session.get(ME).status_code == 401  # admin session is not accepted here
        assert jwt_client(admin_user).get(ME).status_code == 401  # student tokens only
        inactive = make_student()
        client = jwt_client(inactive)
        inactive.is_active = False
        inactive.save(update_fields=["is_active"])
        assert client.get(ME).status_code == 401
        assert jwt_client(student).post(ME, {}, format="json").status_code == 405


# ======================================================================================
# Public API: /public/packages
# ======================================================================================
class TestPublicPackages:
    def test_active_packages_with_safe_localized_fields(self, subject):
        make_package(
            "gold",
            name_bn="গোল্ড",
            name_en="Gold",
            description_en="English only",
            features_bn=[],
            features_en=["All paid exams"],
            sort_order=2,
            is_featured=True,
            rules=all_paid(),
        )
        make_package("basic", name_en="Basic", price=Decimal("0"), sort_order=1)
        make_package("hidden", status="inactive")
        response = APIClient().get(PUBLIC, HTTP_ACCEPT_LANGUAGE="bn")
        assert response.status_code == 200
        rows = response.json()["results"]
        assert [r["slug"] for r in rows] == ["basic", "gold"]
        gold = rows[1]
        assert set(gold) == {
            "slug",
            "name",
            "description",
            "features",
            "price",
            "currency",
            "validity_days",
            "is_featured",
        }
        assert gold["name"] == "গোল্ড"
        assert gold["description"] == "English only" and gold["features"] == ["All paid exams"]
        assert (gold["price"], gold["currency"], gold["validity_days"]) == ("500.00", "BDT", 30)
        english = APIClient().get(PUBLIC, HTTP_ACCEPT_LANGUAGE="en").json()["results"][1]
        assert english["name"] == "Gold"

    def test_credentials_are_ignored(self, student):
        make_package()
        plain = APIClient().get(PUBLIC).json()
        broken = APIClient()
        broken.credentials(HTTP_AUTHORIZATION="Bearer broken")
        assert broken.get(PUBLIC).json() == plain
        assert jwt_client(student).get(PUBLIC).json() == plain
        assert APIClient().post(PUBLIC, {}, format="json").status_code == 405


# ======================================================================================
# Audit content
# ======================================================================================
def test_audit_never_stores_text_content(student, subject):
    package = make_package(
        description_bn="গোপন বিবরণ",
        description_en="Secret description",
        features_en=["Secret feature"],
        rules=all_paid(),
    )
    services.update_package(package.pk, {"features_en": ["Other secret"]}, ctx=CTX)
    sub = grant(student, package).subscription
    grant(student, package)
    services.cancel_subscription(sub.pk, ctx=CTX)
    dump = json.dumps(list(AuditLog.objects.values("metadata", "summary")), ensure_ascii=False)
    for text in ("গোপন", "Secret", "Other secret", student.mobile_number, PW):
        assert text not in dump
    counts = {
        action: audits(action).count()
        for action in (
            "package.create",
            "package.update",
            "package.access_rules_update",
            "subscription.grant",
            "subscription.extend",
            "subscription.cancel",
        )
    }
    assert set(counts.values()) == {1}


# ======================================================================================
# Concurrency
# ======================================================================================
def _run_concurrently(*funcs):
    barrier = threading.Barrier(len(funcs))
    results = [None] * len(funcs)

    def runner(index, func):
        try:
            barrier.wait()
            results[index] = func()
        except Exception as exc:  # noqa: BLE001 — asserted by the tests
            results[index] = exc
        finally:
            connection.close()

    threads = [threading.Thread(target=runner, args=(i, f)) for i, f in enumerate(funcs)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    return results


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_concurrent_grants_of_same_package_lose_no_extension(run):
    student = make_student()
    package = make_package(f"p{run}", validity_days=10, price=Decimal("100"))
    before = timezone.now()
    results = _run_concurrently(*[lambda: grant(student, package)] * 4)
    assert all(isinstance(r, services.GrantResult) for r in results), results
    sub = Subscription.objects.get(user=student)
    assert sub.price_paid == Decimal("400")
    assert sub.expires_at - sub.starts_at == timedelta(days=40)
    assert sub.starts_at >= before
    assert audits("subscription.grant").count() == 1
    assert audits("subscription.extend").count() == 3


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_package_deactivation_racing_grant(run):
    student = make_student()
    package = make_package(f"d{run}")
    granted, _updated = _run_concurrently(
        lambda: grant(student, package),
        lambda: services.update_package(package.pk, {"status": "inactive"}, ctx=CTX),
    )
    package.refresh_from_db()
    assert package.status == PackageStatus.INACTIVE
    if isinstance(granted, services.GrantResult):
        assert Subscription.objects.filter(package=package).count() == 1
    else:
        assert isinstance(granted, ValidationError)
        assert field_codes(granted, "package") == ["package_inactive"]
        assert not Subscription.objects.filter(package=package).exists()


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_package_delete_racing_grant(run):
    student = make_student()
    package = make_package(f"x{run}")
    granted, deleted = _run_concurrently(
        lambda: grant(student, package),
        lambda: services.delete_package(package.pk, ctx=CTX),
    )
    if isinstance(granted, services.GrantResult):
        assert isinstance(deleted, SubscriptionError) and deleted.code == "in_use"
        assert Package.objects.filter(pk=package.pk).exists()
    else:
        assert deleted is None and field_codes(granted, "package") == ["does_not_exist"]
        assert not Package.objects.filter(pk=package.pk).exists()


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_cancel_racing_access_check(run):
    subject = make_subject(f"s-c{run}", category=make_category(f"c-c{run}"))
    exam = paid_exam(subject)
    student = make_student()
    sub = grant(student, make_package(f"c{run}", rules=all_paid())).subscription
    cancelled, seen = _run_concurrently(
        lambda: services.cancel_subscription(sub.pk, ctx=CTX),
        lambda: user_can_access_exam(student, exam),
    )
    assert isinstance(cancelled, Subscription) and seen in (True, False)
    assert not user_can_access_exam(student, exam)


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_rule_replacement_racing_access_check(run):
    subject = make_subject(f"s-r{run}", category=make_category(f"c-r{run}"))
    exam = paid_exam(subject)
    student = make_student()
    package = make_package(f"r{run}", rules=all_paid())
    grant(student, package)
    replaced, seen = _run_concurrently(
        lambda: services.set_access_rules(package.pk, [], ctx=CTX),
        lambda: user_can_access_exam(student, exam),
    )
    assert isinstance(replaced, Package) and seen in (True, False)
    assert not user_can_access_exam(student, exam)  # never a half-replaced rule set


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_category_delete_racing_rule_creation(run):
    category = make_category(f"lonely-{run}")
    package = make_package(f"k{run}")
    rules = [{"rule_type": "category", "category": category.pk}]
    saved, deleted = _run_concurrently(
        lambda: services.set_access_rules(package.pk, rules, ctx=CTX),
        lambda: catalog.delete_category(category.pk, ctx=CTX),
    )
    if isinstance(saved, Package):
        assert isinstance(deleted, CatalogInUse)
        assert PackageAccessRule.objects.filter(category=category).exists()
    else:
        assert deleted is None and field_codes(saved, "rules") == ["does_not_exist"]
        assert not PackageAccessRule.objects.exists()


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_exam_delete_racing_rule_creation(run):
    subject = make_subject(f"s-e{run}", category=make_category(f"c-e{run}"))
    exam = paid_exam(subject)
    package = make_package(f"e{run}")
    rules = [{"rule_type": "exam", "exam": exam.pk}]
    saved, deleted = _run_concurrently(
        lambda: services.set_access_rules(package.pk, rules, ctx=CTX),
        lambda: exam_services.delete_exam(exam.pk, ctx=CTX),
    )
    if isinstance(saved, Package):
        assert isinstance(deleted, ExamStateError) and deleted.code == "in_use"
    else:
        assert deleted is None and field_codes(saved, "rules") == ["does_not_exist"]
        assert not PackageAccessRule.objects.exists()


def test_messages_in_bangla(api, student):
    package = make_package(status="inactive")
    response = api.post(
        GRANT,
        {"user": student.pk, "package": package.pk},
        format="json",
        **idem(),
        HTTP_ACCEPT_LANGUAGE="bn",
    )
    assert errors(response)["package"] == ["এই প্যাকেজটি নিষ্ক্রিয়, তাই দেওয়া যাবে না।"]
    active = make_package("silver")
    sub = grant(student, active).subscription
    services.cancel_subscription(sub.pk, ctx=CTX)
    response = api.post(f"{SUBSCRIPTIONS}{sub.pk}/cancel/", HTTP_ACCEPT_LANGUAGE="bn")
    assert response.json()["error"]["message"] == "এই সাবস্ক্রিপশন ইতিমধ্যে বাতিল করা হয়েছে।"
    response = api.delete(f"{PACKAGES}{active.pk}/", HTTP_ACCEPT_LANGUAGE="bn")
    assert response.json()["error"]["message"].startswith("এই প্যাকেজে সাবস্ক্রিপশন আছে")


class TestPriceTotalLimit:
    """Extensions add up ``price_paid``; the total must fit NUMERIC(12,2)."""

    MAX = Decimal("9999999999.99")

    def _near_max(self, student, below):
        package = make_package(price=Decimal("100.00"))
        sub = grant(student, package).subscription
        Subscription.objects.filter(pk=sub.pk).update(price_paid=self.MAX - below)
        sub.refresh_from_db()
        return package, sub

    def test_limit_matches_the_model_field(self):
        from apps.subscriptions.models import MAX_MONEY

        field = Subscription._meta.get_field("price_paid")
        assert (field.max_digits, field.decimal_places) == (12, 2)
        assert self.MAX == MAX_MONEY

    def test_exact_maximum_accepted(self, student):
        package, sub = self._near_max(student, Decimal("100.00"))
        result = grant(student, package)
        assert result.extended
        sub.refresh_from_db()
        assert sub.price_paid == self.MAX
        assert audits("subscription.extend").count() == 1

    def test_one_cent_above_maximum_rejected_without_changes(self, student):
        package, sub = self._near_max(student, Decimal("99.99"))
        with pytest.raises(ValidationError) as exc:
            grant(student, package)
        assert field_codes(exc.value, "price_paid") == ["price_total_too_large"]
        fresh = Subscription.objects.get(pk=sub.pk)
        assert (fresh.price_paid, fresh.expires_at, fresh.status, fresh.updated_at) == (
            sub.price_paid,
            sub.expires_at,
            sub.status,
            sub.updated_at,
        )
        assert not audits("subscription.extend").exists()

    def test_api_returns_validation_error_not_500(self, api, student):
        package, sub = self._near_max(student, Decimal("0"))
        response = api.post(
            GRANT,
            {"user": student.pk, "package": package.pk, "price_paid": "0.01"},
            format="json",
            **idem(),
        )
        assert response.status_code == 400 and code(response) == "validation_error"
        assert "price_paid" in errors(response)
        sub.refresh_from_db()
        assert sub.price_paid == self.MAX and not audits("subscription.extend").exists()
        # A free extension (0.00) still fits.
        response = api.post(
            GRANT,
            {"user": student.pk, "package": package.pk, "price_paid": "0"},
            format="json",
            **idem(),
        )
        assert response.status_code == 200
