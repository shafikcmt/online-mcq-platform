"""Result serializers. Each lists its fields explicitly.

- ``ResultSummarySerializer``: counts, marks, percentage, pass/fail, time, merit — no
  per-question data at all.
- ``ReviewQuestionSerializer``: the only serializer with correct answers and
  explanations; used only after ``results.selectors.review_allowed``.
"""

from rest_framework import serializers

from apps.attempts.models import AttemptStatus

M = {"max_digits": 12, "decimal_places": 2}  # results.models.TOTAL_DIGITS


class ResultExamSerializer(serializers.Serializer):
    slug = serializers.CharField()
    title = serializers.CharField()
    exam_type = serializers.CharField()


class ResultSummarySerializer(serializers.Serializer):
    attempt_id = serializers.UUIDField()
    attempt_no = serializers.IntegerField()
    status = serializers.ChoiceField(choices=AttemptStatus.choices)
    exam = ResultExamSerializer()
    submitted_at = serializers.DateTimeField()
    total_questions = serializers.IntegerField()
    correct_count = serializers.IntegerField()
    wrong_count = serializers.IntegerField()
    unanswered_count = serializers.IntegerField()
    positive_marks = serializers.DecimalField(**M)
    negative_marks_total = serializers.DecimalField(**M)
    obtained_marks = serializers.DecimalField(**M)
    total_marks = serializers.DecimalField(**M)
    percentage = serializers.DecimalField(**M)
    pass_marks = serializers.DecimalField(**M, allow_null=True)
    is_passed = serializers.BooleanField(allow_null=True)
    time_used_seconds = serializers.IntegerField()
    is_merit_counted = serializers.BooleanField()
    merit_position = serializers.IntegerField(allow_null=True)
    review_available = serializers.BooleanField()


class ReviewOptionSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    text = serializers.CharField()
    text_bn = serializers.CharField(required=False)
    text_en = serializers.CharField(required=False)
    is_correct = serializers.BooleanField()


class ReviewQuestionSerializer(serializers.Serializer):
    question_id = serializers.IntegerField()
    number = serializers.IntegerField()
    text = serializers.CharField()
    text_bn = serializers.CharField(required=False)
    text_en = serializers.CharField(required=False)
    image = serializers.CharField(allow_null=True)
    options = ReviewOptionSerializer(many=True)
    selected_option_id = serializers.IntegerField(allow_null=True)
    correct_option_id = serializers.IntegerField(allow_null=True)
    is_correct = serializers.BooleanField(allow_null=True)
    marks = serializers.DecimalField(max_digits=7, decimal_places=2)
    awarded_marks = serializers.DecimalField(max_digits=7, decimal_places=2)
    is_marked_for_review = serializers.BooleanField()
    explanation = serializers.CharField(allow_blank=True)
    explanation_bn = serializers.CharField(required=False, allow_blank=True)
    explanation_en = serializers.CharField(required=False, allow_blank=True)


class PaperQuestionSerializer(serializers.Serializer):
    """One question of a past exam's paper (the archive): no student answer, only the paper."""

    question_id = serializers.IntegerField()
    number = serializers.IntegerField()
    text = serializers.CharField()
    text_bn = serializers.CharField(required=False)
    text_en = serializers.CharField(required=False)
    image = serializers.CharField(allow_null=True)
    options = ReviewOptionSerializer(many=True)
    correct_option_id = serializers.IntegerField(allow_null=True)
    marks = serializers.DecimalField(max_digits=7, decimal_places=2)
    explanation = serializers.CharField(allow_blank=True)
    explanation_bn = serializers.CharField(required=False, allow_blank=True)
    explanation_en = serializers.CharField(required=False, allow_blank=True)


class PaperSerializer(serializers.Serializer):
    slug = serializers.CharField()
    title = serializers.CharField()
    total_questions = serializers.IntegerField()
    questions = PaperQuestionSerializer(many=True)


class ReviewSerializer(serializers.Serializer):
    result = ResultSummarySerializer()
    questions = ReviewQuestionSerializer(many=True)


class LeaderboardRowSerializer(serializers.Serializer):
    position = serializers.IntegerField()
    name = serializers.CharField()
    obtained_marks = serializers.DecimalField(**M)
    total_marks = serializers.DecimalField(**M)
    percentage = serializers.DecimalField(**M)
    time_used_seconds = serializers.IntegerField()


class AppLeaderboardRowSerializer(LeaderboardRowSerializer):
    is_me = serializers.BooleanField()


class AdminResultSerializer(serializers.Serializer):
    attempt_id = serializers.UUIDField()
    attempt_no = serializers.IntegerField()
    exam_id = serializers.IntegerField()
    exam_title_bn = serializers.CharField()
    exam_title_en = serializers.CharField()
    user_id = serializers.IntegerField()
    user_full_name = serializers.CharField()
    status = serializers.CharField()
    submit_source = serializers.CharField()
    submitted_at = serializers.DateTimeField()
    correct_count = serializers.IntegerField()
    wrong_count = serializers.IntegerField()
    unanswered_count = serializers.IntegerField()
    obtained_marks = serializers.DecimalField(**M)
    total_marks = serializers.DecimalField(**M)
    percentage = serializers.DecimalField(**M)
    is_passed = serializers.BooleanField(allow_null=True)
    time_used_seconds = serializers.IntegerField()
    is_merit_counted = serializers.BooleanField()
    merit_position = serializers.IntegerField(allow_null=True)
