"""Read queries other modules may use (docs/MODULES.md rule 2)."""

from datetime import timedelta

from django.db.models import Count, F, Q, Sum
from django.db.models.functions import Coalesce

from .models import Exam, ExamQuestion, ExamStatus


def question_used_by_non_draft_exam(question) -> bool:
    """Lock check registered with ``questions.locks``: True once any exam that uses the
    question has been published (published, unpublished or archived)."""
    return (
        ExamQuestion.objects.filter(question_id=question.pk)
        .exclude(exam__status=ExamStatus.DRAFT)
        .exists()
    )


def question_used_by_published_exam(question) -> bool:
    """Deactivation lock: True while an exam that uses the question is published."""
    return ExamQuestion.objects.filter(
        question_id=question.pk, exam__status=ExamStatus.PUBLISHED
    ).exists()


def with_question_totals(queryset):
    """Annotate exams with ``question_count`` and ``total_marks`` (marks override or the
    exam's default)."""
    return queryset.annotate(
        question_count=Count("exam_questions", distinct=True),
        total_marks=Coalesce(
            Sum(
                Coalesce("exam_questions__marks", F("default_marks")),
                filter=Q(exam_questions__isnull=False),
            ),
            0,
            output_field=ExamQuestion._meta.get_field("marks"),
        ),
    )


def listable_exams():
    """Published exams whose category (and subject, if any) are active — what students
    and the public may see (the public exam list and the student dashboard)."""
    return (
        Exam.objects.filter(status=ExamStatus.PUBLISHED, category__is_active=True)
        .filter(Q(subject__isnull=True) | Q(subject__is_active=True))
        .select_related("category", "subject", "group")
    )


def filter_by_group(queryset, *, group_slug: str, ungrouped: bool):
    """The group shelves of a category: ``group_slug`` = the exams sitting directly in that group;
    ``ungrouped`` = the exams with no group (or whose group the admin switched off, so they do not
    vanish from the category)."""
    if group_slug:
        return queryset.filter(group__slug=group_slug, group__is_active=True)
    if ungrouped:
        return queryset.filter(Q(group__isnull=True) | Q(group__is_active=False))
    return queryset


ROUTINE_MAX_EXAMS = 300
ROUTINE_RECENT = timedelta(days=1)


def routine_exams(now):
    """The exam routine: published, scheduled exams that have not ended (and, with no end time,
    started less than a day ago), earliest first. Exams with no start time are "any time" and
    are not part of a routine."""
    return (
        listable_exams()
        .filter(start_at__isnull=False)
        .filter(Q(end_at__gt=now) | Q(end_at__isnull=True, start_at__gte=now - ROUTINE_RECENT))
        .order_by("start_at", "id")
    )


def open_window(now, prefix: str = "") -> Q:
    """The exam's schedule is open at ``now``: ``start_at`` (if set) has been reached and
    ``end_at`` (if set) has not — the same window the exam engine enforces on start."""
    return (Q(**{f"{prefix}start_at__isnull": True}) | Q(**{f"{prefix}start_at__lte": now})) & (
        Q(**{f"{prefix}end_at__isnull": True}) | Q(**{f"{prefix}end_at__gt": now})
    )
