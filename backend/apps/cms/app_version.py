"""Version rules for the "update the app" notice.

Versions are plain ``major.minor.patch`` numbers (the app's ``version`` in app.json).
The decision lives here, on the server: the app sends the version it is running and gets
back whether an update is available or required, so the rule can change without a new app.
"""

import re

VERSION_PATTERN = r"^\d{1,4}\.\d{1,4}\.\d{1,4}$"
_VERSION = re.compile(VERSION_PATTERN)


def parse_version(value: str | None) -> tuple[int, int, int] | None:
    """``"1.2.3"`` → ``(1, 2, 3)``; anything else (empty, ``v1.2``, ``1.2.3-beta``) → None."""
    text = (value or "").strip()
    if not _VERSION.match(text):
        return None
    major, minor, patch = (int(part) for part in text.split("."))
    return major, minor, patch


def update_state(running: str | None, latest: str, minimum: str) -> dict:
    """What the running app should do. An unknown or malformed running version never
    triggers anything (no false alarms); an unset ``latest``/``minimum`` switches that
    notice off. ``required`` implies ``available``."""
    current, newest, oldest = parse_version(running), parse_version(latest), parse_version(minimum)
    if current is None:
        return {"update_available": False, "update_required": False}
    required = oldest is not None and current < oldest
    available = required or (newest is not None and current < newest)
    return {"update_available": available, "update_required": required}
