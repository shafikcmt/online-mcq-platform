"""Celery application.

Only the app and its configuration live here. Business tasks are added by
later milestones inside each module's ``tasks.py`` and are found by autodiscovery.
"""

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

app = Celery("online_mcq")

# Read every Django setting that starts with CELERY_ (e.g. CELERY_BROKER_URL).
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
