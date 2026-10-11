"""Locks for questions that other modules depend on.

``questions`` is a lower module: it must not import ``exams`` (or, later, ``attempts``).
Higher modules register checks here at startup (``AppConfig.ready``). Two kinds:

- ``CONTENT``: the question's content, options, correct answer, subject and image are
  frozen (e.g. used by an exam that has been published). Only ``LOCK_EXEMPT_FIELDS``
  may still change.
- ``DEACTIVATE``: the question may not be deactivated (e.g. used by an exam that is
  published right now — a live exam must never lose a question).

Fail-safe: ``questions.checks`` raises a system-check error when another model
references questions but no content lock is registered, so a missing registration
cannot silently disable the protection.
"""

from collections.abc import Callable

CONTENT = "content"
DEACTIVATE = "deactivate"

# Fields that never change what a student sees or how an answer is scored.
LOCK_EXEMPT_FIELDS = frozenset({"is_active", "difficulty"})

_checks: dict[str, list[Callable]] = {CONTENT: [], DEACTIVATE: []}


def register_lock(kind: str, check: Callable) -> None:
    """``check(question) -> bool``; True means the question is locked (for ``kind``)."""
    if check not in _checks[kind]:
        _checks[kind].append(check)


def register_edit_lock(check: Callable) -> None:
    register_lock(CONTENT, check)


def is_locked(question, kind: str = CONTENT) -> bool:
    return any(check(question) for check in _checks[kind])


def has_checks(kind: str = CONTENT) -> bool:
    return bool(_checks[kind])
