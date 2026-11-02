"""Packages, their access rules, and student subscriptions (docs/DATABASE_DESIGN.md §4.8).

- A **package** is what a student buys: bilingual name/description/features, a price
  and a validity period. ``status`` = active/inactive; an inactive package cannot be
  granted or sold any more, but subscriptions already bought keep working until they
  expire.
- **Access rules** say which paid exams a package opens: all paid exams, every exam of
  selected categories, and/or selected exams (one row per selection; mixing is allowed).
- A **subscription** gives one user one package for ``starts_at`` … ``expires_at``.
  It counts as active only while ``status = active`` AND the server time is inside
  that window (``subscriptions.selectors``), so access never depends on the expiry job.

Rules the database keeps as the last guard (services validate first): bilingual name
present, ASCII slug, price ≥ 0, validity > 0, the right FK per rule type, no duplicate
rules, ``expires_at > starts_at``, at most one ``active`` subscription per user and
package (renewals extend that row).
"""

from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import (
    MaxLengthValidator,
    MaxValueValidator,
    MinValueValidator,
    RegexValidator,
)
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.catalog.models import (
    SLUG_INVALID_MESSAGE,
    SLUG_MAX_LENGTH,
    SLUG_REGEX,
    Category,
    normalize_description,
    normalize_name,
)
from apps.core.i18n import clean_single_line, has_meaningful_text
from apps.core.models import TimeStampedModel
from apps.exams.models import Exam

NAME_MAX_LENGTH = 120
DESCRIPTION_MAX_LENGTH = 2000
FEATURE_MAX_LENGTH = 200
MAX_FEATURES = 20
MONEY_DIGITS, MONEY_DECIMALS = 12, 2
MAX_VALIDITY_DAYS = 3650  # sanity bound (10 years); keeps date arithmetic safe
# Largest amount NUMERIC(12,2) can hold: 9 999 999 999.99.
MAX_MONEY = Decimal(10) ** (MONEY_DIGITS - MONEY_DECIMALS) - Decimal(1).scaleb(-MONEY_DECIMALS)

NAME_REQUIRED_MESSAGE = _("Enter a name in Bangla or English (at least one is required).")
PACKAGE_SLUG_TAKEN_MESSAGE = _("A package with this slug already exists.")
FEATURES_INVALID_MESSAGE = _("Enter the features as a list of short text lines.")
FEATURES_TOO_MANY_MESSAGE = _("Enter at most %(max)s features.")
FEATURE_TOO_LONG_MESSAGE = _("Each feature can have at most %(max)s characters.")


class Currency(models.TextChoices):
    BDT = "BDT", _("Bangladeshi taka")


class PackageStatus(models.TextChoices):
    ACTIVE = "active", _("Active")
    INACTIVE = "inactive", _("Inactive")


class RuleType(models.TextChoices):
    ALL_PAID_EXAMS = "all_paid_exams", _("All paid exams")
    CATEGORY = "category", _("Category")
    EXAM = "exam", _("Exam")


class SubscriptionStatus(models.TextChoices):
    ACTIVE = "active", _("Active")
    EXPIRED = "expired", _("Expired")
    CANCELLED = "cancelled", _("Cancelled")


def money_field(verbose_name, **kwargs):
    return models.DecimalField(
        verbose_name, max_digits=MONEY_DIGITS, decimal_places=MONEY_DECIMALS, **kwargs
    )


def normalize_features(value) -> list:
    """A list of plain-text lines: each line NFC/trimmed/single-spaced; empty lines are
    dropped. Anything that is not a list of strings raises ``ValidationError``."""
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValidationError(FEATURES_INVALID_MESSAGE, code="invalid_features")
    lines = [clean_single_line(item) for item in value]
    lines = [line for line in lines if has_meaningful_text(line, allow_symbols=True)]
    if len(lines) > MAX_FEATURES:
        raise ValidationError(
            FEATURES_TOO_MANY_MESSAGE, code="too_many_features", params={"max": MAX_FEATURES}
        )
    if any(len(line) > FEATURE_MAX_LENGTH for line in lines):
        raise ValidationError(
            FEATURE_TOO_LONG_MESSAGE, code="feature_too_long", params={"max": FEATURE_MAX_LENGTH}
        )
    return lines


