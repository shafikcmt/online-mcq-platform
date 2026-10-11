"""Packages, access rules and subscriptions: every write goes through here.

Every write runs in one transaction with its audit entry, and no-op updates write
nothing. Lock order (avoids deadlocks):

- package writes: package row; for access rules then categories and exams (id order);
- grants: user row → package row → the user's subscription rows for that package;
- cancel: the subscription row.

Locking the user row serializes every grant for one student, so two concurrent grants
of the same package cannot both create a row or lose an extension; the partial unique
index (one ``active`` row per user and package) is the database's last guard.

Payments (Milestone 5) will call ``grant_subscription`` from inside the payment
verification transaction; nothing here talks to a payment provider.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError, RestrictedError
from django.http import Http404
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from apps.audit import services as audit
from apps.audit.services import AuditContext
from apps.catalog.models import SLUG_MAX_LENGTH, Category
from apps.core.i18n import normalize_digits, normalize_text
from apps.core.slugs import first_free_slug, slug_base
from apps.exams.models import AccessType, Exam

from .exceptions import (
    ALREADY_CANCELLED_MESSAGE,
    PACKAGE_IN_USE_MESSAGE,
    SUBSCRIPTION_EXPIRED_MESSAGE,
    SubscriptionError,
)
from .models import (
    MAX_MONEY,
    PACKAGE_SLUG_TAKEN_MESSAGE,
    Package,
    PackageAccessRule,
    PackageStatus,
    RuleType,
    Subscription,
    SubscriptionStatus,
)
from .selectors import EffectiveStatus, effective_status

SLUG_REQUIRED_MESSAGE = _(
    "Enter a slug (English letters, digits and hyphens), or an English name to generate it."
)
TOO_MANY_RULES_MESSAGE = _("A package can have at most %(max)s access rules.")
DUPLICATE_RULE_MESSAGE = _("The same access rule is listed more than once.")
CATEGORY_MISSING_MESSAGE = _("Category #%(id)s does not exist.")
EXAM_MISSING_MESSAGE = _("Exam #%(id)s does not exist.")
EXAM_NOT_PAID_MESSAGE = _("Exam #%(id)s is free; only paid exams can be added to a package.")
RULE_SHAPE_MESSAGE = _("Choose a category only for category rules and an exam only for exam rules.")
USER_MISSING_MESSAGE = _("This user does not exist.")
USER_NOT_STUDENT_MESSAGE = _("Subscriptions can only be given to active student accounts.")
PACKAGE_MISSING_MESSAGE = _("This package does not exist.")
PACKAGE_INACTIVE_MESSAGE = _("This package is inactive and cannot be granted.")
START_IN_PAST_MESSAGE = _("The start time cannot be in the past.")
START_TOO_LATE_MESSAGE = _("The start time can be at most %(days)s days ahead.")
PRICE_NEGATIVE_MESSAGE = _("Enter a price of 0 or more.")
PRICE_TOTAL_TOO_LARGE_MESSAGE = _(
    "This extension would make the total paid for the subscription larger than %(max)s."
)
MAX_START_AHEAD_DAYS = 365
START_ON_EXTENSION_MESSAGE = _(
    "This student already has this package; it will be extended from its current expiry, "
    "so a start time cannot be set."
)

PACKAGE_FIELDS = (
    "name_bn",
    "name_en",
    "slug",
    "description_bn",
    "description_en",
    "features_bn",
    "features_en",
    "price",
    "currency",
    "validity_days",
    "status",
    "sort_order",
    "is_featured",
)


def _error(field: str, text, code: str, **params) -> ValidationError:
    return ValidationError({field: ValidationError(text, code=code, params=params or None)})


def _money(value: Decimal) -> str:
    return f"{Decimal(value):.2f}"


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat()


# --------------------------------------------------------------------------------------
# Package
# --------------------------------------------------------------------------------------
def _ensure_slug(package: Package, exclude_pk=None) -> str:
    """Fill an empty slug from the English name; returns the base it was generated
    from ("" when the admin entered it)."""
    package.slug = normalize_digits(normalize_text(package.slug or "")).lower()
    if package.slug:
        return ""
    base = slug_base(package.name_en, SLUG_MAX_LENGTH)
    if not base:
        raise _error("slug", SLUG_REQUIRED_MESSAGE, "required")
    package.slug = first_free_slug(base, _taken_slugs(base, exclude_pk))
    return base


def _taken_slugs(base: str, exclude_pk=None) -> set[str]:
    queryset = Package.objects.filter(slug__startswith=base)
    if exclude_pk:
        queryset = queryset.exclude(pk=exclude_pk)
    return set(queryset.values_list("slug", flat=True))


def _validate(package: Package, exclude_pk=None) -> str:
    # Names and other fields first (clearer errors), then the (possibly generated) slug.
    package.full_clean(exclude=["slug"], validate_unique=False, validate_constraints=False)
    generated = _ensure_slug(package, exclude_pk)
    package.full_clean(validate_constraints=False)
    return generated


def _save_package(package: Package, *, slug_from: str) -> None:
    """Save; a generated slug that lost a race is regenerated, an admin-entered one is
    reported as taken."""
    tried: set[str] = set()
    for _attempt in range(5):
        try:
            with transaction.atomic():  # savepoint: the outer transaction stays usable
                package.save()
            return
        except IntegrityError as exc:
            if "slug" not in str(exc):
                raise
            if not slug_from:
                raise _error("slug", PACKAGE_SLUG_TAKEN_MESSAGE, "slug_taken") from exc
            tried.add(package.slug)
            package.slug = first_free_slug(slug_from, _taken_slugs(slug_from, package.pk) | tried)
    raise _error("slug", PACKAGE_SLUG_TAKEN_MESSAGE, "slug_taken")


def _package_values(package: Package) -> dict:
    values = {field: getattr(package, field) for field in Package.AUDIT_VALUE_FIELDS}
    values["price"] = _money(package.price)
    return values


def _package_summary(package: Package) -> str:
    return f"{package.name_en or package.name_bn} [{package.slug}]"


RULE_AUDIT_FIELDS = ("rule_count", "all_paid_exams", "category_count", "exam_count")


def _audit_package(ctx, action: str, package_id, summary: str, metadata: dict) -> None:
    audit.record(
        ctx,
        action=action,
        entity_type="subscriptions.package",
        entity_id=package_id,
        summary=summary,
        metadata=metadata,
        allowed_fields=(
            *Package.AUDIT_VALUE_FIELDS,
            *Package.AUDIT_PRESENCE_FIELDS,
            *RULE_AUDIT_FIELDS,
        ),
    )


def _lock_package(package_id) -> Package:
    package = Package.objects.select_for_update().filter(pk=package_id).first()
    if package is None:
        raise Http404
    return package


@transaction.atomic
def create_package(package: Package, *, ctx: AuditContext) -> Package:
    slug_from = _validate(package)
    _save_package(package, slug_from=slug_from)
    _audit_package(
        ctx,
        "package.create",
        package.pk,
        _package_summary(package),
        {
            "values": _package_values(package),
            "descriptions": [f for f in Package.AUDIT_PRESENCE_FIELDS if getattr(package, f)],
        },
    )
    return package


@transaction.atomic
def update_package(package_id: int, data: dict, *, ctx: AuditContext) -> Package:
    """Price/validity changes apply to future grants only: existing subscriptions keep
    their window and price snapshot. Deactivating stops new grants, not paid access."""
    package = _lock_package(package_id)
    before = {field: getattr(package, field) for field in PACKAGE_FIELDS}
    before_values = _package_values(package)
    for field, value in data.items():
        if field in PACKAGE_FIELDS:
            setattr(package, field, value)
    slug_from = _validate(package, exclude_pk=package.pk)
    changed = [field for field in PACKAGE_FIELDS if getattr(package, field) != before[field]]
    if not changed:
        return package
    _save_package(package, slug_from=slug_from)
    after_values = _package_values(package)
    _audit_package(
        ctx,
        "package.update",
        package.pk,
        _package_summary(package),
        {
            "changed_fields": changed,
            "changes": {
                field: {"from": before_values[field], "to": after_values[field]}
                for field in changed
                if field in Package.AUDIT_VALUE_FIELDS
            },
        },
    )
    return package


@transaction.atomic
def delete_package(package_id: int, *, ctx: AuditContext) -> None:
    """Only a package nobody ever subscribed to can be deleted (its access rules go
    with it; categories and exams stay). Used packages are deactivated instead."""
    package = _lock_package(package_id)  # grants lock it too, so none can slip in
    subscription_count = package.subscriptions.count()
    if subscription_count:
        raise SubscriptionError(
            "in_use", PACKAGE_IN_USE_MESSAGE, details={"subscription_count": subscription_count}
        )
    snapshot, summary = _package_values(package), _package_summary(package)
    try:
        with transaction.atomic():
            package.delete()
    except (ProtectedError, RestrictedError) as exc:
        raise SubscriptionError("in_use", PACKAGE_IN_USE_MESSAGE) from exc
    _audit_package(ctx, "package.delete", package_id, summary, {"snapshot": snapshot})


# --------------------------------------------------------------------------------------
# Access rules (complete replacement)
# --------------------------------------------------------------------------------------
@dataclass(frozen=True)
class RuleCounts:
    rule_count: int
    all_paid_exams: bool
    category_count: int
    exam_count: int

    @classmethod
    def of(cls, rules) -> "RuleCounts":
        types = [rule.rule_type for rule in rules]
        return cls(
            len(types),
            RuleType.ALL_PAID_EXAMS in types,
            types.count(RuleType.CATEGORY),
            types.count(RuleType.EXAM),
        )

    def values(self) -> dict:
        return dict(self.__dict__)


def _rule_key(rule_type: str, category_id, exam_id) -> tuple:
    return (rule_type, category_id or None, exam_id or None)


def _validated_keys(items: list[dict]) -> list[tuple]:
    maximum = settings.PACKAGE_MAX_ACCESS_RULES
    if len(items) > maximum:
        raise _error("rules", TOO_MANY_RULES_MESSAGE, "too_many_rules", max=maximum)
    keys: list[tuple] = []
    for item in items:
        rule_type = item["rule_type"]
        category_id, exam_id = item.get("category"), item.get("exam")
        valid_shape = {
            RuleType.ALL_PAID_EXAMS: category_id is None and exam_id is None,
            RuleType.CATEGORY: category_id is not None and exam_id is None,
            RuleType.EXAM: exam_id is not None and category_id is None,
        }.get(rule_type, False)
        if not valid_shape:
            raise _error("rules", RULE_SHAPE_MESSAGE, "invalid_rule")
        key = _rule_key(rule_type, category_id, exam_id)
        if key in keys:
            raise _error("rules", DUPLICATE_RULE_MESSAGE, "duplicate_rule")
        keys.append(key)
    return keys


def _lock_targets(keys: list[tuple]) -> None:
    """Lock the referenced categories and exams (id order), so a concurrent delete
    either finished first (→ "does not exist") or waits and then sees the rule (→ 409)."""
    category_ids = sorted({k[1] for k in keys if k[0] == RuleType.CATEGORY})
    exam_ids = sorted({k[2] for k in keys if k[0] == RuleType.EXAM})
    found = set(
        Category.objects.select_for_update(no_key=True)
        .filter(pk__in=category_ids)
        .order_by("pk")
        .values_list("pk", flat=True)
    )
    for category_id in category_ids:
        if category_id not in found:
            raise _error("rules", CATEGORY_MISSING_MESSAGE, "does_not_exist", id=category_id)
    exams = {
        pk: access
        for pk, access in Exam.objects.select_for_update(no_key=True)
        .filter(pk__in=exam_ids)
        .order_by("pk")
        .values_list("pk", "access_type")
    }
    for exam_id in exam_ids:
        if exam_id not in exams:
            raise _error("rules", EXAM_MISSING_MESSAGE, "does_not_exist", id=exam_id)
        if exams[exam_id] != AccessType.PAID:
            raise _error("rules", EXAM_NOT_PAID_MESSAGE, "exam_not_paid", id=exam_id)


@transaction.atomic
def set_access_rules(package_id: int, items: list[dict], *, ctx: AuditContext) -> Package:
    """Replace the package's rules with ``items`` (``{rule_type, category?, exam?}``),
    atomically. The same set of rules (in any order) is a no-op."""
    package = _lock_package(package_id)
    keys = _validated_keys(items)
    current = list(package.access_rules.all())
    if {_rule_key(r.rule_type, r.category_id, r.exam_id) for r in current} == set(keys):
        return package
    _lock_targets(keys)
    before = RuleCounts.of(current)
    package.access_rules.all().delete()
    rules = PackageAccessRule.objects.bulk_create(
        PackageAccessRule(package=package, rule_type=t, category_id=c, exam_id=e)
        for t, c, e in keys
    )
    after = RuleCounts.of(rules)
    _audit_package(
        ctx,
        "package.access_rules_update",
        package.pk,
        _package_summary(package),
        {
            "values": after.values(),
            "changes": {
                field: {"from": getattr(before, field), "to": getattr(after, field)}
                for field in RULE_AUDIT_FIELDS
                if getattr(before, field) != getattr(after, field)
            },
        },
    )
    return package


# --------------------------------------------------------------------------------------
# Subscriptions
# --------------------------------------------------------------------------------------
SUBSCRIPTION_AUDIT_FIELDS = (
    "user_id",
    "package_id",
    "status",
    "price_paid",
    "currency",
    "validity_days",
    "starts_at",
    "expires_at",
)


def _subscription_values(subscription: Subscription) -> dict:
    return {
        "user_id": subscription.user_id,
        "package_id": subscription.package_id,
        "status": subscription.status,
        "price_paid": _money(subscription.price_paid),
        "starts_at": _iso(subscription.starts_at),
        "expires_at": _iso(subscription.expires_at),
    }


def _audit_subscription(ctx, action: str, subscription: Subscription, metadata: dict) -> None:
    audit.record(
        ctx,
        action=action,
        entity_type="subscriptions.subscription",
        entity_id=subscription.pk,
        summary=(
            f"subscription #{subscription.pk} · user #{subscription.user_id} · "
            f"package #{subscription.package_id}"
        ),
        metadata=metadata,
        allowed_fields=SUBSCRIPTION_AUDIT_FIELDS,
    )


def _lock_student(user_id):
    user = get_user_model().objects.select_for_update(no_key=True).filter(pk=user_id).first()
    if user is None:
        raise _error("user", USER_MISSING_MESSAGE, "does_not_exist")
    if not (user.is_active and user.is_student):
        raise _error("user", USER_NOT_STUDENT_MESSAGE, "not_student")
    return user


def _lock_grantable_package(package_id) -> Package:
    # NO KEY UPDATE conflicts with the FOR UPDATE taken by package update/delete, so a
    # concurrent deactivation or delete is either seen here or waits for this grant.
    package = Package.objects.select_for_update(no_key=True).filter(pk=package_id).first()
    if package is None:
        raise _error("package", PACKAGE_MISSING_MESSAGE, "does_not_exist")
    if package.status != PackageStatus.ACTIVE:
        raise _error("package", PACKAGE_INACTIVE_MESSAGE, "package_inactive")
    return package


@dataclass(frozen=True)
class GrantResult:
    subscription: Subscription
    extended: bool


@transaction.atomic
def grant_subscription(
    user_id: int,
    package_id: int,
    *,
    ctx: AuditContext,
    price_paid: Decimal | None = None,
    starts_at: datetime | None = None,
) -> GrantResult:
    """Give a student a package (manual/admin grant now; verified payments in M5).

    - Same package still running (active or scheduled): that subscription is
      **extended** — new expiry = max(current expiry, now) + validity — and the price
      is added to its ``price_paid``. ``starts_at`` cannot be set then.
    - Otherwise a new subscription starts at ``starts_at`` (default now; never in the
      past) and expires ``validity_days`` later. Other packages are untouched
      (parallel subscriptions).

    ``price_paid`` defaults to the package's current price and is stored as a snapshot.
    """
    user = _lock_student(user_id)
    package = _lock_grantable_package(package_id)
    now = timezone.now()  # after the locks: a grant that waited must not use a stale clock
    amount = package.price if price_paid is None else Decimal(price_paid)
    if amount < 0:
        raise _error("price_paid", PRICE_NEGATIVE_MESSAGE, "min_value")
    validity = timedelta(days=package.validity_days)

    rows = list(
        Subscription.objects.select_for_update()
        .filter(user_id=user.pk, package_id=package.pk, status=SubscriptionStatus.ACTIVE)
        .order_by("pk")
    )
    running = [s for s in rows if s.expires_at > now]
    stale = [s.pk for s in rows if s.expires_at <= now]
    if stale:
        # Ran out but the expiry job has not marked it yet: record it as expired so the
        # new period gets its own row (same change the job makes; not audited).
        Subscription.objects.filter(pk__in=stale).update(
            status=SubscriptionStatus.EXPIRED, updated_at=now
        )

    if running:
        if starts_at is not None:
            raise _error("starts_at", START_ON_EXTENSION_MESSAGE, "extension_start_not_allowed")
        subscription = running[0]
        total = subscription.price_paid + amount  # Decimal + Decimal: exact
        if total > MAX_MONEY:
            # Checked before anything changes: the row and the audit log stay untouched
            # (instead of a database overflow → 500).
            raise _error(
                "price_paid", PRICE_TOTAL_TOO_LARGE_MESSAGE, "price_total_too_large", max=MAX_MONEY
            )
        before = _subscription_values(subscription)
        subscription.expires_at = max(subscription.expires_at, now) + validity
        subscription.price_paid = total
        subscription.save(update_fields=["expires_at", "price_paid", "updated_at"])
        after = _subscription_values(subscription)
        _audit_subscription(
            ctx,
            "subscription.extend",
            subscription,
            {
                "values": {
                    "user_id": user.pk,
                    "package_id": package.pk,
                    "currency": package.currency,
                    "validity_days": package.validity_days,
                },
                "changes": {
                    field: {"from": before[field], "to": after[field]}
                    for field in ("expires_at", "price_paid")
                },
            },
        )
        return GrantResult(subscription, extended=True)

    if starts_at is None:
        starts_at = now
    elif starts_at < now:
        raise _error("starts_at", START_IN_PAST_MESSAGE, "start_in_past")
    elif starts_at > now + timedelta(days=MAX_START_AHEAD_DAYS):
        raise _error(
            "starts_at", START_TOO_LATE_MESSAGE, "start_too_late", days=MAX_START_AHEAD_DAYS
        )
    subscription = Subscription(
        user=user,
        package=package,
        starts_at=starts_at,
        expires_at=starts_at + validity,
        price_paid=amount,
    )
    subscription.full_clean(validate_constraints=False)
    subscription.save()
    _audit_subscription(
        ctx,
        "subscription.grant",
        subscription,
        {
            "values": {
                **_subscription_values(subscription),
                "currency": package.currency,
                "validity_days": package.validity_days,
            }
        },
    )
    return GrantResult(subscription, extended=False)


@transaction.atomic
def cancel_subscription(subscription_id: int, *, ctx: AuditContext) -> Subscription:
    """Cancel immediately: access ends at once (refunds are out of scope). Only a
    running (active or scheduled) subscription can be cancelled; cancelled and expired
    ones never become active again."""
    subscription = Subscription.objects.select_for_update().filter(pk=subscription_id).first()
    if subscription is None:
        raise Http404
    state = effective_status(subscription)
    if state == EffectiveStatus.CANCELLED:
        raise SubscriptionError("already_cancelled", ALREADY_CANCELLED_MESSAGE)
    if state == EffectiveStatus.EXPIRED:
        raise SubscriptionError("subscription_expired", SUBSCRIPTION_EXPIRED_MESSAGE)
    subscription.status = SubscriptionStatus.CANCELLED
    subscription.save(update_fields=["status", "updated_at"])
    _audit_subscription(
        ctx,
        "subscription.cancel",
        subscription,
        {
            "values": {"user_id": subscription.user_id, "package_id": subscription.package_id},
            "changes": {
                "status": {"from": SubscriptionStatus.ACTIVE, "to": SubscriptionStatus.CANCELLED}
            },
        },
    )
    return subscription
