"""Subscription serializers.

Admin serializers read and write both languages and every setting. Student and public
serializers list their fields explicitly and resolve text to the request language —
they never expose ids of other users, access-rule rows, audit data or admin settings.
"""

from django.conf import settings
from django.utils import timezone
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.catalog.models import SLUG_MAX_LENGTH
from apps.core.i18n import normalize_language
from apps.core.phone import mask_mobile
from apps.core.public_api import LocalizedSerializer
from apps.exams.api.serializers import AwareDateTimeField

from ..models import (
    DESCRIPTION_MAX_LENGTH,
    MAX_VALIDITY_DAYS,
    MONEY_DECIMALS,
    MONEY_DIGITS,
    NAME_MAX_LENGTH,
    Currency,
    Package,
    PackageStatus,
    RuleType,
    Subscription,
    SubscriptionStatus,
)
from ..selectors import EffectiveStatus, effective_status

MAX_SORT_ORDER = 2_147_483_647
MAX_FEATURE_ITEMS_IN = 100  # bound on raw input; the model enforces the real limit


def _text(max_length: int, multiline: bool = False):
    return serializers.CharField(
        max_length=max_length, required=False, allow_blank=True, trim_whitespace=not multiline
    )


def _money(**kwargs):
    return serializers.DecimalField(
        max_digits=MONEY_DIGITS, decimal_places=MONEY_DECIMALS, min_value=0, **kwargs
    )


def _features():
    return serializers.ListField(
        child=serializers.CharField(allow_blank=True, trim_whitespace=False, max_length=1000),
        max_length=MAX_FEATURE_ITEMS_IN,
        required=False,
    )


