"""CMS in the internal Django admin: read-only. Content changes go through the audited
admin API (``/api/v1/admin/…``); the internal admin is for inspection only."""

from django.contrib import admin

from .models import Announcement, ContactMessage, Faq, Page, SiteSettings


class ReadOnlyAdmin(admin.ModelAdmin):
    def get_readonly_fields(self, request, obj=None):
        return [field.name for field in self.model._meta.fields]

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(SiteSettings)
class SiteSettingsAdmin(ReadOnlyAdmin):
    list_display = ("default_language", "public_leaderboard_name_mode", "updated_at")


@admin.register(Announcement)
class AnnouncementAdmin(ReadOnlyAdmin):
    list_display = ("__str__", "audience", "is_pinned", "published_at", "expires_at")
    list_filter = ("audience", "is_pinned")


@admin.register(Faq)
class FaqAdmin(ReadOnlyAdmin):
    list_display = ("__str__", "is_active", "sort_order")


@admin.register(Page)
class PageAdmin(ReadOnlyAdmin):
    list_display = ("slug", "__str__", "is_active")


@admin.register(ContactMessage)
class ContactMessageAdmin(ReadOnlyAdmin):
    list_display = ("created_at", "subject", "status", "language")
    list_filter = ("status", "language")
    exclude = ("ip_address",)
