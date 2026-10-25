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
