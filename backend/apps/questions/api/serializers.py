"""Admin serializers for the question bank — they include answer data
(``is_correct``, explanations) and must never be used for students or the public.
Student-facing serializers are added with the exam engine (Milestone 4) and must list
their fields explicitly, without any answer data.
"""

from rest_framework import serializers

from apps.catalog.models import Subject

from ..models import (
    EXPLANATION_MAX_LENGTH,
    OPTION_TEXT_MAX_LENGTH,
    QUESTION_TEXT_MAX_LENGTH,
    Difficulty,
    Question,
)

MAX_OPTION_SORT_ORDER = 32_767
MAX_OPTIONS_IN_PAYLOAD = 100  # hard payload ceiling; the business rule is a setting


def _text(max_length: int):
    return serializers.CharField(
        max_length=max_length, required=False, allow_blank=True, trim_whitespace=False
    )


class OptionAdminSerializer(serializers.Serializer):
    id = serializers.IntegerField(read_only=True)
    text_bn = _text(OPTION_TEXT_MAX_LENGTH)
    text_en = _text(OPTION_TEXT_MAX_LENGTH)
    is_correct = serializers.BooleanField(required=False, default=False)
    sort_order = serializers.IntegerField(
        min_value=0, max_value=MAX_OPTION_SORT_ORDER, required=False
    )


class QuestionAdminSerializer(serializers.ModelSerializer):
    subject = serializers.PrimaryKeyRelatedField(queryset=Subject.objects.all())
    category = serializers.IntegerField(source="subject.category_id", read_only=True)
    text_bn = _text(QUESTION_TEXT_MAX_LENGTH)
    text_en = _text(QUESTION_TEXT_MAX_LENGTH)
    explanation_bn = _text(EXPLANATION_MAX_LENGTH)
    explanation_en = _text(EXPLANATION_MAX_LENGTH)
    difficulty = serializers.ChoiceField(
        choices=Difficulty.choices, allow_null=True, allow_blank=True, required=False
    )
    is_active = serializers.BooleanField(required=False)
    image = serializers.ImageField(read_only=True, use_url=True)
    options = OptionAdminSerializer(many=True, max_length=MAX_OPTIONS_IN_PAYLOAD)

    class Meta:
        model = Question
        fields = (
            "id",
            "subject",
            "category",
            "text_bn",
            "text_en",
            "explanation_bn",
            "explanation_en",
            "difficulty",
            "is_active",
            "available_languages",
            "image",
            "options",
            "created_by",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "available_languages", "created_by", "created_at", "updated_at")
        validators = []

    def validate_difficulty(self, value):
        return value or ""  # null / "" = not set
