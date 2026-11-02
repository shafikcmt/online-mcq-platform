"""Read-only internal view for support/operations. Hashes are never displayed."""

from django.contrib import admin

from .models import OtpCode, VerificationToken


class ReadOnlyAdmin(admin.ModelAdmin):
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(OtpCode)
class OtpCodeAdmin(ReadOnlyAdmin):
    list_display = (
        "id",
        "mobile_number",
        "purpose",
        "created_at",
        "expires_at",
        "used_at",
        "invalidated_at",
        "failed_attempts",
    )
    list_filter = ("purpose", "language")
    search_fields = ("mobile_number",)
    exclude = ("otp_hash",)
    ordering = ("-created_at",)


@admin.register(VerificationToken)
class VerificationTokenAdmin(ReadOnlyAdmin):
    list_display = ("id", "mobile_number", "purpose", "created_at", "expires_at", "used_at")
    list_filter = ("purpose",)
    search_fields = ("mobile_number",)
    exclude = ("token_hash",)
    ordering = ("-created_at",)
