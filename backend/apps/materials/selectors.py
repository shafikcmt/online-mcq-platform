"""Read side of the study materials: what the public may see."""

from django.db.models import Q
from django.utils import timezone

from apps.exams.models import ExamStatus

from .models import StudyMaterial


def public_materials():
    """Published materials (in an active category, or in none)."""
    return (
        StudyMaterial.objects.filter(published_at__isnull=False, published_at__lte=timezone.now())
        .filter(Q(category__isnull=True) | Q(category__is_active=True))
        .select_related("category", "subject", "exam")
    )


def exam_is_public(exam) -> bool:
    return exam is not None and exam.status == ExamStatus.PUBLISHED