class Package(TimeStampedModel):
    name_bn = models.CharField(_("name (Bangla)"), max_length=NAME_MAX_LENGTH, blank=True)
    name_en = models.CharField(_("name (English)"), max_length=NAME_MAX_LENGTH, blank=True)
    slug = models.CharField(
        _("slug"),
        max_length=SLUG_MAX_LENGTH,
        unique=True,
        validators=[RegexValidator(SLUG_REGEX, SLUG_INVALID_MESSAGE, code="invalid_slug")],
        error_messages={"unique": PACKAGE_SLUG_TAKEN_MESSAGE},
    )
    description_bn = models.TextField(
        _("description (Bangla)"),
        blank=True,
        validators=[MaxLengthValidator(DESCRIPTION_MAX_LENGTH)],
    )
    description_en = models.TextField(
        _("description (English)"),
        blank=True,
        validators=[MaxLengthValidator(DESCRIPTION_MAX_LENGTH)],
    )
    # Short bullet lines for pricing cards, one list per language ([] = none).
    features_bn = models.JSONField(_("features (Bangla)"), default=list, blank=True)
    features_en = models.JSONField(_("features (English)"), default=list, blank=True)
    price = money_field(_("price"), validators=[MinValueValidator(0)])
    currency = models.CharField(
        _("currency"), max_length=3, choices=Currency.choices, default=Currency.BDT
    )
    validity_days = models.PositiveIntegerField(
        _("validity (days)"),
        validators=[MinValueValidator(1), MaxValueValidator(MAX_VALIDITY_DAYS)],
    )
    status = models.CharField(
        _("status"), max_length=10, choices=PackageStatus.choices, default=PackageStatus.ACTIVE
    )
    sort_order = models.PositiveIntegerField(_("sort order"), default=0)
    is_featured = models.BooleanField(_("featured"), default=False)

    # Audit allow-lists (see subscriptions.services): values that may be stored, and
    # fields recorded only by name (long text).
    AUDIT_VALUE_FIELDS = (
        "name_bn",
        "name_en",
        "slug",
        "price",
        "currency",
        "validity_days",
        "status",
        "sort_order",
        "is_featured",
    )
    AUDIT_PRESENCE_FIELDS = ("description_bn", "description_en", "features_bn", "features_en")

    class Meta:
        verbose_name = _("package")
        verbose_name_plural = _("packages")
        ordering = ("sort_order", "id")
        constraints = [
            models.CheckConstraint(
                condition=models.Q(name_bn__gt="") | models.Q(name_en__gt=""),
                name="subscriptions_package_name_required",
                violation_error_message=NAME_REQUIRED_MESSAGE,
            ),
            models.CheckConstraint(
                condition=models.Q(slug__regex=SLUG_REGEX),
                name="subscriptions_package_slug_format",
            ),
            models.CheckConstraint(
                condition=models.Q(price__gte=0), name="subscriptions_package_price_valid"
            ),
            models.CheckConstraint(
                condition=models.Q(validity_days__gte=1, validity_days__lte=MAX_VALIDITY_DAYS),
                name="subscriptions_package_validity_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(currency__in=Currency.values)
                & models.Q(status__in=PackageStatus.values),
                name="subscriptions_package_choices_valid",
            ),
        ]
        indexes = [
            models.Index(fields=["status", "sort_order"], name="subscr_package_status_idx"),
        ]

    def __str__(self) -> str:
        return self.name_en or self.name_bn or self.slug

    @property
    def is_active(self) -> bool:
        return self.status == PackageStatus.ACTIVE

    def normalize(self) -> None:
        """Text fields only. Features are normalized in ``clean_fields`` (they can be
        invalid input, which must become a validation error, not a crash in ``save``)."""
        self.name_bn = normalize_name(self.name_bn)
        self.name_en = normalize_name(self.name_en)
        self.description_bn = normalize_description(self.description_bn)
        self.description_en = normalize_description(self.description_en)

    def clean_fields(self, exclude=None):
        self.normalize()
        errors = {}
        for field in ("features_bn", "features_en"):
            try:
                setattr(self, field, normalize_features(getattr(self, field)))
            except ValidationError as exc:
                errors[field] = exc.error_list
        try:
            super().clean_fields(exclude=exclude)
        except ValidationError as exc:
            errors = {**exc.message_dict, **errors} if errors else exc.message_dict
            raise ValidationError(errors) from exc
        if errors:
            raise ValidationError(errors)

    def clean(self):
        super().clean()
        if not self.name_bn and not self.name_en:
            message = ValidationError(NAME_REQUIRED_MESSAGE, code="name_required")
            raise ValidationError({"name_bn": message, "name_en": message})

    def save(self, *args, **kwargs):
        self.normalize()
        super().save(*args, **kwargs)


