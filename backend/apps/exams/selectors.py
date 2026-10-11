"""Read queries other modules may use (docs/MODULES.md rule 2)."""

from django.db.models import Count, F, Q, Sum
from django.db.models.functions import Coalesce

from .models import ExamQuestion, ExamStatus


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
