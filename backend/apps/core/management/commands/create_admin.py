"""Create an Admin Panel account on a real (production) server.

    python manage.py create_admin --mobile 01XXXXXXXXX --full-name "Your Name"
    # password: typed twice at a hidden prompt — nothing echoed, nothing in the command
    # line, so nothing in shell history, `ps`, Docker or application logs

    python manage.py create_admin --mobile 01XXXXXXXXX --full-name "…" --reset-password
    # set a NEW password for an existing Admin Panel account (ends its sessions)

    printf '%s\\n' "$PASSWORD" | python manage.py create_admin --mobile … --password-stdin
    # scripted use only; the password never appears in the command line

The account gets ``role=admin`` — everything the Admin Panel needs — and is **not** a
Django superuser or staff member (the internal Django admin is a separate, rarely needed
tool: ``createsuperuser``). The password must pass the project's password validators
(minimum length, not similar to the number or name, not common). Never prints, logs or
audits the password. Never turns a student or a superuser into a panel admin, and never
changes an existing account unless ``--reset-password`` is given. Each change is written
to the audit log (without the password).

Unlike ``create_demo_admin`` this command is not limited to the demo database.
"""

import getpass
import sys

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import Role
from apps.audit import services as audit
from apps.audit.services import AuditContext
from apps.core.phone import normalize_bd_mobile

FULL_NAME_MAX_LENGTH = 150


class Command(BaseCommand):
    help = "Create an Admin Panel account (role admin, not a superuser). Hidden password prompt."

    def add_arguments(self, parser):
        parser.add_argument("--mobile", required=True, help="Bangladeshi mobile number")
        parser.add_argument("--full-name", required=True, help="The administrator's name")
        parser.add_argument(
            "--reset-password",
            action="store_true",
            help="Set a new password for an EXISTING Admin Panel account.",
        )
        parser.add_argument(
            "--password-stdin",
            action="store_true",
            help="Read the password from the first line of standard input (scripts only).",
        )

    def handle(self, *args, mobile, full_name, reset_password, password_stdin, **options):
        try:
            number = normalize_bd_mobile(mobile)
        except ValidationError as exc:
            raise CommandError("Enter a valid Bangladeshi mobile number.") from exc
        full_name = " ".join(full_name.split())
        if not full_name:
            raise CommandError("--full-name cannot be empty.")
        if len(full_name) > FULL_NAME_MAX_LENGTH:
            raise CommandError(f"--full-name is longer than {FULL_NAME_MAX_LENGTH} characters.")

        User = get_user_model()
        existing = User.objects.filter(mobile_number=number).first()
        if existing is not None:
            if existing.role != Role.ADMIN or existing.is_superuser:
                raise CommandError(
                    "This number belongs to an account that is not an Admin Panel admin "
                    "(a student or a superuser); choose another number."
                )
            if not reset_password:
                raise CommandError(
                    "An Admin Panel account with this number already exists. Nothing was "
                    "changed. Use --reset-password to set a new password for it."
                )
        elif reset_password:
            raise CommandError("No Admin Panel account has this number; nothing to reset.")

        password = self._read_password(password_stdin)
        candidate = existing or User(mobile_number=number, full_name=full_name)
        try:
            validate_password(password, user=candidate)
        except ValidationError as exc:
            raise CommandError(" ".join(exc.messages)) from exc

        ctx = AuditContext()  # run on the server by an operator: no request, no actor
        with transaction.atomic():
            if existing is None:
                user = User.objects.create_user(
                    number,
                    password=password,
                    full_name=full_name,
                    role=Role.ADMIN,
                    is_staff=False,
                    is_superuser=False,
                    is_active=True,
                )
                audit.record(
                    ctx,
                    action="user.admin_create",
                    entity_type="accounts.user",
                    entity_id=user.pk,
                    summary="Admin Panel account created (create_admin command)",
                    metadata={"values": {"role": Role.ADMIN}},
                    allowed_fields=("role",),
                )
                message = "Admin Panel account created."
            else:
                user = User.objects.select_for_update().get(pk=existing.pk)
                user.full_name = full_name
                user.is_active = True
                user.is_staff = False
                user.set_password(password)  # also ends the account's existing sessions
                user.save()
                audit.record(
                    ctx,
                    action="user.admin_password_reset",
                    entity_type="accounts.user",
                    entity_id=user.pk,
                    summary="Admin Panel password reset (create_admin command)",
                )
                message = "Admin Panel account updated: new password set."
        self.stdout.write(self.style.SUCCESS(message))

    def _read_password(self, from_stdin: bool) -> str:
        if from_stdin:
            password = sys.stdin.readline().rstrip("\r\n")
        else:
            if not sys.stdin.isatty():
                raise CommandError(
                    "No terminal for the hidden password prompt. Run it with `docker compose "
                    "run --rm -it …` (or use --password-stdin in a script)."
                )
            password = getpass.getpass("Password (hidden): ")
            if password != getpass.getpass("Password again (hidden): "):
                raise CommandError("The passwords do not match. Nothing was changed.")
        if not password:
            raise CommandError("The password cannot be empty.")
        return password
