"""Response shapes of the dashboard endpoints (read-only; documented in the API schema).
Student fields are public-safe: slugs and public UUIDs only, never internal ids."""

from rest_framework import serializers

from apps.exams.models import AccessType, ExamStatus, ExamType
from apps.payments.models import PaymentStatus
from apps.subscriptions.models import MONEY_DECIMALS, MONEY_DIGITS

M = {"max_digits": 12, "decimal_places": 2}  # results.models.TOTAL_DIGITS


class DashboardExamSerializer(serializers.Serializer):
    slug = serializers.CharField()
    title = serializers.CharField()
    exam_type = serializers.ChoiceField(choices=ExamType.choices)
    access_type = serializers.ChoiceField(choices=AccessType.choices)
    start_at = serializers.DateTimeField(allow_null=True)
    end_at = serializers.DateTimeField(allow_null=True)
    duration_minutes = serializers.IntegerField()
    has_access = serializers.BooleanField(
        help_text="Entitlement only: the exam is free or a current subscription covers it."
    )
    can_start = serializers.BooleanField(
        help_text="A new attempt may start now (access, schedule, live/retake rules)."
    )
    can_resume = serializers.BooleanField(help_text="An open attempt can be continued now.")
    attempt_state = serializers.ChoiceField(choices=["in_progress", "finished"], allow_null=True)


class DashboardExamSectionSerializer(serializers.Serializer):
    count = serializers.IntegerField()
    items = DashboardExamSerializer(many=True)


class DashboardExamsSerializer(serializers.Serializer):
    available = DashboardExamSectionSerializer()
    upcoming = DashboardExamSectionSerializer()
    practice = DashboardExamSectionSerializer()


class DashboardPackageSerializer(serializers.Serializer):
    slug = serializers.CharField()
    name = serializers.CharField()


class DashboardSubscriptionItemSerializer(serializers.Serializer):
    package = DashboardPackageSerializer()
    starts_at = serializers.DateTimeField()
    expires_at = serializers.DateTimeField()


class DashboardSubscriptionSerializer(serializers.Serializer):
    active_count = serializers.IntegerField()
    items = DashboardSubscriptionItemSerializer(many=True)


class DashboardResultExamSerializer(serializers.Serializer):
    slug = serializers.CharField()
    title = serializers.CharField()
    exam_type = serializers.ChoiceField(choices=ExamType.choices)


class DashboardResultSerializer(serializers.Serializer):
    attempt_id = serializers.UUIDField()
    exam = DashboardResultExamSerializer()
    submitted_at = serializers.DateTimeField()
    obtained_marks = serializers.DecimalField(**M)
    total_marks = serializers.DecimalField(**M)
    percentage = serializers.DecimalField(**M)
    is_passed = serializers.BooleanField(allow_null=True)
    merit_position = serializers.IntegerField(allow_null=True)


class DashboardResultsSerializer(serializers.Serializer):
    count = serializers.IntegerField()
    items = DashboardResultSerializer(many=True)


class DashboardNotificationsSerializer(serializers.Serializer):
    unread_count = serializers.IntegerField()


class StudentDashboardSerializer(serializers.Serializer):
    server_time = serializers.DateTimeField()
    exams = DashboardExamsSerializer()
    subscription = DashboardSubscriptionSerializer()
    results = DashboardResultsSerializer()
    notifications = DashboardNotificationsSerializer()


# --------------------------------------------------------------------------------------
# Admin
# --------------------------------------------------------------------------------------
class PeriodSerializer(serializers.Serializer):
    time_zone = serializers.CharField()
    today_start = serializers.DateTimeField()
    today_end = serializers.DateTimeField()
    month_start = serializers.DateTimeField()
    month_end = serializers.DateTimeField()


class UserStatsSerializer(serializers.Serializer):
    students_total = serializers.IntegerField()
    students_active = serializers.IntegerField()


ExamStatsSerializer = type(
    "ExamStatsSerializer",
    (serializers.Serializer,),
    {
        "total": serializers.IntegerField(),
        **{status: serializers.IntegerField() for status in ExamStatus.values},
        "open_now": serializers.IntegerField(),
        "upcoming": serializers.IntegerField(),
    },
)


class AttemptStatsSerializer(serializers.Serializer):
    started_today = serializers.IntegerField()
    submitted_today = serializers.IntegerField()
    in_progress = serializers.IntegerField()


class SubscriptionStatsSerializer(serializers.Serializer):
    active_now = serializers.IntegerField()
    students_with_active = serializers.IntegerField()


PaymentStatusCountsSerializer = type(
    "PaymentStatusCountsSerializer",
    (serializers.Serializer,),
    {status: serializers.IntegerField() for status in PaymentStatus.values},
)


class RevenueSerializer(serializers.Serializer):
    currency = serializers.CharField()
    amount = serializers.DecimalField(max_digits=MONEY_DIGITS + 6, decimal_places=MONEY_DECIMALS)


class PaymentStatsSerializer(serializers.Serializer):
    by_status = PaymentStatusCountsSerializer()
    success_this_month = serializers.IntegerField()
    revenue_this_month = RevenueSerializer(many=True)


class AdminDashboardSerializer(serializers.Serializer):
    server_time = serializers.DateTimeField()
    period = PeriodSerializer()
    users = UserStatsSerializer()
    exams = ExamStatsSerializer()
    attempts = AttemptStatsSerializer()
    subscriptions = SubscriptionStatsSerializer()
    payments = PaymentStatsSerializer()
