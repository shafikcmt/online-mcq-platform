"""Re-encrypt every secret stored in the database with the current ``SECRET_ENCRYPTION_KEY``.

Use it when the key is changed:

1. In the server environment move the old key to ``SECRET_ENCRYPTION_KEY_PREVIOUS`` and put
   the new key in ``SECRET_ENCRYPTION_KEY``; restart the backend and the workers.
2. ``python manage.py rotate_secrets``          (report only; changes nothing)
3. ``python manage.py rotate_secrets --apply``  (re-encrypts; all rows or none)
4. Run step 2 again: it must say nothing is left. Then remove
   ``SECRET_ENCRYPTION_KEY_PREVIOUS`` and restart.

It never prints a secret, a key, or a hint: only counts and row identifiers.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.core.secret_box import SecretBoxError, reencrypt_secret, uses_current_key
from apps.payments.models import PaymentGatewayCredential
from apps.verification.models import SmsGatewaySettings


def _targets():
    """(label, queryset, field name) for every encrypted column."""
    return (
        (
            "payment gateway credential",
            PaymentGatewayCredential.objects.exclude(value_encrypted=""),
            "value_encrypted",
        ),
        (
            "SMS gateway API key",
            SmsGatewaySettings.objects.exclude(api_key_encrypted=""),
            "api_key_encrypted",
        ),
    )


class Command(BaseCommand):
    help = "Re-encrypt stored secrets with the current SECRET_ENCRYPTION_KEY."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Write the changes. Without it the command only reports.",
        )

    def handle(self, *args, **options):
        apply = options["apply"]
        current = stale = 0
        unreadable: list[str] = []

        with transaction.atomic():
            for label, queryset, field in _targets():
                for row in queryset.select_for_update().order_by("pk"):
                    token = getattr(row, field)
                    if uses_current_key(token):
                        current += 1
                        continue
                    try:
                        fresh = reencrypt_secret(token)
                    except SecretBoxError:
                        unreadable.append(f"{label} #{row.pk}")
                        continue
                    stale += 1
                    if apply:
                        # A queryset update: leaves ``updated_at`` and everything else alone.
                        type(row).objects.filter(pk=row.pk).update(**{field: fresh})

            if unreadable and apply:
                # Nothing is written when any row cannot be read: fix the keys first.
                transaction.set_rollback(True)

        self.stdout.write(f"Already on the current key: {current}")
        if unreadable:
            self.stdout.write(f"Readable with a previous key: {stale}")
            for item in unreadable:
                self.stderr.write(f"Cannot be read with any configured key: {item}")
            raise CommandError(
                f"{len(unreadable)} secret(s) cannot be read. Nothing was changed. Add the "
                "right old key to SECRET_ENCRYPTION_KEY_PREVIOUS, or enter those secrets "
                "again in the Admin Panel."
            )
        if apply:
            self.stdout.write(self.style.SUCCESS(f"Re-encrypted with the current key: {stale}"))
        elif stale:
            self.stdout.write(
                self.style.WARNING(
                    f"Need re-encryption: {stale}. Run again with --apply to write them."
                )
            )
        else:
            self.stdout.write(self.style.SUCCESS("Nothing to do."))
