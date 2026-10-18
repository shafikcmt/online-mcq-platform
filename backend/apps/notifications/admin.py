"""Notifications in the internal Django admin: read-only (created by domain events only)."""

from django.contrib import admin

from .models import Notification


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("created_at", "type", "user", "read_at")
    list_filter = ("type",)
    raw_id_fields = ("user",)
    ordering = ("-created_at", "-id")

    def get_readonly_fields(self, request, obj=None):
        return [field.name for field in self.model._meta.fields]

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
