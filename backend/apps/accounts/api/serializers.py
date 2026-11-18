"""Request/response shapes for the authentication API.

Policy for request fields:
- Sensitive, server-controlled fields (``PROTECTED_FIELDS`` — role, staff flags,
  verification status, auth_version, and on PATCH /me also mobile_number/password)
  are REJECTED with 400 ``forbidden_field`` so a client learns immediately that they
  cannot be set. They could never change protected state either way.
- Any other unknown field is ignored (standard DRF behaviour).
"""

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from apps.core.phone import normalize_bd_mobile
from apps.verification.models import OtpPurpose

from ..models import User


class MobileNumberField(serializers.CharField):
    """Accepts every Bangladeshi format (incl. Bangla digits); returns +8801XXXXXXXXX."""

    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        try:
            return normalize_bd_mobile(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages) from exc


LANGUAGE_CHOICES = [code for code, _name in settings.LANGUAGES]

PROTECTED_FIELDS = ("role", "is_staff", "is_superuser", "is_mobile_verified", "auth_version")


class RejectProtectedFieldsMixin:
    """Fail validation if the request tries to set a server-controlled field."""

    protected_fields: tuple[str, ...] = PROTECTED_FIELDS

    def to_internal_value(self, data):
        if hasattr(data, "keys"):
            forbidden = sorted(set(data.keys()) & set(self.protected_fields))
            if forbidden:
                raise serializers.ValidationError(
                    {name: [_("This field cannot be set.")] for name in forbidden},
                    code="forbidden_field",
                )
        return super().to_internal_value(data)


class OtpRequestSerializer(serializers.Serializer):
    mobile_number = MobileNumberField(max_length=32)
    purpose = serializers.ChoiceField(choices=OtpPurpose.values)
    language = serializers.ChoiceField(choices=LANGUAGE_CHOICES, required=False)


class OtpVerifySerializer(serializers.Serializer):
    mobile_number = MobileNumberField(max_length=32)
    purpose = serializers.ChoiceField(choices=OtpPurpose.values)
    code = serializers.CharField(max_length=20, trim_whitespace=True)


class RegisterSerializer(RejectProtectedFieldsMixin, serializers.Serializer):
    verification_token = serializers.CharField(max_length=200)
    mobile_number = MobileNumberField(max_length=32)
    full_name = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True, max_length=128, trim_whitespace=False)
    email = serializers.EmailField(required=False, allow_blank=True, allow_null=True)
    preferred_language = serializers.ChoiceField(choices=LANGUAGE_CHOICES, required=False)


class LoginSerializer(serializers.Serializer):
    # Not validated as a Bangladeshi number on purpose: any problem → one generic error.
    mobile_number = serializers.CharField(max_length=32)
    password = serializers.CharField(max_length=128, trim_whitespace=False)


class RefreshSerializer(serializers.Serializer):
    refresh = serializers.CharField()


class PasswordResetSerializer(serializers.Serializer):
    verification_token = serializers.CharField(max_length=200)
    mobile_number = MobileNumberField(max_length=32)
    new_password = serializers.CharField(max_length=128, trim_whitespace=False)


class PasswordChangeSerializer(serializers.Serializer):
    current_password = serializers.CharField(max_length=128, trim_whitespace=False)
    new_password = serializers.CharField(max_length=128, trim_whitespace=False)


class AccountDeleteSerializer(serializers.Serializer):
    """The current password confirms that the account's owner is the one deleting it."""

    current_password = serializers.CharField(max_length=128, trim_whitespace=False)


class ProfileSerializer(serializers.ModelSerializer):
    """Student-facing account data. Never includes password, flags or auth_version."""

    display_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id",
            "mobile_number",
            "full_name",
            "email",
            "preferred_language",
            "display_name",
            "is_mobile_verified",
            "date_joined",
        )
        read_only_fields = fields

    def get_display_name(self, user) -> str:
        profile = getattr(user, "student_profile", None)
        return profile.display_name if profile else ""


class ProfileUpdateSerializer(RejectProtectedFieldsMixin, serializers.Serializer):
    protected_fields = (*PROTECTED_FIELDS, "mobile_number", "password")

    full_name = serializers.CharField(max_length=150, required=False)
    email = serializers.EmailField(required=False, allow_blank=True, allow_null=True)
    preferred_language = serializers.ChoiceField(choices=LANGUAGE_CHOICES, required=False)
    display_name = serializers.CharField(max_length=60, required=False, allow_blank=True)


class TokenPairSerializer(serializers.Serializer):
    access = serializers.CharField()
    refresh = serializers.CharField()


class AuthResponseSerializer(TokenPairSerializer):
    user = ProfileSerializer()


class OtpVerifyResponseSerializer(serializers.Serializer):
    verification_token = serializers.CharField()
    expires_at = serializers.DateTimeField()


class AcceptedSerializer(serializers.Serializer):
    detail = serializers.CharField()