class PackageAccessRule(TimeStampedModel):
    package = models.ForeignKey(
        Package, verbose_name=_("package"), on_delete=models.CASCADE, related_name="access_rules"
    )
    rule_type = models.CharField(_("rule type"), max_length=20, choices=RuleType.choices)
    # PROTECT: a category/exam a package grants cannot be deleted (→ 409 in_use); the
    # admin removes it from the package first, so the rule never silently changes.
    category = models.ForeignKey(
        Category,
        verbose_name=_("category"),
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="package_access_rules",
    )
    exam = models.ForeignKey(
        Exam,
        verbose_name=_("exam"),
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="package_access_rules",
    )

    class Meta:
        verbose_name = _("package access rule")
        verbose_name_plural = _("package access rules")
        ordering = ("id",)
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(
                        rule_type=RuleType.ALL_PAID_EXAMS,
                        category__isnull=True,
                        exam__isnull=True,
                    )
                    | models.Q(
                        rule_type=RuleType.CATEGORY, category__isnull=False, exam__isnull=True
                    )
                    | models.Q(rule_type=RuleType.EXAM, category__isnull=True, exam__isnull=False)
                ),
                name="subscriptions_rule_shape_valid",
            ),
            models.UniqueConstraint(
                fields=["package"],
                condition=models.Q(rule_type=RuleType.ALL_PAID_EXAMS),
                name="subscriptions_rule_all_paid_once",
            ),
            models.UniqueConstraint(
                fields=["package", "category"],
                condition=models.Q(rule_type=RuleType.CATEGORY),
                name="subscriptions_rule_category_once",
            ),
            models.UniqueConstraint(
                fields=["package", "exam"],
                condition=models.Q(rule_type=RuleType.EXAM),
                name="subscriptions_rule_exam_once",
            ),
        ]

    def __str__(self) -> str:
        target = self.category_id or self.exam_id or ""
        return f"package #{self.package_id} · {self.rule_type} {target}".strip()


