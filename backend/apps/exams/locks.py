"""Locks for exams that other modules depend on.

``exams`` is a lower module: it must not import ``attempts``. Higher modules register
checks here at startup (``AppConfig.ready``). A registered check returns True when the
exam has history that later edits would change — e.g. student attempts. Such an exam's
settings and question list are frozen; admins duplicate it instead. Status actions
(publish, unpublish, archive) and duplicate stay allowed.
"""

from collections.abc import Callable

_history_checks: list[Callable] = []


def register_history_check(check: Callable) -> None:
    """``check(exam_id) -> bool``; True means the exam has history and is frozen."""
    if check not in _history_checks:
        _history_checks.append(check)


def has_history(exam_id) -> bool:
    return any(check(exam_id) for check in _history_checks)


def has_checks() -> bool:
    return bool(_history_checks)
