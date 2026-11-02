import pytest
from django.test import RequestFactory

from apps.core.i18n import (
    normalize_digits,
    normalize_language,
    normalize_text,
    parse_accept_language,
    resolve_bilingual,
)
from apps.core.middleware import LanguageMiddleware


@pytest.mark.parametrize(
    ("code", "expected"),
    [
        ("bn", "bn"),
        ("bn-BD", "bn"),
        ("EN_us", "en"),
        ("en", "en"),
        ("fr", None),
        ("", None),
        (None, None),
    ],
)
def test_normalize_language(code, expected):
    assert normalize_language(code) == expected


def test_parse_accept_language_orders_by_quality_and_skips_unsupported():
    assert parse_accept_language("fr;q=1.0, en;q=0.5, bn-BD;q=0.8") == ["bn", "en"]
    assert parse_accept_language("en-US,en;q=0.9") == ["en"]
    assert parse_accept_language("bn;q=0") == []
    assert parse_accept_language("") == []


def test_normalize_digits_converts_bangla_digits():
    assert normalize_digits("০১৭১২৩৪৫৬৭৮") == "01712345678"
    assert normalize_digits("OTP ৪৫৬ and 789") == "OTP 456 and 789"


def test_normalize_text_applies_nfc_and_trims():
    decomposed = "ো"  # Bangla vowel signs written as two code points
    composed = "ো"  # the same character as one code point
    assert normalize_text(f"  {decomposed} ") == composed


def test_resolve_bilingual_prefers_requested_language():
    data = {"title_bn": "গণিত", "title_en": "Mathematics"}
    assert resolve_bilingual(data, "title", "bn") == ("গণিত", "bn")
    assert resolve_bilingual(data, "title", "en") == ("Mathematics", "en")


def test_resolve_bilingual_falls_back_to_other_language():
    assert resolve_bilingual({"title_bn": "", "title_en": "Physics"}, "title", "bn") == (
        "Physics",
        "en",
    )
    assert resolve_bilingual({"title_bn": "পদার্থ", "title_en": None}, "title", "en") == (
        "পদার্থ",
        "bn",
    )
    assert resolve_bilingual({}, "title", "bn") == ("", None)


def test_resolve_bilingual_works_with_objects():
    class Item:
        title_bn = ""
        title_en = "Chemistry"

    assert resolve_bilingual(Item(), "title", "bn") == ("Chemistry", "en")


class TestLanguageSelection:
    factory = RequestFactory()

    def select(self, path="/api/v1/health/", **kwargs):
        return LanguageMiddleware.select_language(self.factory.get(path, **kwargs))

    def test_default_is_bangla_for_app_and_website(self):
        assert self.select() == "bn"

    def test_admin_api_defaults_to_english(self):
        assert self.select("/api/v1/admin/dashboard/") == "en"

    def test_accept_language_header_wins_over_default(self):
        assert self.select(HTTP_ACCEPT_LANGUAGE="en-US,en;q=0.9") == "en"
        assert self.select("/api/v1/admin/x/", HTTP_ACCEPT_LANGUAGE="bn") == "bn"

    def test_query_parameter_wins_over_header(self):
        assert self.select("/api/v1/health/?lang=en", HTTP_ACCEPT_LANGUAGE="bn") == "en"

    def test_unsupported_values_are_ignored(self):
        assert self.select("/api/v1/health/?lang=xx", HTTP_ACCEPT_LANGUAGE="fr") == "bn"


def test_response_declares_language(client):
    response = client.get("/api/v1/health/", HTTP_ACCEPT_LANGUAGE="en")

    assert response["Content-Language"] == "en"
    assert "Accept-Language" in response["Vary"]


def test_error_messages_are_localized(client):
    english = client.get("/api/v1/missing/", HTTP_ACCEPT_LANGUAGE="en").json()["error"]
    bangla = client.get("/api/v1/missing/", HTTP_ACCEPT_LANGUAGE="bn").json()["error"]

    # The machine code never changes with language.
    assert english["code"] == bangla["code"] == "not_found"
    assert english["message"]


def test_every_backend_message_has_a_bangla_translation():
    """docs/LOCALIZATION.md: no untranslated or "fuzzy" (machine-guessed, ignored by
    compilemessages) Bangla entries — those would show English to Bangla users. Run
    ``makemessages -l bn -l en`` after adding a message, then translate the new entries."""
    import re
    from pathlib import Path

    po = Path(__file__).resolve().parent.parent / "locale" / "bn" / "LC_MESSAGES" / "django.po"
    missing = []
    for block in po.read_text(encoding="utf-8").split("\n\n"):
        match = re.search(r'(?:^|\n)msgid (".*?")\nmsgstr (".*?")$', block.strip(), re.S)
        if not match or "Project-Id-Version" in block:
            continue
        msgid = "".join(re.findall(r'"((?:[^"\\]|\\.)*)"', match.group(1)))
        msgstr = "".join(re.findall(r'"((?:[^"\\]|\\.)*)"', match.group(2)))
        if "#, fuzzy" in block or not msgstr.strip():
            missing.append(msgid)
    assert missing == [], f"untranslated Bangla messages: {missing}"
