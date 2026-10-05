import pytest
from django.core.exceptions import ValidationError

from apps.core.phone import normalize_bd_mobile, try_normalize_bd_mobile


@pytest.mark.parametrize(
    "raw",
    [
        "01712345678",
        "8801712345678",
        "+8801712345678",
        "008801712345678",
        " 017-1234-5678 ",
        "+880 1712 345678",
        "(+880) 1712.345678",
        "০১৭১২৩৪৫৬৭৮",  # Bangla digits
        "+৮৮০১৭১২৩৪৫৬৭৮",
    ],
)
def test_accepted_formats_normalize_to_e164(raw):
    assert normalize_bd_mobile(raw) == "+8801712345678"


@pytest.mark.parametrize("operator", ["3", "4", "5", "6", "7", "8", "9"])
def test_all_current_operator_prefixes_are_accepted(operator):
    assert normalize_bd_mobile(f"01{operator}12345678") == f"+8801{operator}12345678"


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "abc",
        "0171234567",  # 10 digits
        "017123456789",  # 12 digits
        "01212345678",  # operator digit 2 does not exist
        "01112345678",  # operator digit 1 is no longer in use
        "02712345678",  # landline-style prefix
        "+15551234567",  # not Bangladesh
        "+88017123456789",
        "01712345678x",
        None,
        1712345678,
    ],
)
def test_invalid_values_are_rejected(raw):
    with pytest.raises(ValidationError) as exc:
        normalize_bd_mobile(raw)
    assert exc.value.code == "invalid_mobile"


def test_try_normalize_returns_input_when_invalid():
    assert try_normalize_bd_mobile("01712345678") == "+8801712345678"
    assert try_normalize_bd_mobile("not-a-number") == "not-a-number"
