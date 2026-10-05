"""Internal Django administration (operations/support only).

This is NOT the product Admin Panel (that is a separate Next.js app, Milestone 7).
Passwords are only ever shown as hashes, with a link to the password-change form.
"""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.forms import AdminUserCreationForm, UserChangeForm
from django.utils.translation import gettext_lazy as _

from .models import StudentProfile, User


class UserCreationAdminForm(AdminUserCreationForm):
    class Meta(AdminUserCreationForm.Meta):
        model = User
        fields = ("mobile_number", "full_name", "email", "role", "preferred_language")
        field_classes = {}


class UserChangeAdminForm(UserChangeForm):
    class Meta(UserChangeForm.Meta):
        model = User
        fields = "__all__"
        field_classes = {}


class StudentProfileInline(admin.StackedInline):
    model = StudentProfile
    can_delete = False
    extra = 0
    fields = ("display_name", "created_at", "updated_at")
    readonly_fields = ("created_at", "updated_at")


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    form = UserChangeAdminForm
    add_form = UserCreationAdminForm
    inlines = (StudentProfileInline,)

    list_display = ("mobile_number", "full_name", "role", "is_active", "is_staff", "date_joined")
    list_filter = (
        "role",
        "is_active",
        "is_mobile_verified",
        "is_staff",
        "is_superuser",
        "preferred_language",
    )
    search_fields = ("mobile_number", "full_name", "email")
    ordering = ("-date_joined",)
    # Verification status is set only by the OTP-backed account flow, never by hand.
    readonly_fields = ("is_mobile_verified", "last_login", "date_joined", "updated_at")

    fieldsets = (
        (None, {"fields": ("mobile_number", "is_mobile_verified", "password")}),
        (_("Personal info"), {"fields": ("full_name", "email", "preferred_language")}),
        (
            _("Role and permissions"),
            {
                "fields": (
                    "role",
                    "is_active",
                    "is_staff",
                    "is_superuser",
                    "groups",
                    "user_permissions",
                )
            },
        ),
        (_("Important dates"), {"fields": ("last_login", "date_joined", "updated_at")}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": (
                    "mobile_number",
                    "full_name",
                    "email",
                    "role",
                    "preferred_language",
                    "usable_password",
                    "password1",
                    "password2",
                ),
            },
        ),
    )

    def get_inlines(self, request, obj):
        # Like Django's own "add user" flow: create the account first, then edit details.
        # (The profile is created by save_model; an inline on the add page would duplicate it.)
        return self.inlines if obj else ()

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        obj.ensure_student_profile()


@admin.register(StudentProfile)
class StudentProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "display_name", "created_at")
    search_fields = ("user__mobile_number", "user__full_name", "display_name")
    raw_id_fields = ("user",)
    readonly_fields = ("created_at", "updated_at")
