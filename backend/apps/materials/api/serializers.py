"""Study material serializers. Admin: explicit fields, the pasted YouTube link becomes a stored ID.
Public: localized text, no admin metadata, never a file path."""

from django.utils import timezone
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.catalog.models import Category, Subject
from apps.core.public_api import LocalizedSerializer
from apps.exams.models import Exam

from .. import selectors
from ..models import (
    DESCRIPTION_MAX_LENGTH,
    TEACHER_MAX_LENGTH,
    TITLE_MAX_LENGTH,
    YOUTUBE_INVALID_MESSAGE,
    MaterialKind,
    StudyMaterial,
    parse_youtube_id,
)

MAX_SORT_ORDER = 2_147_483_647


def _text(max_length: int) -> serializers.CharField:
    return serializers.CharField(
        max_length=max_length, required=False, allow_blank=True, trim_whitespace=False
    )


class MaterialPdfSerializer(serializers.Serializer):
    available = serializers.BooleanField()
    name = serializers.CharField()
    size_bytes = serializers.IntegerField()


def material_pdf(item) -> dict:
    has = bool(item.pdf)
    return {
        "available": has,
        "name": item.pdf_name if has else "",
        "size_bytes": item.pdf_size if has else 0,
    }


def watch_url(youtube_id: str) -> str:
    return f"https://www.youtube.com/watch?v={youtube_id}" if youtube_id else ""


class MaterialAdminSerializer(serializers.ModelSerializer):
    kind = serializers.ChoiceField(choices=MaterialKind.choices)
    title_bn = _text(TITLE_MAX_LENGTH)
    title_en = _text(TITLE_MAX_LENGTH)
    description_bn = _text(DESCRIPTION_MAX_LENGTH)
    description_en = _text(DESCRIPTION_MAX_LENGTH)
    teacher = _text(TEACHER_MAX_LENGTH)
    sort_order = serializers.IntegerField(min_value=0, max_value=MAX_SORT_ORDER, required=False)
    category = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.all(), required=False, allow_null=True
    )
    subject = serializers.PrimaryKeyRelatedField(
        queryset=Subject.objects.all(), required=False, allow_null=True
    )
    exam = serializers.PrimaryKeyRelatedField(
        queryset=Exam.objects.all(), required=False, allow_null=True
    )
    published_at = serializers.DateTimeField(required=False, allow_null=True)
    # Write-only: "publish now" with the server's clock (like announcements).
    publish_now = serializers.BooleanField(write_only=True, required=False)
    # Write-only: the pasted link; the stored value is the 11-character ID only.
    youtube_url = serializers.CharField(
        write_only=True, required=False, allow_blank=True, max_length=300
    )
    youtube_id = serializers.CharField(read_only=True)
    watch_url = serializers.SerializerMethodField()
    state = serializers.SerializerMethodField()
    pdf = serializers.SerializerMethodField()
    category_label = serializers.SerializerMethodField()
    subject_label = serializers.SerializerMethodField()
    exam_label = serializers.SerializerMethodField()

    class Meta:
        model = StudyMaterial
        fields = (
            "id",
            "kind",
            "title_bn",
            "title_en",
            "description_bn",
            "description_en",
            "youtube_url",
            "youtube_id",
            "watch_url",
            "pdf",
            "category",
            "category_label",
            "subject",
            "subject_label",
            "exam",
            "exam_label",
            "teacher",
            "sort_order",
            "published_at",
            "publish_now",
            "state",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def validate(self, attrs):
        if attrs.pop("publish_now", False):
            attrs["published_at"] = timezone.now()
        if "youtube_url" in attrs:
            raw = attrs.pop("youtube_url")
            if raw.strip():
                video_id = parse_youtube_id(raw)
                if not video_id:
                    raise serializers.ValidationError({"youtube_url": YOUTUBE_INVALID_MESSAGE})
                attrs["youtube_id"] = video_id
            else:
                attrs["youtube_id"] = ""
        # A PDF material never keeps a video ID (and the other way round the model check applies).
        kind = attrs.get("kind", getattr(self.instance, "kind", None))
        if kind == MaterialKind.PDF:
            attrs["youtube_id"] = ""
        return attrs

    def get_watch_url(self, obj) -> str:
        return watch_url(obj.youtube_id)

    def get_state(self, obj) -> str:
        if obj.published_at is None:
            return "draft"
        return "scheduled" if obj.published_at > timezone.now() else "live"

    def get_pdf(self, obj) -> MaterialPdfSerializer:
        return material_pdf(obj)

    def get_category_label(self, obj) -> str:
        return str(obj.category) if obj.category_id else ""

    def get_subject_label(self, obj) -> str:
        return str(obj.subject) if obj.subject_id else ""

    def get_exam_label(self, obj) -> str:
        return str(obj.exam) if obj.exam_id else ""


class _RefSerializer(serializers.Serializer):
    slug = serializers.CharField()
    name = serializers.CharField()


class PublicMaterialSerializer(LocalizedSerializer):
    id = serializers.IntegerField()
    kind = serializers.CharField()
    title = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()
    teacher = serializers.CharField()
    youtube_id = serializers.CharField()
    pdf = serializers.SerializerMethodField()
    category = serializers.SerializerMethodField()
    subject = serializers.SerializerMethodField()
    exam = serializers.SerializerMethodField()
    published_at = serializers.DateTimeField()

    def get_title(self, obj) -> str:
        return self.text(obj, "title")

    def get_description(self, obj) -> str:
        return self.text(obj, "description")

    def get_pdf(self, obj) -> MaterialPdfSerializer:
        has = bool(obj.pdf)
        return {"available": has, "name": "", "size_bytes": obj.pdf_size if has else 0}

    def _ref(self, node):
        if node is None:
            return None
        name = self.text(node, "name") or node.slug
        return {"slug": node.slug, "name": name}

    @extend_schema_field(_RefSerializer(allow_null=True))
    def get_category(self, obj):
        return self._ref(obj.category)

    @extend_schema_field(_RefSerializer(allow_null=True))
    def get_subject(self, obj):
        return self._ref(obj.subject) if obj.subject and obj.subject.is_active else None

    @extend_schema_field(_RefSerializer(allow_null=True))
    def get_exam(self, obj):
        if not selectors.exam_is_public(obj.exam):
            return None
        return {"slug": obj.exam.slug, "name": self.text(obj.exam, "title") or obj.exam.slug}
