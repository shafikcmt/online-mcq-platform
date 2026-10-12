import logging

from celery import shared_task

from .services import generate_due_merit

logger = logging.getLogger(__name__)


@shared_task
def generate_due_merit_task() -> int:
    """Celery beat: re-rank merit lists that have new counted results and whose exam
    window has closed (or that have no end). Bounded and idempotent."""
    count = generate_due_merit()
    if count:
        logger.info("Merit lists regenerated count=%s", count)
    return count
