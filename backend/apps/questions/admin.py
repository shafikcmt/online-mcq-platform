"""Question bank in the internal Django admin (operations only).

Read-only by design: a question and its options must change together, atomically and
with the "exactly one correct option" rule, which Django admin inlines cannot
guarantee. Full editing happens through the admin API (``questions.services``).
The only changes allowed here — activate, deactivate, delete — also go through the
services, so they are validated and audited like API changes.
"""

from django.contrib import admin, messages
from django.utils.translation import gettext_lazy as _

from apps.audit.services import AuditContext

from . import services
from .exceptions import QuestionInUse, QuestionLocked
from .models import Question, QuestionOption


class QuestionOptionInline(admin.TabularInline):
    model = QuestionOption
    fields = ("sort_order", "text_bn", "text_en", "is_correct")
    readonly_fields = fields
    extra = 0
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = ("id", "short_text", "subject", "difficulty", "available_languages", "is_active")
    list_filter = ("is_active", "difficulty", "available_languages", "subject__category", "subject")
    search_fields = ("text_bn", "text_en")
    list_select_related = ("subject",)
    ordering = ("-created_at", "-id")
    inlines = [QuestionOptionInline]
    actions = ["activate", "deactivate"]

    @admin.display(description=_("question"))
    def short_text(self, obj):
        text = obj.text_en or obj.text_bn
        return text[:80] + ("…" if len(text) > 80 else "")

    def get_readonly_fields(self, request, obj=None):
        return [field.name for field in self.model._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False  # view permission still allows reading

    def has_status_permission(self, request):
        # Changing is_active is a change: require the model's change permission even
        # though the change form itself is read-only.
        opts = self.opts
        return request.user.has_perm(f"{opts.app_label}.change_{opts.model_name}")

    def _set_active(self, request, queryset, value: bool):
        ctx = AuditContext.from_request(request)
        for pk in queryset.values_list("pk", flat=True):
            try:
                services.update_question(pk, {"is_active": value}, None, ctx=ctx)
            except QuestionLocked as exc:
                self.message_user(request, f"#{pk}: {exc.message}", level=messages.ERROR)

    @admin.action(description=_("Activate selected questions"), permissions=["status"])
    def activate(self, request, queryset):
        self._set_active(request, queryset, True)

    @admin.action(description=_("Deactivate selected questions"), permissions=["status"])
    def deactivate(self, request, queryset):
        self._set_active(request, queryset, False)

    def delete_model(self, request, obj):
        try:
            services.delete_question(obj.pk, ctx=AuditContext.from_request(request))
        except QuestionInUse as exc:
            self.message_user(request, exc.message, level=messages.ERROR)

    def delete_queryset(self, request, queryset):
        for obj in queryset:
            self.delete_model(request, obj)
