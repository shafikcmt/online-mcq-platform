"""Bilingual (Bangla + English) helpers shared by every module.

See docs/LOCALIZATION.md. Nothing here contains user-facing text.
"""

import re
import unicodedata
from collections.abc import Mapping
from typing import Any

from django.conf import settings

# Bangla digits ০-৯ → Western digits 0-9 (phone numbers, OTPs, marks, prices, search).
_BANGLA_TO_WESTERN_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")


def supported_language_codes() -> list[str]:
    return [code for code, _name in settings.LANGUAGES]


def normalize_language(code: str | None) -> str | None:
    """Map ``bn``, ``bn-BD``, ``EN_us`` … to a supported code, or ``None`` if unsupported."""
    if not code:
        return None
    base = code.strip().lower().replace("_", "-").split("-")[0]
    return base if base in supported_language_codes() else None


def parse_accept_language(header: str | None) -> list[str]:
    """Return supported language codes from an ``Accept-Language`` header, best first."""
    if not header:
        return []
    weighted: list[tuple[float, int, str]] = []
    for position, part in enumerate(header.split(",")):
        pieces = part.strip().split(";")
        code = normalize_language(pieces[0])
        if code is None:
            continue
        quality = 1.0
        for param in pieces[1:]:
            name, _, value = param.strip().partition("=")
            if name == "q":
                try:
                    quality = float(value)
                except ValueError:
                    quality = 0.0
        if quality > 0:
            weighted.append((-quality, position, code))
    ordered: list[str] = []
    for _q, _pos, code in sorted(weighted):
        if code not in ordered:
            ordered.append(code)
    return ordered


def normalize_digits(value: str) -> str:
    """Convert Bangla digits to Western digits; other characters are unchanged."""
    return value.translate(_BANGLA_TO_WESTERN_DIGITS)


def normalize_text(value: str) -> str:
    """Unicode NFC + trim. Bangla can be typed with different code-point sequences that
    look identical; NFC makes storage, search and uniqueness checks reliable."""
    return unicodedata.normalize("NFC", value).strip()


def resolve_bilingual(source: Any, field: str, language: str) -> tuple[str, str | None]:
    """Pick ``<field>_<language>`` with fallback to the other language.

    ``source`` may be a model instance or a mapping. Returns ``(text, language_used)``;
    ``language_used`` is ``None`` when both values are empty.
    """

    def read(lang: str) -> str:
        key = f"{field}_{lang}"
        raw = source.get(key) if isinstance(source, Mapping) else getattr(source, key, None)
        return raw or ""

    preferred = normalize_language(language) or settings.LANGUAGE_CODE
    order = [preferred] + [code for code in supported_language_codes() if code != preferred]
    for lang in order:
        text = read(lang)
        if text.strip():
            return text, lang
    return "", None


# --------------------------------------------------------------------------------------
# Admin-entered content (bilingual *_bn / *_en fields): plain-text normalization
# --------------------------------------------------------------------------------------
_WHITESPACE = re.compile(r"\s+")


def _without_controls(value: str, keep: str = "", keep_whitespace: bool = False) -> str:
    # Control characters (Cc) are dropped. Format characters such as ZWJ/ZWNJ are
    # kept because Bangla spelling needs them.
    return "".join(
        ch
        for ch in value
        if ch in keep or (keep_whitespace and ch.isspace()) or unicodedata.category(ch) != "Cc"
    )


def has_meaningful_text(text: str, *, allow_symbols: bool = False) -> bool:
    """True if ``text`` contains a letter or digit (and, optionally, a symbol such as
    ``√``, ``∞`` or ``=``). Whitespace, invisible characters and punctuation alone do
    not count."""
    classes = "LNS" if allow_symbols else "LN"
    return any(unicodedata.category(ch)[0] in classes for ch in text)


def clean_single_line(value: str | None) -> str:
    """NFC, no control characters, single spaces, trimmed."""
    return _WHITESPACE.sub(
        " ", normalize_text(_without_controls(value or "", keep_whitespace=True))
    )


def clean_multiline(value: str | None) -> str:
    """Plain text: NFC, Unix line endings, no control characters except newline/tab,
    trimmed. Stored verbatim otherwise — clients must render it escaped (never as HTML)."""
    text = (value or "").replace("\r\n", "\n").replace("\r", "\n")
    return normalize_text(_without_controls(text, keep="\n\t"))
