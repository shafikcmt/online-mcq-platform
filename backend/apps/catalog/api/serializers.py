"""Admin serializers: both languages are read and written (docs/API_PLAN.md §1.2).

Read-only fields (``id``, timestamps, counts) are ignored if sent. Text normalization
and business validation happen in the model/service layer, so the Django admin and the
API follow exactly the same rules.
"""

from rest_framework import serializers

from ..models import NAME_MAX_LENGTH, SLUG_MAX_LENGTH, Category, ExamGroup, Subject

MAX_SORT_ORDER = 2_147_483_647


class CatalogEntrySerializer(serializers.ModelSerializer):
    # Declared explicitly: no automatic unique validators on raw (un-normalized) input.
    name_bn = serializers.CharField(max_length=NAME_MAX_LENGTH, required=False, allow_blank=True)
    name_en = serializers.CharField(max_length=NAME_MAX_LENGTH, required=False, allow_blank=True)
    slug = serializers.CharField(max_length=SLUG_MAX_LENGTH, required=False, allow_blank=True)
    description_bn = serializers.CharField(
        max_length=2000, required=False, allow_blank=True, trim_whitespace=False
    )
    description_en = serializers.CharField(
        max_length=2000, required=False, allow_blank=True, trim_whitespace=False
    )
    sort_order = serializers.IntegerField(min_value=0, max_value=MAX_SORT_ORDER, required=False)
    is_active = serializers.BooleanField(required=False)

    COMMON_FIELDS = (
        "id",
        "name_bn",
        "name_en",
        "slug",
        "description_bn",
        "description_en",
        "is_active",
        "sort_order",
        "created_at",
        "updated_at",
    )


class CategoryAdminSerializer(CatalogEntrySerializer):
    subject_count = serializers.SerializerMethodField()

    class Meta:
        model = Category
        fields = (*CatalogEntrySerializer.COMMON_FIELDS, "subject_count")
        read_only_fields = ("id", "created_at", "updated_at")
        validators = []  # uniqueness is checked on normalized values by the service

    def get_subject_count(self, obj) -> int:
        count = getattr(obj, "subject_count", None)
        return obj.subjects.count() if count is None else count


class SubjectAdminSerializer(CatalogEntrySerializer):
    category = serializers.PrimaryKeyRelatedField(queryset=Category.objects.all())

    class Meta:
        model = Subject
        fields = ("id", "category", *CatalogEntrySerializer.COMMON_FIELDS[1:])
        read_only_fields = ("id", "created_at", "updated_at")
        validators = []  # (category, slug) uniqueness is checked by the service


class GroupAdminSerializer(CatalogEntrySerializer):
    category = serializers.PrimaryKeyRelatedField(queryset=Category.objects.all())
    parent = serializers.PrimaryKeyRelatedField(
        queryset=ExamGroup.objects.all(), allow_null=True, required=False
    )
    exam_count = serializers.SerializerMethodField()
    child_count = serializers.SerializerMethodField()

    class Meta:
        model = ExamGroup
        fields = (
            "id",
            "category",
            "parent",
            *CatalogEntrySerializer.COMMON_FIELDS[1:],
            "exam_count",
            "child_count",
        )
        read_only_fields = ("id", "created_at", "updated_at")
        validators = []

    def get_exam_count(self, obj) -> int:
        count = getattr(obj, "exam_total", None)
        return obj.exams.count() if count is None else count

    def get_child_count(self, obj) -> int:
        count = getattr(obj, "child_total", None)
        return obj.children.count() if count is None else count
