import logging

from celery import shared_task

from .services import finalize_overdue_attempts

logger = logging.getLogger(__name__)


@shared_task
def finalize_overdue_attempts_task() -> int:
    """Celery beat (every minute): close attempts whose deadline + grace has passed,
    keeping the answers saved so far. Idempotent — safe to retry or run twice."""
    count = finalize_overdue_attempts()
    if count:
        logger.info("Overdue attempts finalized count=%s", count)
    return count
