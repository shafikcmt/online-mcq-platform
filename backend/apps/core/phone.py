"""Bangladesh mobile number normalization and validation.

Every mobile number is stored in one canonical E.164 form: ``+8801XXXXXXXXX``.
Accepted input forms (with optional spaces, dashes, dots or brackets, and
Bangla or Western digits):

    01712345678    8801712345678    +8801712345678    008801712345678

Lives in ``core`` because both ``accounts`` and the future OTP ``verification``
module need it (docs/MODULES.md dependency order).
"""

import re

from django.core.exceptions import ValidationError
from django.utils.translation import gettext_lazy as _

from .i18n import normalize_digits

COUNTRY_CODE = "880"
# Bangladesh mobile numbers: 01 + operator digit 3-9 + 8 digits (11 digits nationally).
_NATIONAL_MOBILE = re.compile(r"^01[3-9]\d{8}$")
_SEPARATORS = re.compile(r"[\s\-.()]")

INVALID_MOBILE_MESSAGE = _("Enter a valid Bangladeshi mobile number, for example 01712345678.")


def normalize_bd_mobile(value: str) -> str:
    """Return ``+8801XXXXXXXXX`` or raise ``ValidationError`` (code ``invalid_mobile``)."""
    if not isinstance(value, str):
        raise ValidationError(INVALID_MOBILE_MESSAGE, code="invalid_mobile")

    digits = _SEPARATORS.sub("", normalize_digits(value.strip()))
    if digits.startswith("+"):
        digits = digits[1:]
    elif digits.startswith("00"):
        digits = digits[2:]

    if digits.startswith(COUNTRY_CODE):
        national = "0" + digits[len(COUNTRY_CODE) :]
    else:
        national = digits

    if not _NATIONAL_MOBILE.fullmatch(national):
        raise ValidationError(INVALID_MOBILE_MESSAGE, code="invalid_mobile")
    return f"+{COUNTRY_CODE}{national[1:]}"


def try_normalize_bd_mobile(value):
    """Normalize when possible; otherwise return the value unchanged (used for lookups)."""
    try:
        return normalize_bd_mobile(value)
    except ValidationError:
        return value
