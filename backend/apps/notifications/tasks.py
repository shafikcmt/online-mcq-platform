import logging

from celery import shared_task

from . import push_services

logger = logging.getLogger(__name__)


@shared_task
def send_push_message_task(message_id: int) -> None:
    """Deliver one pending push message (idempotent: only one call can claim it)."""
    push_services.deliver(message_id)


@shared_task
def send_exam_reminders_task() -> int:
    """Celery beat: create and send the exam reminders that are due (a no-op while push is off)."""
    count = push_services.send_due_reminders()
    if count:
        logger.info("Exam reminders sent count=%s", count)
    return count
