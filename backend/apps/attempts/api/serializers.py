"""Exam-room serializers (student API).

Output serializers list every field explicitly: the payload dicts built by
``attempts.selectors`` are passed through them, so anything not listed here (correct
answers, explanations, scoring fields, internal ids) can never reach a student.
"""

from django.conf import settings
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from apps.exams.api.serializers import AwareDateTimeField

from ..models import AttemptLanguage, AttemptStatus, SubmitSource

CLIENT_INFO_MAX_KEYS = 10
CLIENT_INFO_KEY_LENGTH = 40
CLIENT_INFO_VALUE_LENGTH = 100
CLIENT_INFO_INVALID_MESSAGE = _("Send client info as a few short text values.")


# --------------------------------------------------------------------------------------
# Input
# --------------------------------------------------------------------------------------
class StartSerializer(serializers.Serializer):
    client_info = serializers.DictField(required=False)

    def validate_client_info(self, value):
        if len(value) > CLIENT_INFO_MAX_KEYS:
            raise serializers.ValidationError(CLIENT_INFO_INVALID_MESSAGE)
        clean = {}
        for key, item in value.items():
            if not isinstance(item, str | int | float | bool) or isinstance(item, dict):
                raise serializers.ValidationError(CLIENT_INFO_INVALID_MESSAGE)
            text = str(item)
            if len(str(key)) > CLIENT_INFO_KEY_LENGTH or len(text) > CLIENT_INFO_VALUE_LENGTH:
                raise serializers.ValidationError(CLIENT_INFO_INVALID_MESSAGE)
            clean[str(key)] = item
        return clean


class AnswerSerializer(serializers.Serializer):
    """One answer change. Omitted fields keep their stored value; a ``null`` option
    clears the answer. ``client_saved_at`` is the device time of the change — used only
    to order retried saves, never for timing."""

    selected_option_id = serializers.IntegerField(min_value=1, allow_null=True, required=False)
    is_marked_for_review = serializers.BooleanField(required=False)
    client_saved_at = AwareDateTimeField()


class AnswerItemSerializer(AnswerSerializer):
    question_id = serializers.IntegerField(min_value=1)


def _items(**kwargs):
    return AnswerItemSerializer(many=True, max_length=settings.EXAM_MAX_QUESTIONS, **kwargs)


class AnswerBatchSerializer(serializers.Serializer):
    answers = _items(allow_empty=False)


class SubmitSerializer(serializers.Serializer):
    source = serializers.ChoiceField(
        choices=[SubmitSource.MANUAL, SubmitSource.CLIENT_TIMEOUT],
        default=SubmitSource.MANUAL,
    )
    answers = _items(required=False)


# --------------------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------------------
class AttemptSummarySerializer(serializers.Serializer):
    attempt_id = serializers.UUIDField()
    attempt_no = serializers.IntegerField()
    status = serializers.ChoiceField(choices=AttemptStatus.choices)
    server_time = serializers.DateTimeField()
    started_at = serializers.DateTimeField()
    deadline_at = serializers.DateTimeField()
    remaining_seconds = serializers.IntegerField()
    can_edit = serializers.BooleanField()
    can_submit = serializers.BooleanField()
    submitted_at = serializers.DateTimeField(allow_null=True)
    submit_source = serializers.ChoiceField(choices=SubmitSource.choices, allow_null=True)


class RoomOptionSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    text = serializers.CharField()
    text_bn = serializers.CharField(required=False)
    text_en = serializers.CharField(required=False)


class RoomQuestionSerializer(serializers.Serializer):
    question_id = serializers.IntegerField()
    number = serializers.IntegerField()
    text = serializers.CharField()
    text_bn = serializers.CharField(required=False)
    text_en = serializers.CharField(required=False)
    image = serializers.CharField(allow_null=True)
    marks = serializers.DecimalField(max_digits=7, decimal_places=2)
    options = RoomOptionSerializer(many=True)
    selected_option_id = serializers.IntegerField(allow_null=True)
    is_marked_for_review = serializers.BooleanField()


class RoomExamSerializer(serializers.Serializer):
    slug = serializers.CharField()
    title = serializers.CharField()
    instructions = serializers.CharField()
    exam_type = serializers.CharField()
    content_language = serializers.CharField()
    duration_minutes = serializers.IntegerField()
    total_questions = serializers.IntegerField()
    negative_marks = serializers.DecimalField(max_digits=7, decimal_places=2)


class AttemptRoomSerializer(AttemptSummarySerializer):
    content_language = serializers.ChoiceField(choices=AttemptLanguage.choices)
    exam = RoomExamSerializer()
    questions = RoomQuestionSerializer(many=True)


class AnswerStateSerializer(serializers.Serializer):
    question_id = serializers.IntegerField()
    status = serializers.ChoiceField(choices=["saved", "stale", "deadline_passed"])
    selected_option_id = serializers.IntegerField(allow_null=True)
    is_marked_for_review = serializers.BooleanField()


class SaveResultSerializer(serializers.Serializer):
    server_time = serializers.DateTimeField()
    deadline_at = serializers.DateTimeField()
    remaining_seconds = serializers.IntegerField()
    answers = AnswerStateSerializer(many=True)


class SubmitResultSerializer(AttemptSummarySerializer):
    answers = AnswerStateSerializer(many=True)
    result_available = serializers.BooleanField()
    result = serializers.JSONField(allow_null=True)


class HistoryExamSerializer(serializers.Serializer):
    slug = serializers.CharField()
    title = serializers.CharField()


class AttemptHistorySerializer(AttemptSummarySerializer):
    exam = HistoryExamSerializer()
