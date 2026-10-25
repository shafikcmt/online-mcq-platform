"""Create (or reset the password of) an Admin Panel account on the DEMO server.

    python manage.py create_demo_admin --mobile 01XXXXXXXXX --full-name "Client Demo"
    # password: typed twice at a hidden prompt (nothing echoed, nothing in shell history)

    printf '%s\\n' "$PASSWORD" | python manage.py create_demo_admin --mobile … --password-stdin
    # for scripted use; the password never appears in the command line

The account gets ``role=admin`` (all the Admin Panel needs) and is **not** a Django
superuser or staff member, so it cannot use the internal Django admin. Running it again
for the same number sets a new password (and ends that account's existing sessions —
Django invalidates sessions on a password change). It never prints the password and never
turns an existing student or superuser into a demo admin. Refuses outside the demo
database (``apps.core.demo``).
"""

import getpass
import sys

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import Role
from apps.core.demo import require_demo
from apps.core.phone import normalize_bd_mobile


class Command(BaseCommand):
    help = "Create or reset a demo Admin Panel account (role admin, not a superuser)."

    def add_arguments(self, parser):
        parser.add_argument("--mobile", required=True, help="Bangladeshi mobile number")
        parser.add_argument("--full-name", default="Demo Admin")
        parser.add_argument(
            "--password-stdin",
            action="store_true",
            help="Read the password from the first line of standard input.",
        )

    def handle(self, *args, mobile, full_name, password_stdin, **options):
        require_demo()
        try:
            number = normalize_bd_mobile(mobile)
        except ValidationError as exc:
            raise CommandError("Enter a valid Bangladeshi mobile number.") from exc
        full_name = full_name.strip()
        if not full_name:
            raise CommandError("--full-name cannot be empty.")
        User = get_user_model()
        existing = User.objects.filter(mobile_number=number).first()
        if existing is not None and (existing.role != Role.ADMIN or existing.is_superuser):
            raise CommandError(
                "This number belongs to an account that is not a demo admin "
                "(a student or a superuser); choose another number."
            )
        password = self._read_password(password_stdin)
        try:
            validate_password(password, user=existing)
        except ValidationError as exc:
            raise CommandError(" ".join(exc.messages)) from exc
        with transaction.atomic():
            if existing is None:
                User.objects.create_user(
                    number,
                    password=password,
                    full_name=full_name,
                    role=Role.ADMIN,
                    is_staff=False,
                    is_superuser=False,
                    is_active=True,
                )
                self.stdout.write(self.style.SUCCESS("Demo admin created."))
                return
            existing.full_name = full_name
            existing.is_active = True
            existing.is_staff = False
            existing.set_password(password)
            existing.save()
        self.stdout.write(self.style.SUCCESS("Demo admin updated: new password set."))

    def _read_password(self, from_stdin: bool) -> str:
        if from_stdin:
            password = sys.stdin.readline().rstrip("\r\n")
        else:
            if not sys.stdin.isatty():
                raise CommandError("No terminal: use --password-stdin to pass the password.")
            password = getpass.getpass("Password: ")
            if password != getpass.getpass("Password (again): "):
                raise CommandError("The passwords do not match.")
        if not password:
            raise CommandError("The password cannot be empty.")
        return password
