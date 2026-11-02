"""Payments in the internal Django admin: read-only (status changes only through
``payments.services`` — provider verification, never by hand)."""

from django.contrib import admin

from .models import Payment, PaymentEvent


class _ReadOnly(admin.ModelAdmin):
    def get_readonly_fields(self, request, obj=None):
        return [field.name for field in self.model._meta.fields]

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Payment)
class PaymentAdmin(_ReadOnly):
    list_display = (
        "merchant_reference",
        "user",
        "package",
        "provider",
        "amount",
        "currency",
        "status",
        "created_at",
    )
    list_filter = ("status", "provider")
    search_fields = ("merchant_reference", "provider_transaction_id")
    list_select_related = ("user", "package")
    raw_id_fields = ("user", "package", "subscription")
    ordering = ("-created_at", "-id")


@admin.register(PaymentEvent)
class PaymentEventAdmin(_ReadOnly):
    list_display = ("created_at", "payment", "event_type")
    list_filter = ("event_type",)
    raw_id_fields = ("payment",)
    ordering = ("-created_at", "-id")
