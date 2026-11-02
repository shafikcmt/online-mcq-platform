"""Packages and subscriptions in the internal Django admin (read-only, operations only).

Every change goes through ``subscriptions.services`` (the admin API), which validates,
locks and audits; this admin only lets operators look things up.
"""

from django.contrib import admin

from .models import Package, PackageAccessRule, Subscription


class _ReadOnlyAdmin(admin.ModelAdmin):
    def get_readonly_fields(self, request, obj=None):
        return [field.name for field in self.model._meta.fields]

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False  # view permission still allows reading

    def has_delete_permission(self, request, obj=None):
        return False


class PackageAccessRuleInline(admin.TabularInline):
    model = PackageAccessRule
    fields = ("rule_type", "category", "exam")
    readonly_fields = fields
    extra = 0
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(Package)
class PackageAdmin(_ReadOnlyAdmin):
    list_display = ("id", "__str__", "slug", "price", "currency", "validity_days", "status")
    list_filter = ("status", "is_featured")
    search_fields = ("name_bn", "name_en", "slug")
    ordering = ("sort_order", "id")
    inlines = [PackageAccessRuleInline]


@admin.register(Subscription)
class SubscriptionAdmin(_ReadOnlyAdmin):
    list_display = ("id", "user", "package", "status", "starts_at", "expires_at", "price_paid")
    list_filter = ("status", "package")
    search_fields = ("user__mobile_number", "user__full_name")
    list_select_related = ("user", "package")
    raw_id_fields = ("user",)
    ordering = ("-created_at", "-id")
