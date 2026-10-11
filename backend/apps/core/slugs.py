"""ASCII slugs for URLs (docs/LOCALIZATION.md §6): generated from the English text or
entered by an admin. Shared by catalog and exams."""

import re

from django.utils.text import slugify

SUFFIX_ROOM = 12  # room for "-copy-99999" style suffixes


def slug_base(text: str, max_length: int) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", slugify(text or "")).strip("-")
    return base[: max_length - SUFFIX_ROOM].strip("-")


def first_free_slug(base: str, taken: set[str], *, start: int = 2) -> str:
    candidate, number = base, start
    while candidate in taken:
        candidate = f"{base}-{number}"
        number += 1
    return candidate
