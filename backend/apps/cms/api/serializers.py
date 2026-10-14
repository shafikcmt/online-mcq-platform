"""CMS serializers. Fields are listed explicitly; unknown fields are ignored and read-only
fields (ids, timestamps) are never written. Normalization and business validation live in
the models/services, so the Django admin and the API follow the same rules.

Public serializers resolve bilingual text to the request language with fallback to the
other language (``apps.core.i18n.resolve_bilingual``) and expose no ids, no admin metadata.
"""

import unicodedata

from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from apps.core.i18n import clean_multiline, clean_single_line, has_meaningful_text, normalize_digits
from apps.core.public_api import LocalizedSerializer

from ..models import (
    ANNOUNCEMENT_BODY_MAX_LENGTH,
    CONTACT_EMAIL_MAX_LENGTH,
    CONTACT_MESSAGE_MAX_LENGTH,
    CONTACT_NAME_MAX_LENGTH,
    CONTACT_SUBJECT_MAX_LENGTH,
    FAQ_ANSWER_MAX_LENGTH,
    FAQ_QUESTION_MAX_LENGTH,
    PAGE_BODY_MAX_LENGTH,
    PHONE_INVALID_MESSAGE,
    TITLE_MAX_LENGTH,
    URL_MAX_LENGTH,
    Announcement,
    Audience,
    ContactMessage,
    ContactStatus,
    Faq,
    LanguageChoice,
    LeaderboardNameMode,
    Page,
    SiteSettings,
    validate_phone,
)
from ..models import SLUG_MAX_LENGTH as PAGE_SLUG_MAX_LENGTH

MAX_SORT_ORDER = 2_147_483_647
CONTACT_REQUIRED_MESSAGE = _("Enter a phone number or an e-mail address so we can reply.")
TEXT_REQUIRED_MESSAGE = _("This field may not be blank.")


def _text(max_length: int, **kwargs) -> serializers.CharField:
    return serializers.CharField(
        max_length=max_length, required=False, allow_blank=True, trim_whitespace=False, **kwargs
    )


# --------------------------------------------------------------------------------------
# Admin
# --------------------------------------------------------------------------------------
class SiteSettingsAdminSerializer(serializers.ModelSerializer):
    platform_name_bn = _text(120)
    platform_name_en = _text(120)
    tagline_bn = _text(200)
    tagline_en = _text(200)
    address_bn = _text(300)
    address_en = _text(300)
    contact_email = _text(254)
    contact_phone = _text(30)
    app_download_url = _text(URL_MAX_LENGTH)
    app_open_url = _text(URL_MAX_LENGTH)
    default_language = serializers.ChoiceField(choices=LanguageChoice.choices, required=False)
    public_leaderboard_name_mode = serializers.ChoiceField(
        choices=LeaderboardNameMode.choices, required=False
    )
    app_leaderboard_name_mode = serializers.ChoiceField(
        choices=LeaderboardNameMode.choices, required=False
    )
    updated_at = serializers.DateTimeField(read_only=True, allow_null=True)

    class Meta:
        model = SiteSettings
        fields = (*SiteSettings.AUDIT_VALUE_FIELDS, "updated_at")
        validators = []


