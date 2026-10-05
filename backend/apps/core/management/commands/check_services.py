"""Developer tool: verify PostgreSQL and Redis are reachable with the current settings.

Usage: python manage.py check_services
Read-only — it opens connections and runs a trivial query/ping; it never migrates.
"""

import redis
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection


class Command(BaseCommand):
    help = "Check connectivity to PostgreSQL and Redis."

    def handle(self, *args, **options):
        failures = []

        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            self.stdout.write(self.style.SUCCESS("PostgreSQL: OK"))
        except Exception as exc:  # noqa: BLE001 — report any connection problem
            failures.append(f"PostgreSQL: {exc.__class__.__name__}")

        for label, url in (
            ("Redis (broker)", settings.CELERY_BROKER_URL),
            ("Redis (cache)", settings.REDIS_CACHE_URL),
        ):
            try:
                redis.Redis.from_url(url, socket_connect_timeout=3).ping()
                self.stdout.write(self.style.SUCCESS(f"{label}: OK"))
            except Exception as exc:  # noqa: BLE001
                failures.append(f"{label}: {exc.__class__.__name__}")

        if failures:
            raise CommandError("Service check failed — " + "; ".join(failures))
