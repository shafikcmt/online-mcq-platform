"""Exam serializers.

Admin serializers expose both languages and every setting. Public serializers list
their fields explicitly and resolve text to the request language — they never touch
questions, options, answers, explanations or admin metadata.
"""

from decimal import Decimal

from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.catalog.models import SLUG_MAX_LENGTH, Category, Subject
from apps.core.public_api import LocalizedSerializer

from ..models import (
    MARKS_DECIMALS,
    MARKS_DIGITS,
    TEXT_MAX_LENGTH,
    TITLE_MAX_LENGTH,
    Exam,
)


def _text(max_length: int, multiline: bool = False):
    return serializers.CharField(
        max_length=max_length, required=False, allow_blank=True, trim_whitespace=not multiline
    )


TIMEZONE_REQUIRED_MESSAGE = _("Include a time zone (for example 2026-10-05T09:30:00Z or +06:00).")


class AwareDateTimeField(serializers.DateTimeField):
    """Schedule times must say which time zone they are in: a naive time would be
    silently read as UTC and could shift an exam by hours."""

    def enforce_timezone(self, value):
        if timezone.is_naive(value):
            raise serializers.ValidationError(TIMEZONE_REQUIRED_MESSAGE, code="naive_datetime")
        return super().enforce_timezone(value)


def _marks(**kwargs):
    return serializers.DecimalField(
        max_digits=MARKS_DIGITS, decimal_places=MARKS_DECIMALS, **kwargs
    )


class ExamAdminSerializer(serializers.ModelSerializer):
    title_bn = _text(TITLE_MAX_LENGTH)
    title_en = _text(TITLE_MAX_LENGTH)
    slug = _text(SLUG_MAX_LENGTH)
    description_bn = _text(TEXT_MAX_LENGTH, multiline=True)
    description_en = _text(TEXT_MAX_LENGTH, multiline=True)
    instructions_bn = _text(TEXT_MAX_LENGTH, multiline=True)
    instructions_en = _text(TEXT_MAX_LENGTH, multiline=True)
    category = serializers.PrimaryKeyRelatedField(queryset=Category.objects.all())
    subject = serializers.PrimaryKeyRelatedField(
        queryset=Subject.objects.all(), allow_null=True, required=False
    )
    duration_minutes = serializers.IntegerField(min_value=1, max_value=24 * 60)
    total_questions = serializers.IntegerField(min_value=1, max_value=10_000)
    default_marks = _marks(min_value=Decimal("0.01"), required=False)
    negative_marks = _marks(min_value=0, required=False)
    pass_marks = _marks(min_value=0, allow_null=True, required=False)
    max_attempts = serializers.IntegerField(
        min_value=1, max_value=1000, allow_null=True, required=False
    )
    start_at = AwareDateTimeField(allow_null=True, required=False)
    end_at = AwareDateTimeField(allow_null=True, required=False)
    question_count = serializers.SerializerMethodField()
    total_marks = serializers.SerializerMethodField()

    class Meta:
        model = Exam
        fields = (
            "id",
            "public_id",
            "slug",
            "status",
            "title_bn",
            "title_en",
            "description_bn",
            "description_en",
            "instructions_bn",
            "instructions_en",
            "content_language",
            "category",
            "subject",
            "exam_type",
            "access_type",
            "duration_minutes",
            "total_questions",
            "default_marks",
            "negative_marks",
            "pass_marks",
            "start_at",
            "end_at",
            "shuffle_questions",
            "shuffle_options",
            "allow_retake",
            "max_attempts",
            "merit_enabled",
            "merit_strategy",
            "result_visibility",
            "allow_answer_review",
            "is_featured",
            "question_count",
            "total_marks",
            "created_by",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "public_id", "status", "created_by", "created_at", "updated_at")
        validators = []  # uniqueness is checked on normalized values by the service

    def get_question_count(self, exam) -> int:
        value = getattr(exam, "question_count", None)
        return exam.exam_questions.count() if value is None else value

    def get_total_marks(self, exam) -> str:
        value = getattr(exam, "total_marks", None)
        if value is None:
            value = sum((item.effective_marks for item in exam.exam_questions.all()), 0)
        return f"{value:.2f}"


class ExamQuestionItemSerializer(serializers.Serializer):
    question = serializers.IntegerField(min_value=1)
    sort_order = serializers.IntegerField(min_value=0, max_value=2_147_483_647, required=False)
    marks = _marks(min_value=Decimal("0.01"), allow_null=True, required=False)


class ExamQuestionListSerializer(serializers.Serializer):
    questions = ExamQuestionItemSerializer(many=True, allow_empty=True, max_length=10_000)


class ExamQuestionAdminSerializer(serializers.Serializer):
    """Assignment row for admins: ids and metadata only (question content lives in the
    question bank API)."""

    question = serializers.IntegerField(source="question_id")
    sort_order = serializers.IntegerField()
    marks = _marks(allow_null=True)
    effective_marks = _marks()
    subject = serializers.IntegerField(source="question.subject_id")
    available_languages = serializers.CharField(source="question.available_languages")
    is_active = serializers.BooleanField(source="question.is_active")


# --------------------------------------------------------------------------------------
# Public (no login) — explicit fields, request language, no answer data
# --------------------------------------------------------------------------------------
class PublicRefSerializer(serializers.Serializer):
    slug = serializers.CharField()
    name = serializers.CharField()


class PublicExamSerializer(LocalizedSerializer):
    slug = serializers.CharField()
    title = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()
    instructions = serializers.SerializerMethodField()
    exam_type = serializers.CharField()
    access_type = serializers.CharField()
    content_language = serializers.CharField()
    category = serializers.SerializerMethodField()
    subject = serializers.SerializerMethodField()
    duration_minutes = serializers.IntegerField()
    total_questions = serializers.IntegerField(source="question_count")
    total_marks = _marks()
    negative_marks = _marks()
    pass_marks = _marks(allow_null=True)
    start_at = serializers.DateTimeField()
    end_at = serializers.DateTimeField()
    is_featured = serializers.BooleanField()

    def get_title(self, obj) -> str:
        return self.text(obj, "title")

    def get_description(self, obj) -> str:
        return self.text(obj, "description")

    def get_instructions(self, obj) -> str:
        return self.text(obj, "instructions")

    def _ref(self, obj):
        return None if obj is None else {"slug": obj.slug, "name": self.text(obj, "name")}

    @extend_schema_field(PublicRefSerializer)
    def get_category(self, obj):
        return self._ref(obj.category)

    @extend_schema_field(PublicRefSerializer(allow_null=True))
    def get_subject(self, obj):
        return self._ref(obj.subject)