class AnnouncementAdminSerializer(serializers.ModelSerializer):
    title_bn = _text(TITLE_MAX_LENGTH)
    title_en = _text(TITLE_MAX_LENGTH)
    body_bn = _text(ANNOUNCEMENT_BODY_MAX_LENGTH)
    body_en = _text(ANNOUNCEMENT_BODY_MAX_LENGTH)
    audience = serializers.ChoiceField(choices=Audience.choices, required=False)
    is_pinned = serializers.BooleanField(required=False)
    published_at = serializers.DateTimeField(required=False, allow_null=True)
    expires_at = serializers.DateTimeField(required=False, allow_null=True)
    state = serializers.SerializerMethodField()

    class Meta:
        model = Announcement
        fields = (
            "id",
            "title_bn",
            "title_en",
            "body_bn",
            "body_en",
            "audience",
            "is_pinned",
            "published_at",
            "expires_at",
            "state",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def get_state(self, obj) -> str:
        """draft | scheduled | live | expired (computed from server time)."""
        now = timezone.now()
        if obj.published_at is None:
            return "draft"
        if obj.published_at > now:
            return "scheduled"
        if obj.expires_at is not None and obj.expires_at <= now:
            return "expired"
        return "live"


class FaqAdminSerializer(serializers.ModelSerializer):
    question_bn = _text(FAQ_QUESTION_MAX_LENGTH)
    question_en = _text(FAQ_QUESTION_MAX_LENGTH)
    answer_bn = _text(FAQ_ANSWER_MAX_LENGTH)
    answer_en = _text(FAQ_ANSWER_MAX_LENGTH)
    is_active = serializers.BooleanField(required=False)
    sort_order = serializers.IntegerField(min_value=0, max_value=MAX_SORT_ORDER, required=False)

    class Meta:
        model = Faq
        fields = (
            "id",
            "question_bn",
            "question_en",
            "answer_bn",
            "answer_en",
            "is_active",
            "sort_order",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")


class PageAdminSerializer(serializers.ModelSerializer):
    slug = serializers.CharField(max_length=PAGE_SLUG_MAX_LENGTH)
    title_bn = _text(TITLE_MAX_LENGTH)
    title_en = _text(TITLE_MAX_LENGTH)
    body_bn = _text(PAGE_BODY_MAX_LENGTH)
    body_en = _text(PAGE_BODY_MAX_LENGTH)
    is_active = serializers.BooleanField(required=False)

    class Meta:
        model = Page
        fields = (
            "id",
            "slug",
            "title_bn",
            "title_en",
            "body_bn",
            "body_en",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")
        validators = []  # slug uniqueness is checked on the normalized value


class ContactMessageAdminSerializer(serializers.ModelSerializer):
    """Inbox view: what the admin needs to reply. The sender's IP is never included."""

    handled_by = serializers.SerializerMethodField()

    class Meta:
        model = ContactMessage
        fields = (
            "id",
            "name",
            "phone",
            "email",
            "subject",
            "message",
            "language",
            "status",
            "handled_by",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields

    def get_handled_by(self, obj) -> dict | None:
        if obj.handled_by_id is None:
            return None
        return {"id": obj.handled_by_id, "full_name": obj.handled_by.full_name}


class ContactStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=ContactStatus.choices)


# --------------------------------------------------------------------------------------
# Public
# --------------------------------------------------------------------------------------
class PublicSettingsSerializer(LocalizedSerializer):
    platform_name = serializers.SerializerMethodField()
    tagline = serializers.SerializerMethodField()
    address = serializers.SerializerMethodField()
    contact_email = serializers.CharField()
    contact_phone = serializers.CharField()
    app_download_url = serializers.CharField()
    app_open_url = serializers.CharField()
    default_language = serializers.CharField()

    def get_platform_name(self, obj) -> str:
        return self.text(obj, "platform_name")

    def get_tagline(self, obj) -> str:
        return self.text(obj, "tagline")

    def get_address(self, obj) -> str:
        return self.text(obj, "address")


class PublicAppLinksSerializer(serializers.Serializer):
    app_download_url = serializers.CharField()
    app_open_url = serializers.CharField()


class PublicAnnouncementSerializer(LocalizedSerializer):
    title = serializers.SerializerMethodField()
    body = serializers.SerializerMethodField()
    is_pinned = serializers.BooleanField()
    published_at = serializers.DateTimeField()
    expires_at = serializers.DateTimeField(allow_null=True)

    def get_title(self, obj) -> str:
        return self.text(obj, "title")

    def get_body(self, obj) -> str:
        return self.text(obj, "body")


class PublicFaqSerializer(LocalizedSerializer):
    question = serializers.SerializerMethodField()
    answer = serializers.SerializerMethodField()

    def get_question(self, obj) -> str:
        return self.text(obj, "question")

    def get_answer(self, obj) -> str:
        return self.text(obj, "answer")


class PublicPageSerializer(LocalizedSerializer):
    slug = serializers.CharField()
    title = serializers.SerializerMethodField()
    body = serializers.SerializerMethodField()
    updated_at = serializers.DateTimeField()

    def get_title(self, obj) -> str:
        return self.text(obj, "title")

    def get_body(self, obj) -> str:
        return self.text(obj, "body")


class ContactFormSerializer(serializers.Serializer):
    """Website contact form. Plain text only; at least a phone number or an e-mail.
    ``website`` is a honeypot: a hidden field real visitors leave empty."""

    name = serializers.CharField(max_length=CONTACT_NAME_MAX_LENGTH, trim_whitespace=False)
    phone = serializers.CharField(
        max_length=30, required=False, allow_blank=True, trim_whitespace=False
    )
    email = serializers.EmailField(
        max_length=CONTACT_EMAIL_MAX_LENGTH, required=False, allow_blank=True
    )
    subject = serializers.CharField(max_length=CONTACT_SUBJECT_MAX_LENGTH, trim_whitespace=False)
    message = serializers.CharField(max_length=CONTACT_MESSAGE_MAX_LENGTH, trim_whitespace=False)
    website = serializers.CharField(
        max_length=500, required=False, allow_blank=True, trim_whitespace=False
    )

    @staticmethod
    def _required_line(value: str) -> str:
        text = clean_single_line(value)
        if not has_meaningful_text(text, allow_symbols=True):
            raise serializers.ValidationError(TEXT_REQUIRED_MESSAGE, code="blank")
        return text

    def validate_name(self, value):
        return self._required_line(value)

    def validate_subject(self, value):
        return self._required_line(value)

    def validate_message(self, value):
        text = clean_multiline(value)
        if not has_meaningful_text(text, allow_symbols=True):
            raise serializers.ValidationError(TEXT_REQUIRED_MESSAGE, code="blank")
        return text

    def validate_phone(self, value):
        raw = (value or "").strip()
        if any(unicodedata.category(ch)[0] == "C" for ch in raw):
            # Control/format characters are refused, not silently stripped.
            raise serializers.ValidationError(PHONE_INVALID_MESSAGE, code="invalid_phone")
        phone = clean_single_line(normalize_digits(raw))
        if not phone:
            return ""
        try:
            validate_phone(phone)
        except DjangoValidationError:
            raise serializers.ValidationError(PHONE_INVALID_MESSAGE, code="invalid_phone") from None
        return phone

    def validate_email(self, value):
        return (value or "").strip().lower()

    def validate(self, attrs):
        if not attrs.get("phone") and not attrs.get("email"):
            raise serializers.ValidationError(
                {"phone": [CONTACT_REQUIRED_MESSAGE], "email": [CONTACT_REQUIRED_MESSAGE]}
            )
        return attrs
