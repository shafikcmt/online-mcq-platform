"""Exam attempts in the internal Django admin: read-only (operations/support only).

Attempts are history; they change only through ``attempts.services``.
"""

from django.contrib import admin

from .models import AttemptAnswer, ExamAttempt


class AttemptAnswerInline(admin.TabularInline):
    model = AttemptAnswer
    fields = ("display_order", "question", "selected_option", "is_marked_for_review", "marks")
    readonly_fields = fields
    extra = 0
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(ExamAttempt)
class ExamAttemptAdmin(admin.ModelAdmin):
    list_display = (
        "public_id",
        "exam",
        "user",
        "attempt_no",
        "status",
        "started_at",
        "deadline_at",
    )
    list_filter = ("status", "submit_source")
    search_fields = ("public_id", "user__mobile_number")
    list_select_related = ("exam", "user")
    raw_id_fields = ("exam", "user")
    ordering = ("-started_at", "-id")
    inlines = [AttemptAnswerInline]

    def get_readonly_fields(self, request, obj=None):
        return [field.name for field in self.model._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
