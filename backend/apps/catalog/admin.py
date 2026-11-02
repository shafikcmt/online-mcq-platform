"""Categories and subjects in the internal Django admin (operations only).

Saves and deletes go through ``catalog.services`` so they are validated, normalized and
audited exactly like Admin API changes.
"""

from django.contrib import admin, messages
from django.db.models import Count
from django.utils.translation import gettext_lazy as _

from apps.audit.services import AuditContext

from . import services
from .exceptions import CatalogInUse
from .models import Category, Subject


class CatalogAdmin(admin.ModelAdmin):
    search_fields = ("name_bn", "name_en", "slug")
    list_editable = ()
    readonly_fields = ("created_at", "updated_at")
    create_service = update_service = delete_service = None

    def save_model(self, request, obj, form, change):
        ctx = AuditContext.from_request(request)
        if change:
            data = {field: getattr(obj, field) for field in form.changed_data}
            type(self).update_service(obj.pk, data, ctx=ctx)
        else:
            type(self).create_service(obj, ctx=ctx)

    def delete_model(self, request, obj):
        try:
            type(self).delete_service(obj.pk, ctx=AuditContext.from_request(request))
        except CatalogInUse as exc:
            self.message_user(request, exc.message, level=messages.ERROR)

    def delete_queryset(self, request, queryset):
        for obj in queryset:
            self.delete_model(request, obj)


@admin.register(Category)
class CategoryAdmin(CatalogAdmin):
    list_display = ("id", "name_en", "name_bn", "slug", "is_active", "sort_order", "subjects")
    list_filter = ("is_active",)
    ordering = ("sort_order", "id")
    create_service = services.create_category
    update_service = services.update_category
    delete_service = services.delete_category

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(subject_total=Count("subjects"))

    @admin.display(description=_("subjects"), ordering="subject_total")
    def subjects(self, obj):
        return obj.subject_total


@admin.register(Subject)
class SubjectAdmin(CatalogAdmin):
    list_display = ("id", "name_en", "name_bn", "slug", "category", "is_active", "sort_order")
    list_filter = ("is_active", "category")
    list_select_related = ("category",)
    ordering = ("category__sort_order", "sort_order", "id")
    create_service = services.create_subject
    update_service = services.update_subject
    delete_service = services.delete_subject
