"""Guard around Django's ``migrate`` command.

Running ``migrate`` while Django's default ``auth.User`` is active would create tables
for the wrong user model and make switching to our custom User model (Milestone 2)
very painful. This guard refuses until ``AUTH_USER_MODEL`` points to the custom model.
After that it behaves exactly like the normal ``migrate`` command.
"""

from django.conf import settings
from django.core.management.base import CommandError
from django.core.management.commands.migrate import Command as DjangoMigrateCommand


class Command(DjangoMigrateCommand):
    def handle(self, *args, **options):
        if settings.AUTH_USER_MODEL == "auth.User":
            raise CommandError(
                "Refusing to migrate: the custom User model does not exist yet. "
                "It is created in Milestone 2 before the first migration "
                "(see docs/DATABASE_DESIGN.md §4.1)."
            )
        return super().handle(*args, **options)
