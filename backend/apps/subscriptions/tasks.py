import logging

from celery import shared_task

from .services import expire_subscriptions

logger = logging.getLogger(__name__)


@shared_task
def expire_subscriptions_task() -> int:
    """Celery beat (hourly): mark subscriptions past their expiry as ``expired``.
    Bounded and idempotent; access never depended on it (computed from server time)."""
    count = expire_subscriptions()
    if count:
        logger.info("Subscriptions expired count=%s", count)
    return count