class Subscription(TimeStampedModel):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name=_("user"),
        # Entitlement history is kept: users are deactivated, not deleted.
        on_delete=models.PROTECT,
        related_name="subscriptions",
    )
    package = models.ForeignKey(
        Package, verbose_name=_("package"), on_delete=models.PROTECT, related_name="subscriptions"
    )
    # No ``payment`` column here: renewals extend this row, so several payments may pay
    # for one subscription. Milestone 5 links them from the payment side
    # (``payments.subscription_id``, many-to-one; DATABASE_DESIGN §4.8). A subscription with
    # no payment is a manual admin grant.
    status = models.CharField(
        _("status"),
        max_length=10,
        choices=SubscriptionStatus.choices,
        default=SubscriptionStatus.ACTIVE,
        editable=False,
    )
    starts_at = models.DateTimeField(_("starts at"))
    expires_at = models.DateTimeField(_("expires at"))
    # Snapshot: the amount actually paid (sum of all periods when extended); later
    # package price changes never touch it.
    price_paid = money_field(_("price paid"), validators=[MinValueValidator(0)])

    class Meta:
        verbose_name = _("subscription")
        verbose_name_plural = _("subscriptions")
        ordering = ("-created_at", "-id")
        constraints = [
            models.CheckConstraint(
                condition=models.Q(expires_at__gt=models.F("starts_at")),
                name="subscriptions_subscription_window_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(price_paid__gte=0),
                name="subscriptions_subscription_price_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=SubscriptionStatus.values),
                name="subscriptions_subscription_status_valid",
            ),
            # Renewal extends the active row, so there is never a second one.
            models.UniqueConstraint(
                fields=["user", "package"],
                condition=models.Q(status=SubscriptionStatus.ACTIVE),
                name="subscriptions_one_active_per_package",
            ),
        ]
        indexes = [
            models.Index(
                fields=["user", "status", "expires_at"], name="subscr_user_status_exp_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"subscription #{self.pk} · user #{self.user_id} · package #{self.package_id}"


# Idempotency-Key header format for admin writes (same as attempts submit).
IDEMPOTENCY_KEY_MAX_LENGTH = 64
IDEMPOTENCY_KEY_REGEX = rf"^[A-Za-z0-9._:-]{{1,{IDEMPOTENCY_KEY_MAX_LENGTH}}}$"


class GrantRequest(models.Model):
    """One completed manual grant, keyed by the admin's ``Idempotency-Key``.

    Written in the same transaction as the grant/extension it records, so a row exists
    only for a grant that committed; a failed grant leaves nothing and the same key may
    be retried. A repeated request with the same (actor, key) replays this outcome
    instead of granting again; the same key with a different request is refused.

    The ``requested_*`` columns keep the request exactly as sent (``None`` = omitted),
    which is what a retry is compared with; ``applied_amount`` is what was actually
    added to ``price_paid``. Rows are never updated. Not exposed through any API yet.
    """

    # Scope of the key: one admin. Different admins may use the same key independently.
    # (No separate actor index: the unique (actor, key) constraint already starts with it.)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name=_("actor"),
        on_delete=models.PROTECT,
        related_name="+",
        db_index=False,
    )
    key = models.CharField(
        _("idempotency key"),
        max_length=IDEMPOTENCY_KEY_MAX_LENGTH,
        validators=[RegexValidator(IDEMPOTENCY_KEY_REGEX, code="invalid_idempotency_key")],
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name=_("user"),
        on_delete=models.PROTECT,
        related_name="+",
    )
    package = models.ForeignKey(
        Package, verbose_name=_("package"), on_delete=models.PROTECT, related_name="+"
    )
    requested_price_paid = money_field(_("requested price paid"), null=True, blank=True)
    requested_starts_at = models.DateTimeField(_("requested start"), null=True, blank=True)
    applied_amount = money_field(_("applied amount"))
    subscription = models.ForeignKey(
        Subscription,
        verbose_name=_("subscription"),
        on_delete=models.PROTECT,
        related_name="grant_requests",
    )
    extended = models.BooleanField(_("extended"))
    status_code = models.PositiveSmallIntegerField(_("original status code"))
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("grant request")
        verbose_name_plural = _("grant requests")
        ordering = ("-created_at", "-id")
        constraints = [
            models.UniqueConstraint(
                fields=["actor", "key"], name="subscriptions_grant_request_actor_key_unique"
            ),
            models.CheckConstraint(
                condition=models.Q(key__regex=IDEMPOTENCY_KEY_REGEX),
                name="subscriptions_grant_request_key_format",
            ),
            models.CheckConstraint(
                condition=models.Q(applied_amount__gte=0)
                & (
                    models.Q(requested_price_paid__isnull=True)
                    | models.Q(requested_price_paid__gte=0)
                ),
                name="subscriptions_grant_request_amounts_valid",
            ),
            # 201 = new subscription, 200 = extension — and nothing else.
            models.CheckConstraint(
                condition=models.Q(extended=False, status_code=201)
                | models.Q(extended=True, status_code=200),
                name="subscriptions_grant_request_outcome_valid",
            ),
        ]

    def __str__(self) -> str:
        return (
            f"grant request #{self.pk} · actor #{self.actor_id} "
            f"→ subscription #{self.subscription_id}"
        )
