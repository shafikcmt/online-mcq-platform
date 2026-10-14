"""Payment serializers. Each lists its fields explicitly.

- Student: own payments only, no provider payloads, no internal ids, no events.
- Admin: adds provider ids, failure reason, sanitized verification and the event log.
"""

from rest_framework import serializers

from apps.core.i18n import resolve_bilingual

from ..models import PaymentEventType, PaymentProvider, PaymentStatus

M = {"max_digits": 12, "decimal_places": 2}


class InitiateSerializer(serializers.Serializer):
    package_id = serializers.IntegerField(min_value=1)


class PaymentPackageSerializer(serializers.Serializer):
    slug = serializers.CharField()
    name = serializers.CharField()


class PaymentSerializer(serializers.Serializer):
    """What a student sees about their own payment."""

    payment_id = serializers.UUIDField(source="public_id")
    merchant_reference = serializers.CharField()
    status = serializers.ChoiceField(choices=PaymentStatus.choices)
    provider = serializers.ChoiceField(choices=PaymentProvider.choices)
    amount = serializers.DecimalField(**M)
    currency = serializers.CharField()
    package = serializers.SerializerMethodField()
    checkout_url = serializers.SerializerMethodField()
    transaction_id = serializers.SerializerMethodField()
    verified_at = serializers.DateTimeField(allow_null=True)
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()

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


class PaymentEventSerializer(serializers.Serializer):
    event_type = serializers.ChoiceField(choices=PaymentEventType.choices)
    payload = serializers.JSONField()
    source_ip = serializers.IPAddressField(allow_null=True)
    created_at = serializers.DateTimeField()


class AdminPaymentSerializer(serializers.Serializer):
    payment_id = serializers.UUIDField(source="public_id")
    merchant_reference = serializers.CharField()
    user_id = serializers.IntegerField()
    user_full_name = serializers.CharField(source="user.full_name")
    package_id = serializers.IntegerField()
    package_slug = serializers.CharField(source="package.slug")
    subscription_id = serializers.IntegerField(allow_null=True)
    provider = serializers.ChoiceField(choices=PaymentProvider.choices)
    amount = serializers.DecimalField(**M)
    currency = serializers.CharField()
    status = serializers.ChoiceField(choices=PaymentStatus.choices)
    provider_payment_id = serializers.CharField()
    provider_transaction_id = serializers.CharField(allow_null=True)
    failure_reason = serializers.CharField()
    verified_at = serializers.DateTimeField(allow_null=True)
    last_checked_at = serializers.DateTimeField(allow_null=True)
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()


class AdminPaymentDetailSerializer(AdminPaymentSerializer):
    raw_verification = serializers.JSONField(allow_null=True)
    events = PaymentEventSerializer(many=True, source="events.all")
