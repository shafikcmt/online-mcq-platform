"""Read-only dashboard aggregation (Milestone 6C). No models, no writes.

Every number comes from the owning module's own rule (docs/MODULES.md rule 2):
- exams students may see → ``exams.selectors.listable_exams`` + ``open_window``
  (the window the exam engine enforces on start);
- access → ``subscriptions.selectors.active_window`` / ``active_grants``;
- may start / resume → ``attempts.selectors.start_options`` (the exam engine's own start
  rules: resume an open attempt, schedule window, live single attempt, retake limits);
- results → ``results.selectors.own_results`` + ``visible_results_filter``;
- open attempts → ``attempts.selectors.grace`` (past deadline + grace = no longer open).

Counts are SQL aggregates and lists are bounded (``DASHBOARD_LIST_SIZE``): the number of
queries does not grow with the data. "Today" / "this month" are calendar periods in
``DASHBOARD_TIME_ZONE`` (Asia/Dhaka — the platform's display time zone), returned as UTC
instants so clients can see exactly what was counted.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db.models import Count, F, Max, Q, Sum

from apps.accounts.models import Role, User
from apps.attempts.models import FINISHED_STATUSES, AttemptStatus, ExamAttempt
from apps.attempts.selectors import grace, start_options
from apps.core.i18n import resolve_bilingual
from apps.exams.models import Exam, ExamStatus, ExamType
from apps.exams.selectors import listable_exams, open_window
from apps.notifications.models import Notification
from apps.payments.models import Payment, PaymentStatus
from apps.results.selectors import own_results, visible_results_filter
from apps.subscriptions.models import Subscription
from apps.subscriptions.selectors import active_grants, active_window


# --------------------------------------------------------------------------------------
# Reporting periods
# --------------------------------------------------------------------------------------
@dataclass(frozen=True)
class Periods:
    time_zone: str
    today_start: datetime
    today_end: datetime
    month_start: datetime
    month_end: datetime


def periods(now: datetime) -> Periods:
    """Today and this calendar month in the reporting time zone, as UTC instants
    (``[start, end)``). DST-safe: boundaries are local midnights converted back."""
    zone = ZoneInfo(settings.DASHBOARD_TIME_ZONE)
    local = now.astimezone(zone)
    day = local.replace(hour=0, minute=0, second=0, microsecond=0)
    next_day = (day + timedelta(days=1)).replace(hour=0)
    month = day.replace(day=1)
    next_month = (month + timedelta(days=32)).replace(day=1)
    utc = ZoneInfo("UTC")
    return Periods(
        time_zone=settings.DASHBOARD_TIME_ZONE,
        today_start=day.astimezone(utc),
        today_end=next_day.astimezone(utc),
        month_start=month.astimezone(utc),
        month_end=next_month.astimezone(utc),
    )


def _between(field: str, start: datetime, end: datetime) -> Q:
    return Q(**{f"{field}__gte": start, f"{field}__lt": end})


# --------------------------------------------------------------------------------------
# Student dashboard (the caller's own data + exams any student may see)
# --------------------------------------------------------------------------------------
def _student_exam_sections(now: datetime):
    """``(filter, ordering)`` per section. Practice exams have their own section, so
    "available" is regular + live exams open right now."""
    is_open = open_window(now)
    return {
        "available": (
            is_open & ~Q(exam_type=ExamType.PRACTICE),
            (F("end_at").asc(nulls_last=True), F("start_at").asc(nulls_first=True), "id"),
        ),
        "upcoming": (Q(start_at__gt=now), ("start_at", "id")),
        "practice": (is_open & Q(exam_type=ExamType.PRACTICE), ("-is_featured", "id")),
    }


# Only what an item needs (no descriptions/instructions loaded for the home screen).
EXAM_ITEM_FIELDS = (
    "id",
    "slug",
    "title_bn",
    "title_en",
    "exam_type",
    "access_type",
    "allow_retake",
    "max_attempts",
    "category_id",
    "start_at",
    "end_at",
    "duration_minutes",
)


def _exam_item(exam: Exam, now: datetime, language: str, grants, history: dict) -> dict:
    attempts, finished, open_deadline = history.get(exam.pk, (0, 0, None))
    has_access = bool(grants and grants.covers(exam))
    can_start, can_resume = start_options(
        exam, now, entitled=has_access, attempts=attempts, open_deadline=open_deadline
    )
    if can_resume:
        state = "in_progress"
    elif finished or open_deadline is not None:  # an overdue open attempt counts as done
        state = "finished"
    else:
        state = None
    return {
        "slug": exam.slug,
        "title": resolve_bilingual(exam, "title", language)[0],
        "exam_type": exam.exam_type,
        "access_type": exam.access_type,
        "start_at": exam.start_at,
        "end_at": exam.end_at,
        "duration_minutes": exam.duration_minutes,
        "has_access": has_access,
        "can_start": can_start,
        "can_resume": can_resume,
        "attempt_state": state,
    }


def _attempt_history(user, exam_ids) -> dict[int, tuple[int, int, datetime | None]]:
    """Per listed exam, the student's ``(attempts, finished, open attempt deadline)`` —
    one grouped query, at most one row per listed exam."""
    rows = (
        ExamAttempt.objects.filter(user_id=user.pk, exam_id__in=exam_ids)
        .order_by()
        .values("exam_id")
        .annotate(
            attempts=Count("id"),
            finished=Count("id", filter=Q(status__in=FINISHED_STATUSES)),
            open_deadline=Max("deadline_at", filter=Q(status=AttemptStatus.IN_PROGRESS)),
        )
    )
    return {r["exam_id"]: (r["attempts"], r["finished"], r["open_deadline"]) for r in rows}


def student_dashboard(user, now: datetime, language: str) -> dict:
    limit = settings.DASHBOARD_LIST_SIZE
    sections = _student_exam_sections(now)
    exams = listable_exams()
    counts = exams.aggregate(
        **{name: Count("id", filter=condition) for name, (condition, _o) in sections.items()}
    )
    columns = exams.select_related(None).only(*EXAM_ITEM_FIELDS)
    lists = {
        name: list(columns.filter(condition).order_by(*ordering)[:limit])
        for name, (condition, ordering) in sections.items()
    }
    grants = active_grants(user, at=now)
    listed_ids = {exam.pk for rows in lists.values() for exam in rows}
    history = _attempt_history(user, listed_ids) if listed_ids else {}

    active = Subscription.objects.filter(active_window(now), user_id=user.pk)
    subscriptions = list(active.select_related("package").order_by("expires_at", "id")[:limit])

    visible = own_results(user).filter(visible_results_filter(now))
    recent = list(visible.order_by("-submitted_at", "-id")[:limit])

    return {
        "server_time": now,
        "exams": {
            name: {
                "count": counts[name],
                "items": [_exam_item(e, now, language, grants, history) for e in lists[name]],
            }
            for name in sections
        },
        "subscription": {
            "active_count": active.count(),
            "items": [
                {
                    "package": {
                        "slug": s.package.slug,
                        "name": resolve_bilingual(s.package, "name", language)[0],
                    },
                    "starts_at": s.starts_at,
                    "expires_at": s.expires_at,
                }
                for s in subscriptions
            ],
        },
        "results": {
            "count": visible.count(),
            "items": [
                {
                    "attempt_id": r.attempt.public_id,
                    "exam": {
                        "slug": r.exam.slug,
                        "title": resolve_bilingual(r.exam, "title", language)[0],
                        "exam_type": r.exam.exam_type,
                    },
                    "submitted_at": r.submitted_at,
                    "obtained_marks": r.obtained_marks,
                    "total_marks": r.total_marks,
                    "percentage": r.percentage,
                    "is_passed": r.is_passed,
                    "merit_position": r.merit_position,
                }
                for r in recent
            ],
        },
        "notifications": {
            "unread_count": Notification.objects.filter(
                user_id=user.pk, read_at__isnull=True
            ).count(),
        },
    }


# --------------------------------------------------------------------------------------
# Admin dashboard (basic operational statistics — counts and sums only, no lists)
# --------------------------------------------------------------------------------------
def admin_dashboard(now: datetime) -> dict:
    period = periods(now)
    today = (period.today_start, period.today_end)
    month = (period.month_start, period.month_end)

    users = User.objects.filter(role=Role.STUDENT).aggregate(
        total=Count("id"), active=Count("id", filter=Q(is_active=True))
    )

    published = Q(status=ExamStatus.PUBLISHED)
    exams = Exam.objects.aggregate(
        total=Count("id"),
        **{status: Count("id", filter=Q(status=status)) for status in ExamStatus.values},
        open_now=Count("id", filter=published & open_window(now)),
        upcoming=Count("id", filter=published & Q(start_at__gt=now)),
    )

    attempts = ExamAttempt.objects.aggregate(
        started_today=Count("id", filter=_between("started_at", *today)),
        submitted_today=Count(
            "id", filter=Q(status__in=FINISHED_STATUSES) & _between("submitted_at", *today)
        ),
        in_progress=Count(
            "id", filter=Q(status=AttemptStatus.IN_PROGRESS, deadline_at__gte=now - grace())
        ),
    )

    subscriptions = Subscription.objects.filter(active_window(now)).aggregate(
        active_now=Count("id"), students_with_active=Count("user", distinct=True)
    )

    by_status = dict.fromkeys(PaymentStatus.values, 0)
    for status, count in Payment.objects.order_by().values_list("status").annotate(n=Count("id")):
        by_status[status] = count
    revenue = list(
        Payment.objects.filter(status=PaymentStatus.SUCCESS)
        .filter(_between("verified_at", *month))
        .order_by("currency")
        .values("currency")
        .annotate(amount=Sum("amount"), count=Count("id"))
    )

    return {
        "server_time": now,
        "period": {
            "time_zone": period.time_zone,
            "today_start": period.today_start,
            "today_end": period.today_end,
            "month_start": period.month_start,
            "month_end": period.month_end,
        },
        "users": {"students_total": users["total"], "students_active": users["active"]},
        "exams": exams,
        "attempts": attempts,
        "subscriptions": subscriptions,
        "payments": {
            "by_status": by_status,
            "success_this_month": sum(row["count"] for row in revenue),
            "revenue_this_month": [
                {"currency": row["currency"], "amount": row["amount"]} for row in revenue
            ],
        },
    }
