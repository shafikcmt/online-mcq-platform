"""Read-only view of the audit log in the internal Django admin."""

from django.contrib import admin

from .models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("created_at", "action", "entity_type", "entity_id", "summary", "actor")
    list_filter = ("action", "entity_type")
    search_fields = ("entity_id", "summary", "action")
    list_select_related = ("actor",)
    date_hierarchy = "created_at"
    ordering = ("-created_at", "-id")

    def get_readonly_fields(self, request, obj=None):
        return [field.name for field in self.model._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False  # view permission still allows reading

    def has_delete_permission(self, request, obj=None):
        return False
