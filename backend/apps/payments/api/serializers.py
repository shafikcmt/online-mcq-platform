"""Payment serializers. Each lists its fields explicitly.

- Student: own payments only, no provider payloads, no internal ids, no events.
- Admin (7H): allow-listed only — masked student, package names, our reason codes; the
  detail adds the provider transaction ID, an allow-listed verification summary and a
  bounded event timeline of short codes (``payments.selectors``).
"""

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.core.i18n import resolve_bilingual
from apps.core.phone import mask_mobile

from ..models import PaymentEventType, PaymentProvider, PaymentStatus
from ..selectors import event_summary, verification_summary

M = {"max_digits": 12, "decimal_places": 2}


class InitiateSerializer(serializers.Serializer):
    package_id = serializers.IntegerField(min_value=1)
    # One of the methods listed by GET /payments/methods/; empty = the default method.
    provider = serializers.CharField(max_length=20, required=False, allow_blank=True, default="")
    # A gateway ``slug`` from GET /payments/methods/ (several merchant accounts of one
    # provider can exist); it wins over ``provider``.
    gateway = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    # Where the student pays from; decides where the browser returns to afterwards.
    channel = serializers.ChoiceField(choices=["web", "app"], required=False, default="")


class PaymentMethodSerializer(serializers.Serializer):
    provider = serializers.CharField()  # the adapter (bkash, sslcommerz ...)
    gateway = serializers.CharField()  # what to send back as ``gateway``
    label = serializers.CharField()  # = name, kept for older clients
    name = serializers.CharField()
    description = serializers.CharField(allow_blank=True)
    logo_url = serializers.CharField(allow_blank=True)
    min_amount = serializers.DecimalField(**M, allow_null=True)
    max_amount = serializers.DecimalField(**M, allow_null=True)
    is_test = serializers.BooleanField()  # a sandbox gateway shown to a designated tester


class PaymentPackageSerializer(serializers.Serializer):
    slug = serializers.CharField()
    name = serializers.CharField()


class PaymentSerializer(serializers.Serializer):
    """What a student sees about their own payment."""

    payment_id = serializers.UUIDField(source="public_id")
    merchant_reference = serializers.CharField()
    status = serializers.ChoiceField(choices=PaymentStatus.choices)
    provider = serializers.ChoiceField(choices=PaymentProvider.choices)
    is_test = serializers.SerializerMethodField()
    amount = serializers.DecimalField(**M)
    currency = serializers.CharField()
    package = serializers.SerializerMethodField()
    checkout_url = serializers.SerializerMethodField()
    transaction_id = serializers.SerializerMethodField()
    verified_at = serializers.DateTimeField(allow_null=True)
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()

    def get_is_test(self, payment) -> bool:
        return payment.mode == "sandbox"

    def get_package(self, payment) -> PaymentPackageSerializer:
        request = self.context.get("request")
        language = getattr(request, "LANGUAGE_CODE", "") if request is not None else ""
        package = payment.package
        return {"slug": package.slug, "name": resolve_bilingual(package, "name", language)[0]}

    def get_checkout_url(self, payment) -> str | None:
        # Only useful while the checkout is open.
        if payment.status == PaymentStatus.PENDING and payment.checkout_url:
            return payment.checkout_url
        return None

    def get_transaction_id(self, payment) -> str | None:
        if payment.status == PaymentStatus.SUCCESS:
            return payment.provider_transaction_id
        return None


# --------------------------------------------------------------------------------------
# Admin (7H): allow-listed fields only. Never the stored provider answer
# (``raw_verification``), event payloads, source IPs, the provider session key
# (``provider_payment_id``), the checkout URL, the idempotency key or contact data.
# --------------------------------------------------------------------------------------
class _AdminUserRefSerializer(serializers.Serializer):
    """The student, with the mobile number masked on the server (as in the admin Users
    and Subscriptions APIs) — the raw number and the email are never sent."""

    id = serializers.IntegerField()
    full_name = serializers.CharField()
    mobile_display = serializers.SerializerMethodField(
        help_text="Masked mobile number, e.g. +88017*****678."
    )

    def get_mobile_display(self, user) -> str:
        return mask_mobile(user.mobile_number)


class _AdminPackageRefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    slug = serializers.CharField()
    name_bn = serializers.CharField()
    name_en = serializers.CharField()


class VerificationSummarySerializer(serializers.Serializer):
    provider_status = serializers.CharField(allow_null=True)
    risk_level = serializers.CharField(allow_null=True)
    card_brand = serializers.CharField(allow_null=True)
    validated_on = serializers.CharField(allow_null=True)


class EventSummarySerializer(serializers.Serializer):
    """Present keys only; each value is a short internal code (or a boolean)."""

    to = serializers.CharField(required=False)
    reason = serializers.CharField(required=False)
    previous_reason = serializers.CharField(required=False)
    outcome = serializers.CharField(required=False)
    source = serializers.CharField(required=False)
    kind = serializers.CharField(required=False)
    signature_valid = serializers.BooleanField(required=False)
    error = serializers.CharField(required=False)

    def get_fields(self):
        fields = super().get_fields()
        fields["from"] = serializers.CharField(required=False)  # a Python keyword
        return fields


class AdminPaymentEventSerializer(serializers.Serializer):
    event_type = serializers.ChoiceField(choices=PaymentEventType.choices)
    created_at = serializers.DateTimeField()
    summary = serializers.SerializerMethodField()

    @extend_schema_field(EventSummarySerializer)
    def get_summary(self, event) -> dict:
        return event_summary(event.payload)


class AdminPaymentSerializer(serializers.Serializer):
    payment_id = serializers.UUIDField(source="public_id")
    merchant_reference = serializers.CharField()
    user = _AdminUserRefSerializer()
    package = _AdminPackageRefSerializer()
    subscription_id = serializers.IntegerField(allow_null=True)
    provider = serializers.ChoiceField(choices=PaymentProvider.choices)
    amount = serializers.DecimalField(**M)
    currency = serializers.CharField()
    status = serializers.ChoiceField(choices=PaymentStatus.choices)
    failure_reason = serializers.CharField()
    created_at = serializers.DateTimeField()
    verified_at = serializers.DateTimeField(allow_null=True)


class AdminPaymentDetailSerializer(AdminPaymentSerializer):
    """Adds the provider transaction ID and the validity bought (detail only), an
    allow-listed summary of the provider's verification answer and the latest events."""

    provider_transaction_id = serializers.CharField(allow_null=True)
    validity_days = serializers.IntegerField(
        help_text="Days of access this payment bought (snapshot taken at checkout)."
    )
    updated_at = serializers.DateTimeField()
    last_checked_at = serializers.DateTimeField(allow_null=True)
    verification = serializers.SerializerMethodField()
    events = AdminPaymentEventSerializer(many=True, source="timeline")
    events_total = serializers.IntegerField()

    @extend_schema_field(VerificationSummarySerializer(allow_null=True))
    def get_verification(self, payment) -> dict | None:
        return verification_summary(payment.raw_verification)
