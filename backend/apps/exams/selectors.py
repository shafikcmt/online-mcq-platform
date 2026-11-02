"""Read queries other modules may use (docs/MODULES.md rule 2)."""

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
        .select_related("category", "subject")
    )


def open_window(now, prefix: str = "") -> Q:
    """The exam's schedule is open at ``now``: ``start_at`` (if set) has been reached and
    ``end_at`` (if set) has not — the same window the exam engine enforces on start."""
    return (Q(**{f"{prefix}start_at__isnull": True}) | Q(**{f"{prefix}start_at__lte": now})) & (
        Q(**{f"{prefix}end_at__isnull": True}) | Q(**{f"{prefix}end_at__gt": now})
    )
