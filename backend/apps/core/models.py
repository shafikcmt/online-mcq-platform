"""Shared abstract models.

Abstract models create no database tables and no migrations; concrete models in
later milestones inherit from them.
"""

from django.db import models


class TimeStampedModel(models.Model):
    """Adds ``created_at`` / ``updated_at`` (UTC) to every model that inherits it."""

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
