# Load the Celery app when Django starts so future @shared_task functions use it.
from .celery import app as celery_app

__all__ = ("celery_app",)
