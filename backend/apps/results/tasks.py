import logging

from celery import shared_task

from .services import generate_due_merit, notify_visible_results

logger = logging.getLogger(__name__)


@shared_task
def generate_due_merit_task() -> int:
    """Celery beat: re-rank merit lists that have new counted results and whose exam
    window has closed (or that have no end). Bounded and idempotent."""
    count = generate_due_merit()
    if count:
        logger.info("Merit lists regenerated count=%s", count)
    return count


@shared_task
def notify_visible_results_task(exam_id: int | None = None) -> int:
    """Celery beat (and after an admin publication): send ``result_published``
    notifications for results that have become visible. Bounded and idempotent."""
    return notify_visible_results(exam_id=exam_id)