# --------------------------------------------------------------------------------------
# Admin: packages
# --------------------------------------------------------------------------------------
class PackageAdminSerializer(serializers.ModelSerializer):
    name_bn = _text(NAME_MAX_LENGTH)
    name_en = _text(NAME_MAX_LENGTH)
    slug = _text(SLUG_MAX_LENGTH)
    description_bn = _text(DESCRIPTION_MAX_LENGTH, multiline=True)
    description_en = _text(DESCRIPTION_MAX_LENGTH, multiline=True)
    features_bn = _features()
    features_en = _features()
    price = _money()
    currency = serializers.ChoiceField(choices=Currency.choices, required=False)
    validity_days = serializers.IntegerField(min_value=1, max_value=MAX_VALIDITY_DAYS)
    status = serializers.ChoiceField(choices=PackageStatus.choices, required=False)
    sort_order = serializers.IntegerField(min_value=0, max_value=MAX_SORT_ORDER, required=False)
    is_featured = serializers.BooleanField(required=False)
    rule_count = serializers.SerializerMethodField()
    subscription_count = serializers.SerializerMethodField()

    class Meta:
        model = Package
        fields = (
            "id",
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
            "rule_count",
            "subscription_count",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")
        validators = []  # slug uniqueness is checked on the normalized value by the service

    def get_rule_count(self, obj) -> int:
        count = getattr(obj, "rule_count", None)
        return obj.access_rules.count() if count is None else count

    def get_subscription_count(self, obj) -> int:
        count = getattr(obj, "subscription_count", None)
        return obj.subscriptions.count() if count is None else count


class AccessRuleItemSerializer(serializers.Serializer):
    rule_type = serializers.ChoiceField(choices=RuleType.choices)
    category = serializers.IntegerField(min_value=1, allow_null=True, required=False)
    exam = serializers.IntegerField(min_value=1, allow_null=True, required=False)


class AccessRuleListSerializer(serializers.Serializer):
    """The COMPLETE rule list of a package (``PATCH`` replaces it)."""

    rules = AccessRuleItemSerializer(many=True, allow_empty=True)


class _CategoryRefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    slug = serializers.CharField()
    name_bn = serializers.CharField()
    name_en = serializers.CharField()


class _ExamRefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    slug = serializers.CharField()
    title_bn = serializers.CharField()
    title_en = serializers.CharField()
    access_type = serializers.CharField()
    status = serializers.CharField()


class AccessRuleAdminSerializer(serializers.Serializer):
    rule_type = serializers.CharField()
    category = _CategoryRefSerializer(allow_null=True)
    exam = _ExamRefSerializer(allow_null=True)


class AccessRuleListResponseSerializer(serializers.Serializer):
    rules = AccessRuleAdminSerializer(many=True)


# --------------------------------------------------------------------------------------
# Admin: subscriptions
# --------------------------------------------------------------------------------------
class _UserRefSerializer(serializers.Serializer):
    """The student, with the mobile number masked on the server (as in the admin Users
    API) — the raw number and the email are never sent."""

    id = serializers.IntegerField()
    full_name = serializers.CharField()
    mobile_display = serializers.SerializerMethodField(
        help_text="Masked mobile number, e.g. +88017*****678."
    )

    def get_mobile_display(self, user) -> str:
        return mask_mobile(user.mobile_number)


class _PackageRefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    slug = serializers.CharField()
    name_bn = serializers.CharField()
    name_en = serializers.CharField()


class SubscriptionAdminSerializer(serializers.ModelSerializer):
    user = _UserRefSerializer()
    package = _PackageRefSerializer()
    effective_status = serializers.SerializerMethodField()
    currency = serializers.CharField(source="package.currency")

    class Meta:
        model = Subscription
        fields = (
            "id",
            "user",
            "package",
            "status",
            "effective_status",
            "starts_at",
            "expires_at",
            "price_paid",
            "currency",
            "is_test",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields

    @extend_schema_field(serializers.ChoiceField(choices=EffectiveStatus.values))
    def get_effective_status(self, obj) -> str:
        return effective_status(obj, self.context.get("now"))


class GrantSerializer(serializers.Serializer):
    user = serializers.IntegerField(min_value=1)
    package = serializers.IntegerField(min_value=1)
    price_paid = _money(required=False, allow_null=True)
    starts_at = AwareDateTimeField(required=False, allow_null=True)


# --------------------------------------------------------------------------------------
# Student (own subscriptions) and public (packages)
# --------------------------------------------------------------------------------------
class _LocalizedPackageRefSerializer(LocalizedSerializer):
    slug = serializers.CharField()
    name = serializers.SerializerMethodField()

    def get_name(self, obj) -> str:
        return self.text(obj, "name")


class MySubscriptionSerializer(LocalizedSerializer):
    package = _LocalizedPackageRefSerializer()
    status = serializers.ChoiceField(choices=SubscriptionStatus.choices)
    effective_status = serializers.SerializerMethodField()
    starts_at = serializers.DateTimeField()
    expires_at = serializers.DateTimeField()

    @extend_schema_field(serializers.ChoiceField(choices=EffectiveStatus.values))
    def get_effective_status(self, obj) -> str:
        return effective_status(obj, self.context.get("now") or timezone.now())


class PublicPackageSerializer(LocalizedSerializer):
    slug = serializers.CharField()
    name = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()
    features = serializers.SerializerMethodField()
    price = serializers.DecimalField(max_digits=MONEY_DIGITS, decimal_places=MONEY_DECIMALS)
    currency = serializers.CharField()
    validity_days = serializers.IntegerField()
    is_featured = serializers.BooleanField()

    def get_name(self, obj) -> str:
        return self.text(obj, "name")

    def get_description(self, obj) -> str:
        return self.text(obj, "description")

    def get_features(self, obj) -> list[str]:
        """The request language's list, or the other language's when it is empty."""
        request = self.context.get("request")
        language = getattr(request, "LANGUAGE_CODE", "") if request is not None else ""
        preferred = normalize_language(language) or settings.LANGUAGE_CODE
        for code in (preferred, *(c for c, _name in settings.LANGUAGES if c != preferred)):
            features = getattr(obj, f"features_{code}", None)
            if features:
                return list(features)
        return []


class StudentPackageSubscriptionSerializer(serializers.Serializer):
    active_now = serializers.BooleanField(help_text="A subscription to it gives access now.")
    expires_at = serializers.DateTimeField(
        help_text="When the latest current or scheduled subscription to it ends."
    )


class StudentPackageSerializer(PublicPackageSerializer):
    """The public package fields plus what a logged-in student needs to buy or renew:
    the package ``id`` (``POST /payments/`` takes it) and their own current
    subscription to it (``null`` when none)."""

    id = serializers.IntegerField()
    subscription = serializers.SerializerMethodField()

    @extend_schema_field(StudentPackageSubscriptionSerializer(allow_null=True))
    def get_subscription(self, obj):
        return self.context.get("subscriptions", {}).get(obj.pk)
