import logging

from celery import shared_task

from .services import reconcile_payments

logger = logging.getLogger(__name__)


@shared_task
def reconcile_payments_task() -> int:
    """Celery beat: re-query the provider for payments stuck in ``initiated``/``pending``.
    Bounded and idempotent — only a provider answer changes a payment."""
    count = reconcile_payments()
    if count:
        logger.info("Payments reconciled count=%s", count)
    return count
