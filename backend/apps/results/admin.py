"""Results in the internal Django admin: read-only (results are never edited)."""

from django.contrib import admin

from .models import Result


@admin.register(Result)
class ResultAdmin(admin.ModelAdmin):
    list_display = (
        "attempt",
        "exam",
        "user",
        "obtained_marks",
        "percentage",
        "is_passed",
        "is_merit_counted",
        "merit_position",
    )
    list_filter = ("is_merit_counted", "is_passed")
    list_select_related = ("attempt", "exam", "user")
    raw_id_fields = ("attempt", "exam", "user")
    ordering = ("-submitted_at", "-id")

    def get_readonly_fields(self, request, obj=None):
        return [field.name for field in self.model._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
