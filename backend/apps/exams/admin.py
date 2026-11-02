"""Exams in the internal Django admin (operations only).

Read-only: exams and their question lists change only through ``exams.services`` (the
admin API), which enforces the status rules, publish validation and audit. The actions
below — publish, unpublish, archive, delete — call the same services and require the
model's change (or delete) permission.
"""

from django.contrib import admin, messages
from django.core.exceptions import ValidationError
from django.utils.translation import gettext_lazy as _

from apps.audit.services import AuditContext

from . import services
from .exceptions import ExamStateError
from .models import Exam, ExamQuestion


class ExamQuestionInline(admin.TabularInline):
    model = ExamQuestion
    fields = ("sort_order", "question", "marks")
    readonly_fields = fields
    extra = 0
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(Exam)
class ExamAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "__str__",
        "slug",
        "exam_type",
        "status",
        "content_language",
        "access_type",
        "start_at",
    )
    list_filter = ("status", "exam_type", "content_language", "access_type", "category")
    search_fields = ("title_bn", "title_en", "slug")
    list_select_related = ("category",)
    ordering = ("-created_at", "-id")
    inlines = [ExamQuestionInline]
    actions = ["publish", "unpublish", "archive"]

    def get_readonly_fields(self, request, obj=None):
        return [field.name for field in self.model._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False  # view permission still allows reading

    def has_status_permission(self, request):
        opts = self.opts
        return request.user.has_perm(f"{opts.app_label}.change_{opts.model_name}")

    def _run(self, request, queryset, service):
        ctx = AuditContext.from_request(request)
        for exam in queryset:
            try:
                service(exam.pk, ctx=ctx)
            except ExamStateError as exc:
                self.message_user(request, f"{exam}: {exc.message}", level=messages.ERROR)
            except ValidationError as exc:
                problems = "; ".join(str(m) for m in exc.messages)
                self.message_user(request, f"{exam}: {problems}", level=messages.ERROR)

    @admin.action(description=_("Publish selected exams"), permissions=["status"])
    def publish(self, request, queryset):
        self._run(request, queryset, services.publish_exam)

    @admin.action(description=_("Unpublish selected exams"), permissions=["status"])
    def unpublish(self, request, queryset):
        self._run(request, queryset, services.unpublish_exam)

    @admin.action(description=_("Archive selected exams"), permissions=["status"])
    def archive(self, request, queryset):
        self._run(request, queryset, services.archive_exam)

    def delete_model(self, request, obj):
        self._run(request, [obj], services.delete_exam)

    def delete_queryset(self, request, queryset):
        self._run(request, queryset, services.delete_exam)
