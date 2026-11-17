"""Read side of the sample participants: counts and the labelled list, used by the public API."""

from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Count

from apps.attempts.models import ExamAttempt

from .models import SampleEntry


def real_participant_count(exam_id: int) -> int:
    """Real students who started the exam (each counted once, whatever their number of attempts)."""
    return ExamAttempt.objects.filter(exam_id=exam_id).values("user_id").distinct().count()


def sample_count(exam_id: int) -> int:
    return SampleEntry.objects.filter(exam_id=exam_id, person__is_active=True).count()


def sample_counts(exam_ids) -> dict[int, int]:
    rows = (
        SampleEntry.objects.filter(exam_id__in=exam_ids, person__is_active=True)
        .order_by()
        .values("exam_id")
        .annotate(n=Count("id"))
    )
    return {row["exam_id"]: row["n"] for row in rows}


def sample_entries(exam):
    """The exam's active sample participants, best marks first (ties by name)."""
    return SampleEntry.objects.filter(exam_id=exam.pk, person__is_active=True).select_related(
        "person"
    )


def positions_by_marks(exam, marks_list) -> list[int | None]:
    """For each of ``marks_list``: the place those marks would take in the exam's generated merit
    list (1 + the number of ranked real students with more marks). ``None`` for all when no merit
    list has been generated. It is a comparison only: nothing is ranked or stored, and the real
    list is untouched."""
    from bisect import bisect_right

    from apps.results.selectors import ranked_results

    ranked = sorted(ranked_results(exam).order_by().values_list("obtained_marks", flat=True))
    if not ranked:
        return [None for _ in marks_list]
    return [len(ranked) - bisect_right(ranked, marks) + 1 for marks in marks_list]


def percentage(marks: Decimal, total_marks: Decimal) -> str:
    """``marks`` as a percentage of the exam total, two decimals (``"0.00"`` for a total of 0)."""
    if not total_marks:
        return "0.00"
    value = (Decimal(marks) * 100 / Decimal(total_marks)).quantize(Decimal("0.01"), ROUND_HALF_UP)
    return str(value)
