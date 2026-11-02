"""Short bilingual OTP SMS texts (no provider branding).

Bangla SMS is sent as Unicode: one segment holds only 70 characters (English: 160),
so the Bangla text is kept very short. Tests assert both limits.
"""

from django.utils import translation
from django.utils.translation import gettext as _

BANGLA_SEGMENT_LIMIT = 70
LATIN_SEGMENT_LIMIT = 160


def render_otp_message(code: str, minutes: int, language: str) -> str:
    with translation.override(language):
        return _(
            "Your verification code is %(code)s. Valid for %(minutes)s min. Don't share it."
        ) % {
            "code": code,
            "minutes": minutes,
        }
