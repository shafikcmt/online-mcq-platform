"""Guards for the staging / client-demo commands (``seed_demo``, ``create_demo_admin``).

They write demo data and accounts, so they refuse to run anywhere except a demo database:
the environment must opt in AND the configured database name must be a demo name. Any
other database (local, QA such as ``mcq_m7_qa``, test, production) is refused.
"""

import os
import re

from django.core.management.base import CommandError
from django.db import connection

# ``online_mcq_demo`` or ``online_mcq_demo_<suffix>`` (e.g. a second demo copy) — nothing else.
DEMO_DATABASE_PATTERN = re.compile(r"^online_mcq_demo(?:_[a-z0-9]{1,20})?$")
DEMO_ENVIRONMENT_MARKER = "staging-demo"


def database_name() -> str:
    return str(connection.settings_dict.get("NAME") or "")


def is_demo_database(name: str) -> bool:
    return bool(DEMO_DATABASE_PATTERN.fullmatch(name))


def require_demo_database() -> str:
    """The demo database name, or ``CommandError`` (nothing is written)."""
    name = database_name()
    if not is_demo_database(name):
        raise CommandError(
            f"Refusing: database {name!r} is not a demo database "
            "(expected online_mcq_demo). Demo commands never touch other databases."
        )
    return name


def require_demo_environment() -> None:
    """The server's ``.env.staging`` opt-in for writing demo data."""
    if os.environ.get("DEMO_SEED_ALLOWED", "").strip().lower() != "true":
        raise CommandError("Refusing: DEMO_SEED_ALLOWED=true is not set for this environment.")
    if os.environ.get("DEMO_ENVIRONMENT", "").strip() != DEMO_ENVIRONMENT_MARKER:
        raise CommandError(
            f"Refusing: DEMO_ENVIRONMENT={DEMO_ENVIRONMENT_MARKER} is not set for this environment."
        )


def require_demo() -> str:
    require_demo_environment()
    return require_demo_database()


# --------------------------------------------------------------------------------------
# Production preview: the same demo data in the PRODUCTION database, before launch only.
# --------------------------------------------------------------------------------------
PRODUCTION_PREVIEW_MARKER = "production-preview"


def require_production_preview_environment() -> None:
    """The one-off opt-in, given on the command line of a single run (never in .env.prod):
    ``-e DEMO_SEED_ALLOWED=true -e DEMO_ENVIRONMENT=production-preview``."""
    if os.environ.get("DEMO_SEED_ALLOWED", "").strip().lower() != "true":
        raise CommandError("Refusing: DEMO_SEED_ALLOWED=true is not set for this run.")
    if os.environ.get("DEMO_ENVIRONMENT", "").strip() != PRODUCTION_PREVIEW_MARKER:
        raise CommandError(
            f"Refusing: DEMO_ENVIRONMENT={PRODUCTION_PREVIEW_MARKER} is not set for this run."
        )


def demo_student_numbers() -> set[str]:
    """The seeded students' numbers, as stored (E.164)."""
    from apps.core.management.commands.seed_demo import STUDENTS
    from apps.core.phone import normalize_bd_mobile

    return {normalize_bd_mobile(number) for _, number in STUDENTS}


def demo_students():
    """The seeded students: one of the demo numbers AND no usable password (a real person
    who registered with such a number has a password, so is never treated as demo)."""
    from apps.accounts.models import Role, User

    candidates = User.objects.filter(role=Role.STUDENT, mobile_number__in=demo_student_numbers())
    return User.objects.filter(pk__in=[u.pk for u in candidates if not u.has_usable_password()])


def require_no_real_activity() -> None:
    """Production preview only before launch: refuse while any real student, attempt,
    subscription or payment exists (they would mix with the demo data)."""
    from apps.accounts.models import Role, User
    from apps.attempts.models import ExamAttempt
    from apps.payments.models import Payment
    from apps.subscriptions.models import Subscription

    found = {
        "students": User.objects.filter(role=Role.STUDENT).count(),
        "attempts": ExamAttempt.objects.count(),
        "subscriptions": Subscription.objects.count(),
        "payments": Payment.objects.count(),
    }
    real = {name: count for name, count in found.items() if count}
    if real:
        detail = ", ".join(f"{name}={count}" for name, count in real.items())
        raise CommandError(
            "Refusing: this database already has real activity "
            f"({detail}). The production preview is only for an empty platform before launch."
        )
