"""Milestone 6A: site settings, announcements, FAQ, pages, contact form + admin inbox."""

import itertools
import json
import logging
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.audit.models import AuditLog
from apps.audit.services import AuditContext
from apps.cms import selectors, services
from apps.cms.models import (
    Announcement,
    ContactMessage,
    Faq,
    LeaderboardNameMode,
    Page,
    SiteSettings,
)
from apps.results import selectors as result_selectors
from tests.test_subscriptions import jwt_client, make_student

pytestmark = pytest.mark.django_db

CTX = AuditContext()
ADMIN = "/api/v1/admin/"
PUBLIC = "/api/v1/public/"
_numbers = itertools.count(1)
XSS = '<script>alert("x")</script><img src=x onerror=alert(1)>'


@pytest.fixture(autouse=True)
def _clean_cache(settings):
    settings.APP_DEEP_LINK_SCHEME = "mcqapp"  # the project's own app scheme in these tests
    cache.clear()
    yield
    cache.clear()


def make_admin():
    return User.objects.create_user(
        f"0161{next(_numbers):07d}", password="Strong-Pass-2026", full_name="Ops", role=Role.ADMIN
    )


@pytest.fixture
def admin_user():
    return make_admin()


@pytest.fixture
def api(admin_user):
    client = APIClient()
    client.force_login(admin_user)
    return client


@pytest.fixture
def public():
    return APIClient()


def announcement(**fields):
    fields.setdefault("title_en", "Exam schedule")
    fields.setdefault("body_en", "The model test starts on Friday.")
    fields.setdefault("published_at", timezone.now() - timedelta(minutes=1))
    return services.create_content(Announcement(**fields), ctx=CTX)


def faq(**fields):
    fields.setdefault("question_en", "How do I register?")
    fields.setdefault("answer_en", "With your mobile number.")
    return services.create_content(Faq(**fields), ctx=CTX)


def page(slug="about", **fields):
    fields.setdefault("title_en", "About us")
    fields.setdefault("body_en", "We run online exams.")
    return services.create_content(Page(slug=slug, **fields), ctx=CTX)


def errors(response):
    return response.json()["error"]["field_errors"]


def results(response):
    return response.json()["results"]


# ======================================================================================
# Site settings
# ======================================================================================
class TestSiteSettings:
    def test_defaults_until_saved(self, settings, public):
        settings.LEADERBOARD_PUBLIC_NAME_MODE = "initials"
        row = selectors.current_settings()
        assert row.pk == 1 and row._state.adding  # not saved yet
        assert row.default_language == "bn"
        assert row.public_leaderboard_name_mode == "initials"
        assert row.app_leaderboard_name_mode == "masked"
        body = public.get(f"{PUBLIC}settings/").json()
        assert body["default_language"] == "bn" and body["platform_name"] == ""

    def test_admin_update_is_validated_and_audited(self, api):
        response = api.patch(
            f"{ADMIN}settings/",
            {
                "platform_name_bn": "  এমসিকিউ  প্ল্যাটফর্ম ",
                "platform_name_en": "MCQ Platform",
                "contact_email": " Help@Example.ORG ",
                "contact_phone": "+880 1712-345678",
                "app_download_url": "https://play.google.com/store/apps/details?id=com.mcq",
                "app_open_url": "mcqapp://open",
                "default_language": "en",
                "public_leaderboard_name_mode": "initials",
                "secret_key": "ignored",
                "id": 99,
            },
            format="json",
        )
        assert response.status_code == 200, response.content
        body = response.json()
        assert body["platform_name_bn"] == "এমসিকিউ প্ল্যাটফর্ম"
        assert body["contact_email"] == "help@example.org"
        assert "secret_key" not in body and "id" not in body
        row = SiteSettings.objects.get()
        assert row.pk == 1 and SiteSettings.objects.count() == 1
        entry = AuditLog.objects.get(action="site_settings.update")
        assert entry.metadata["changes"]["default_language"] == {"from": "bn", "to": "en"}
        # No-op update writes nothing.
        api.patch(f"{ADMIN}settings/", {"default_language": "en"}, format="json")
        assert AuditLog.objects.filter(action="site_settings.update").count() == 1

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("default_language", "fr"),
            ("public_leaderboard_name_mode", "phone"),
            ("app_leaderboard_name_mode", "email"),
            ("app_download_url", "http://play.google.com/x"),
            ("app_download_url", "javascript:alert(1)"),
            ("app_download_url", "https://"),
            ("app_open_url", "javascript:alert(1)"),
            ("app_open_url", "JavaScript:alert(1)"),
            ("app_open_url", "data:text/html,<script>x</script>"),
            ("app_open_url", "vbscript:x"),
            ("app_open_url", "file:///etc/passwd"),
            ("app_open_url", "http://example.com"),
            ("app_open_url", "not a url"),
            ("contact_email", "not-an-email"),
            ("contact_phone", "call me maybe"),
        ],
    )
    def test_invalid_values_rejected(self, api, field, value):
        response = api.patch(f"{ADMIN}settings/", {field: value}, format="json")
        assert response.status_code == 400
        assert field in errors(response)
        assert not SiteSettings.objects.exists()

    def test_empty_links_allowed(self, api, public):
        response = api.patch(
            f"{ADMIN}settings/", {"app_download_url": "", "app_open_url": ""}, format="json"
        )
        assert response.status_code == 200
        assert public.get(f"{PUBLIC}app-links/").json() == {
            "app_download_url": "",
            "app_open_url": "",
        }

    def test_database_guards(self):
        services.update_site_settings({"default_language": "en"}, ctx=CTX)
        for update in (
            {"default_language": "fr"},
            {"public_leaderboard_name_mode": "phone"},
            {"app_download_url": "http://x.y"},
            {"app_open_url": "javascript:alert(1)"},
        ):
            with pytest.raises(IntegrityError), transaction.atomic():
                SiteSettings.objects.filter(pk=1).update(**update)
        with pytest.raises(IntegrityError), transaction.atomic():
            SiteSettings.objects.create(
                id=2,
                default_language="bn",
                public_leaderboard_name_mode="masked",
                app_leaderboard_name_mode="masked",
            )

    def test_public_settings_expose_only_public_fields(self, api, public):
        api.patch(
            f"{ADMIN}settings/",
            {
                "platform_name_bn": "প্ল্যাটফর্ম",
                "platform_name_en": "Platform",
                "app_leaderboard_name_mode": "full_name",
                "app_open_url": "mcqapp://open",
            },
            format="json",
        )
        body = public.get(f"{PUBLIC}settings/", HTTP_ACCEPT_LANGUAGE="en").json()
        assert set(body) == {
            "platform_name",
            "tagline",
            "address",
            "contact_email",
            "contact_phone",
            "app_download_url",
            "app_open_url",
            "default_language",
        }
        assert body["platform_name"] == "Platform"
        assert (
            public.get(f"{PUBLIC}settings/", HTTP_ACCEPT_LANGUAGE="bn").json()["platform_name"]
            == "প্ল্যাটফর্ম"
        )
        assert public.get(f"{PUBLIC}app-links/").json()["app_open_url"] == "mcqapp://open"

    def test_admin_only(self, public):
        student = make_student()
        assert public.get(f"{ADMIN}settings/").status_code == 401
        assert jwt_client(student).get(f"{ADMIN}settings/").status_code in (401, 403)
        assert jwt_client(student).patch(
            f"{ADMIN}settings/", {"default_language": "en"}, format="json"
        ).status_code in (401, 403)
        assert public.patch(f"{PUBLIC}settings/", {}, format="json").status_code == 405

    def test_csrf_required(self, admin_user):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(admin_user)
        response = client.patch(f"{ADMIN}settings/", {"default_language": "en"}, format="json")
        assert response.status_code == 403
        assert not SiteSettings.objects.exists()


class TestAppOpenUrlAllowList:
    @pytest.mark.parametrize(
        "value",
        [
            "https://example.com/open",
            "https://play.google.com/store/apps/details?id=com.mcq",
            "mcqapp://open",
            "mcqapp://exam/physics-1",
            "",
        ],
    )
    def test_accepted(self, api, value):
        response = api.patch(f"{ADMIN}settings/", {"app_open_url": value}, format="json")
        assert response.status_code == 200, response.content

    @pytest.mark.parametrize(
        "value",
        [
            "otherapp://open",  # another (arbitrary) custom scheme
            "MCQAPP://open",  # the scheme must be written exactly (lowercase)
            "fb://profile",
            "intent://open#Intent;scheme=mcqapp;end",
            "mcqapp:open",  # malformed: no //
            "mcqapp://",  # malformed: nothing after //
            "mcqapp:// open",
            "javascript:alert(1)",
            "javascript://%0aalert(1)",
            "data:text/html;base64,PHNjcmlwdD4=",
            "http://example.com",
            "https://",
            "https://nodot",
            "vbscript:msgbox",
            "file:///etc/passwd",
            "blob:https://x.y/z",
            "about:blank",
            "//example.com",
            "open",
        ],
    )
    def test_rejected(self, api, value):
        response = api.patch(f"{ADMIN}settings/", {"app_open_url": value}, format="json")
        assert response.status_code == 400, value
        assert "app_open_url" in errors(response)

    def test_only_https_without_a_configured_scheme(self, settings, api):
        settings.APP_DEEP_LINK_SCHEME = ""
        assert (
            api.patch(
                f"{ADMIN}settings/", {"app_open_url": "mcqapp://open"}, format="json"
            ).status_code
            == 400
        )
        assert (
            api.patch(
                f"{ADMIN}settings/", {"app_open_url": "https://example.com/app"}, format="json"
            ).status_code
            == 200
        )

    @pytest.mark.parametrize("bad", ["javascript", "http", "https", "data", "1app", "a b", "x"])
    def test_unsafe_configured_scheme_is_ignored(self, settings, api, bad):
        from apps.cms.checks import check_cms_settings

        settings.APP_DEEP_LINK_SCHEME = bad
        assert [m.id for m in check_cms_settings(None)] == ["cms.E001"]
        response = api.patch(f"{ADMIN}settings/", {"app_open_url": f"{bad}://open"}, format="json")
        assert response.status_code == 400

    def test_database_shape_guard(self):
        services.update_site_settings({"app_open_url": "mcqapp://open"}, ctx=CTX)
        for value in ("javascript://x", "data://x", "http://x.y", "nonsense", "fb:x"):
            with pytest.raises(IntegrityError), transaction.atomic():
                SiteSettings.objects.filter(pk=1).update(app_open_url=value)


class TestContactPhoneRule:
    @pytest.mark.parametrize(
        ("value", "stored"),
        [
            ("01712345678", "01712345678"),  # Bangladesh mobile
            ("+880 1712-345678", "+880 1712-345678"),
            ("০১৭১২ ৩৪৫৬৭৮", "01712 345678"),  # Bangla digits
            ("+44 20 7946 0958", "+44 20 7946 0958"),  # international
            ("+1 (415) 555-2671", "+1 (415) 555-2671"),
            ("(02) 9876543", "(02) 9876543"),  # landline style
            ("  02-9876543  ", "02-9876543"),
        ],
    )
    def test_accepted(self, public, value, stored):
        response = public.post(f"{PUBLIC}contact/", {**VALID, "phone": value}, format="json")
        assert response.status_code == 202, response.content
        assert ContactMessage.objects.get().phone == stored

    @pytest.mark.parametrize(
        "value",
        [
            "+880 1712 345 678 9012 3",  # too long (> 20 characters)
            "1234567890123456",  # 16 digits
            "12345",  # too few digits
            "0171\x072345678",  # control character
            "0171\u200b2345678",  # invisible format character
            "0171\n2345678",
            "call me maybe",
            "ABCDEFGHIJ",
            "0171-ABC-678",
            "<script>",
            "++8801712345678",
            "01712345678+",
            "0171 234 5678 ext 12",  # extensions are not supported
        ],
    )
    def test_rejected(self, public, value):
        response = public.post(f"{PUBLIC}contact/", {**VALID, "phone": value}, format="json")
        assert response.status_code == 400, value
        assert "phone" in errors(response)
        assert not ContactMessage.objects.exists()

    def test_site_settings_use_the_same_rule(self, api):
        assert (
            api.patch(
                f"{ADMIN}settings/", {"contact_phone": "+44 20 7946 0958"}, format="json"
            ).status_code
            == 200
        )
        assert (
            api.patch(f"{ADMIN}settings/", {"contact_phone": "phone me"}, format="json").status_code
            == 400
        )


class TestSettingsWiring:
    def test_leaderboard_modes_come_from_site_settings(self, settings):
        assert tuple(LeaderboardNameMode.values) == result_selectors.NAME_MODES
        assert result_selectors.NAME_MODES == ("masked", "initials", "display_name", "full_name")
        settings.LEADERBOARD_PUBLIC_NAME_MODE = "initials"
        assert result_selectors.leaderboard_name_mode("public") == "initials"  # env default
        services.update_site_settings(
            {"public_leaderboard_name_mode": "full_name", "app_leaderboard_name_mode": "initials"},
            ctx=CTX,
        )
        assert result_selectors.leaderboard_name_mode("public") == "full_name"
        assert result_selectors.leaderboard_name_mode("app") == "initials"

    def test_default_language_drives_requests_without_a_choice(self, public):
        assert public.get(f"{PUBLIC}settings/")["Content-Language"] == "bn"
        with transaction.atomic():
            services.update_site_settings({"default_language": "en"}, ctx=CTX)
        selectors.forget_default_language()  # on_commit does this in real requests
        response = public.get(f"{PUBLIC}settings/")
        assert response["Content-Language"] == "en"
        # An explicit choice still wins; admin paths keep their own default.
        assert (
            public.get(f"{PUBLIC}settings/", HTTP_ACCEPT_LANGUAGE="bn")["Content-Language"] == "bn"
        )

    def test_default_language_fallback_on_errors(self, monkeypatch):
        def broken(*args, **kwargs):
            raise RuntimeError("cache down")

        monkeypatch.setattr(cache, "get", broken)
        assert selectors.platform_default_language("bn") == "bn"


# ======================================================================================
# Announcements
# ======================================================================================
class TestAnnouncements:
    def test_admin_crud_audited(self, api):
        response = api.post(
            f"{ADMIN}announcements/",
            {
                "title_bn": "পরীক্ষার সময়সূচি",
                "body_bn": "শুক্রবার মডেল টেস্ট।",
                "title_en": "Exam schedule",
                "body_en": "Model test on Friday.",
                "audience": "public",
            },
            format="json",
        )
        assert response.status_code == 201, response.content
        body = response.json()
        assert body["state"] == "draft"
        url = f"{ADMIN}announcements/{body['id']}/"
        now = timezone.now()
        response = api.patch(url, {"published_at": now.isoformat()}, format="json")
        assert response.json()["state"] == "live"
        assert api.get(url).status_code == 200
        assert api.delete(url).status_code == 204
        actions = list(
            AuditLog.objects.filter(entity_type="cms.announcement").values_list("action", flat=True)
        )
        assert sorted(actions) == [
            "announcement.create",
            "announcement.delete",
            "announcement.update",
        ]
        update = AuditLog.objects.get(action="announcement.update")
        assert update.metadata["changed_fields"] == ["published_at"]

    def test_publish_now_uses_the_server_clock(self, api, public):
        before = timezone.now()
        response = api.post(
            f"{ADMIN}announcements/",
            {
                "title_en": "Now",
                "body_en": "Visible at once.",
                "audience": "public",
                "publish_now": True,
            },
            format="json",
        )
        assert response.status_code == 201, response.content
        body = response.json()
        assert body["state"] == "live"
        assert "publish_now" not in body  # write-only
        assert Announcement.objects.get(pk=body["id"]).published_at >= before
        titles = {row["title"] for row in results(public.get(f"{PUBLIC}announcements/"))}
        assert "Now" in titles

    def test_publish_now_wins_over_a_client_supplied_time(self, api):
        later = timezone.now() + timedelta(days=30)
        response = api.post(
            f"{ADMIN}announcements/",
            {
                "title_en": "T",
                "body_en": "B",
                "published_at": later.isoformat(),
                "publish_now": True,
            },
            format="json",
        )
        assert response.status_code == 201, response.content
        assert response.json()["state"] == "live"

    def test_publish_now_publishes_an_existing_draft(self, api, public):
        draft = announcement(title_en="Was a draft", audience="public", published_at=None)
        assert draft.published_at is None
        response = api.patch(
            f"{ADMIN}announcements/{draft.pk}/", {"publish_now": True}, format="json"
        )
        assert response.status_code == 200, response.content
        assert response.json()["state"] == "live"
        titles = {row["title"] for row in results(public.get(f"{PUBLIC}announcements/"))}
        assert "Was a draft" in titles

    def test_without_publish_now_a_missing_time_stays_a_draft(self, api):
        response = api.post(
            f"{ADMIN}announcements/", {"title_en": "T", "body_en": "B"}, format="json"
        )
        assert response.json()["state"] == "draft"

    def test_translation_rules(self, api):
        for data, field in (
            ({"title_en": "Only title"}, "body_en"),
            ({"body_bn": "শুধু লেখা"}, "title_bn"),
            ({}, "title_bn"),
            ({"title_en": "   ", "body_en": "​"}, "title_bn"),
        ):
            response = api.post(f"{ADMIN}announcements/", data, format="json")
            assert response.status_code == 400, data
            assert field in errors(response)
        with pytest.raises(IntegrityError), transaction.atomic():
            Announcement.objects.bulk_create([Announcement(title_en="T", body_en="")])

    def test_window_validation(self, api):
        now = timezone.now()
        response = api.post(
            f"{ADMIN}announcements/",
            {
                "title_en": "T",
                "body_en": "B",
                "published_at": now.isoformat(),
                "expires_at": (now - timedelta(hours=1)).isoformat(),
            },
            format="json",
        )
        assert response.status_code == 400 and "expires_at" in errors(response)

    def test_public_visibility(self, public):
        now = timezone.now()
        live = announcement(title_en="Live", audience="public")
        everyone = announcement(title_en="Everyone", audience="all", is_pinned=True)
        announcement(title_en="Draft", published_at=None)
        announcement(title_en="Future", published_at=now + timedelta(hours=1))
        announcement(
            title_en="Expired",
            published_at=now - timedelta(days=2),
            expires_at=now - timedelta(days=1),
        )
        announcement(title_en="Students only", audience="students")
        body = public.get(f"{PUBLIC}announcements/", HTTP_ACCEPT_LANGUAGE="en").json()
        assert [row["title"] for row in body["results"]] == ["Everyone", "Live"]  # pinned first
        assert set(body["results"][0]) == {
            "title",
            "body",
            "is_pinned",
            "published_at",
            "expires_at",
        }
        assert {live.pk, everyone.pk}  # ids are not exposed
        assert "count" in body  # paginated

    def test_student_announcements(self, public):
        announcement(title_en="Public", audience="public")
        announcement(title_en="Students", audience="students")
        announcement(title_en="All", audience="all")
        client = jwt_client(make_student())
        titles = {row["title"] for row in results(client.get("/api/v1/announcements/"))}
        assert titles == {"Students", "All"}
        assert public.get("/api/v1/announcements/").status_code == 401

    def test_language_fallback(self, public):
        announcement(title_bn="", body_bn="", title_en="English only", body_en="EN body")
        announcement(
            title_bn="শুধু বাংলা",
            body_bn="বাংলা লেখা",
            title_en="",
            body_en="",
            published_at=timezone.now() - timedelta(minutes=5),
        )
        bn = results(public.get(f"{PUBLIC}announcements/", HTTP_ACCEPT_LANGUAGE="bn"))
        en = results(public.get(f"{PUBLIC}announcements/", HTTP_ACCEPT_LANGUAGE="en"))
        assert [r["title"] for r in bn] == ["English only", "শুধু বাংলা"]  # bn empty → en
        assert [r["title"] for r in en] == ["English only", "শুধু বাংলা"]  # en empty → bn

    def test_plain_text_never_interpreted(self, api, public):
        api.post(
            f"{ADMIN}announcements/",
            {
                "title_en": XSS,
                "body_en": XSS + "\x07\x1b",
                "published_at": timezone.now().isoformat(),
            },
            format="json",
        )
        row = results(public.get(f"{PUBLIC}announcements/"))[0]
        assert row["title"] == XSS  # stored as typed: clients render escaped
        assert row["body"] == XSS  # control characters removed
        assert public.get(f"{PUBLIC}announcements/")["Content-Type"].startswith("application/json")

    def test_admin_filters_reject_bad_values(self, api):
        announcement()
        assert api.get(f"{ADMIN}announcements/", {"audience": "x' OR 1=1"}).status_code == 400
        assert api.get(f"{ADMIN}announcements/", {"published": "maybe"}).status_code == 400
        assert api.get(f"{ADMIN}announcements/", {"ordering": "body_en"}).status_code == 400
        assert api.get(f"{ADMIN}announcements/", {"ordering": "-published_at"}).status_code == 200
        assert len(results(api.get(f"{ADMIN}announcements/", {"published": "true"}))) == 1
        assert results(api.get(f"{ADMIN}announcements/", {"search": "schedule"}))

    def test_admin_only(self, public):
        item = announcement()
        student = jwt_client(make_student())
        for client in (public, student):
            assert client.get(f"{ADMIN}announcements/").status_code in (401, 403)
            assert client.delete(f"{ADMIN}announcements/{item.pk}/").status_code in (401, 403)
        assert Announcement.objects.filter(pk=item.pk).exists()
        assert public.post(f"{PUBLIC}announcements/", {}, format="json").status_code == 405


# ======================================================================================
# FAQ
# ======================================================================================
class TestFaq:
    def test_crud_and_audit(self, api):
        response = api.post(
            f"{ADMIN}faqs/",
            {"question_en": "Q?", "answer_en": "A.", "sort_order": 3},
            format="json",
        )
        assert response.status_code == 201
        url = f"{ADMIN}faqs/{response.json()['id']}/"
        assert api.patch(url, {"is_active": False}, format="json").json()["is_active"] is False
        assert api.delete(url).status_code == 204
        assert AuditLog.objects.filter(entity_type="cms.faq").count() == 3

    def test_validation(self, api):
        assert api.post(f"{ADMIN}faqs/", {"question_en": "Q?"}, format="json").status_code == 400
        response = api.post(
            f"{ADMIN}faqs/",
            {"question_en": "Q?", "answer_en": "A.", "sort_order": -1},
            format="json",
        )
        assert response.status_code == 400 and "sort_order" in errors(response)
        with pytest.raises(IntegrityError), transaction.atomic():
            Faq.objects.bulk_create([Faq(question_en="Q", answer_en="A", sort_order=-1)])

    def test_public_order_active_and_fallback(self, public):
        faq(question_en="Second", sort_order=2)
        faq(question_en="First", sort_order=1)
        faq(question_en="Hidden", sort_order=0, is_active=False)
        faq(question_bn="বাংলা প্রশ্ন", answer_bn="উত্তর", question_en="", answer_en="", sort_order=3)
        rows = results(public.get(f"{PUBLIC}faqs/", HTTP_ACCEPT_LANGUAGE="en"))
        assert [r["question"] for r in rows] == ["First", "Second", "বাংলা প্রশ্ন"]
        assert set(rows[0]) == {"question", "answer"}
        bn = results(public.get(f"{PUBLIC}faqs/", HTTP_ACCEPT_LANGUAGE="bn"))
        assert bn[0]["question"] == "First"  # bn empty → en


# ======================================================================================
# Pages
# ======================================================================================
class TestPages:
    def test_crud_slug_rules(self, api):
        response = api.post(
            f"{ADMIN}pages/",
            {"slug": " About ", "title_en": "About", "body_en": "Text"},
            format="json",
        )
        assert response.status_code == 201 and response.json()["slug"] == "about"
        duplicate = api.post(
            f"{ADMIN}pages/", {"slug": "about", "title_en": "X", "body_en": "Y"}, format="json"
        )
        assert duplicate.status_code == 400 and "slug" in errors(duplicate)
        for bad in ("Terms Page", "terms_", "../etc", "<x>", ""):
            response = api.post(
                f"{ADMIN}pages/", {"slug": bad, "title_en": "X", "body_en": "Y"}, format="json"
            )
            assert response.status_code == 400 and "slug" in errors(response), bad
        assert AuditLog.objects.filter(action="page.create").count() == 1

    def test_public_fetch_and_404s(self, public):
        page("about", title_bn="আমাদের সম্পর্কে", body_bn="বিস্তারিত")
        page("terms", is_active=False)
        response = public.get(f"{PUBLIC}pages/about/", HTTP_ACCEPT_LANGUAGE="bn")
        assert response.status_code == 200
        assert set(response.json()) == {"slug", "title", "body", "updated_at"}
        assert response.json()["title"] == "আমাদের সম্পর্কে"
        assert (
            public.get(f"{PUBLIC}pages/about/", HTTP_ACCEPT_LANGUAGE="en").json()["title"]
            == "About us"
        )
        assert public.get(f"{PUBLIC}pages/terms/").status_code == 404  # inactive
        assert public.get(f"{PUBLIC}pages/missing/").status_code == 404

    def test_database_slug_guards(self):
        page("privacy")
        with pytest.raises(IntegrityError), transaction.atomic():
            Page.objects.bulk_create([Page(slug="privacy", title_en="X", body_en="Y")])
        with pytest.raises(IntegrityError), transaction.atomic():
            Page.objects.bulk_create([Page(slug="Bad Slug", title_en="X", body_en="Y")])

    def test_model_validation_shared(self):
        with pytest.raises(ValidationError):
            Page(slug="x", title_en="Only title").full_clean()


# ======================================================================================
# Contact form
# ======================================================================================
VALID = {
    "name": "Rahim Hossain",
    "phone": "০১৭১২-৩৪৫৬৭৮",
    "email": "",
    "subject": "Payment question",
    "message": "I paid but cannot see the package.",
}


class TestContactForm:
    def test_valid_submission(self, public, caplog):
        with caplog.at_level(logging.DEBUG):
            response = public.post(
                f"{PUBLIC}contact/",
                {**VALID, "status": "resolved", "handled_by": 1},
                format="json",
                HTTP_ACCEPT_LANGUAGE="en",
                REMOTE_ADDR="203.0.113.7",
            )
        assert response.status_code == 202 and response.json() == {"status": "received"}
        message = ContactMessage.objects.get()
        assert message.phone == "01712-345678"  # Bangla digits normalized
        assert message.status == "new" and message.handled_by is None  # not client-settable
        assert message.language == "en" and message.ip_address == "203.0.113.7"
        for private in ("Rahim", "01712", "Payment question", "cannot see"):
            assert private not in caplog.text

    def test_normalization(self, public):
        public.post(
            f"{PUBLIC}contact/",
            {
                "name": "  Karim\u0007  Uddin ",
                "email": " KARIM@Example.com ",
                "subject": "Hi\tthere",
                "message": "line1\r\nline2\x07",
            },
            format="json",
        )
        message = ContactMessage.objects.get()
        assert message.name == "Karim Uddin" and message.email == "karim@example.com"
        assert message.subject == "Hi there" and message.message == "line1\nline2"

    @pytest.mark.parametrize(
        ("override", "field"),
        [
            ({"name": ""}, "name"),
            ({"name": "​  "}, "name"),
            ({"name": "x" * 121}, "name"),
            ({"subject": ""}, "subject"),
            ({"subject": "s" * 151}, "subject"),
            ({"message": " \n "}, "message"),
            ({"message": "m" * 5001}, "message"),
            ({"phone": "", "email": ""}, "phone"),
            ({"phone": "call me"}, "phone"),
            ({"phone": "1234567890123456789012"}, "phone"),
            ({"phone": "", "email": "not-an-email"}, "email"),
            ({"name": ["list"]}, "name"),
        ],
    )
    def test_invalid_input(self, public, override, field):
        response = public.post(f"{PUBLIC}contact/", {**VALID, **override}, format="json")
        assert response.status_code == 400
        assert field in errors(response)
        assert not ContactMessage.objects.exists()

    def test_nul_characters_rejected(self, public):
        response = public.post(f"{PUBLIC}contact/", {**VALID, "name": "A\x00B"}, format="json")
        assert response.status_code == 400 and "name" in errors(response)

    def test_html_is_stored_as_text(self, public):
        public.post(f"{PUBLIC}contact/", {**VALID, "message": XSS}, format="json")
        assert ContactMessage.objects.get().message == XSS  # plain text; escaped on display

    def test_honeypot_stores_nothing(self, public, caplog):
        with caplog.at_level(logging.INFO):
            response = public.post(
                f"{PUBLIC}contact/", {**VALID, "website": "http://spam.example"}, format="json"
            )
        assert response.status_code == 202 and response.json() == {"status": "received"}
        assert not ContactMessage.objects.exists()
        assert "honeypot" in caplog.text and "spam.example" not in caplog.text

    def test_throttled_per_ip(self, settings, public):
        settings.AUTH_THROTTLE_RATES = {**settings.AUTH_THROTTLE_RATES, "contact_form": "3/hour"}
        codes = [
            public.post(
                f"{PUBLIC}contact/", VALID, format="json", REMOTE_ADDR="198.51.100.1"
            ).status_code
            for _ in range(4)
        ]
        assert codes == [202, 202, 202, 429]
        # Invalid and honeypot submissions count too (no free retries for spammers).
        other = [
            public.post(
                f"{PUBLIC}contact/", body, format="json", REMOTE_ADDR="198.51.100.2"
            ).status_code
            for body in ({}, {**VALID, "website": "x"}, VALID, VALID)
        ]
        assert other == [400, 202, 202, 429]
        # Another IP is unaffected; a spoofed X-Forwarded-For is ignored.
        assert (
            public.post(
                f"{PUBLIC}contact/",
                VALID,
                format="json",
                REMOTE_ADDR="198.51.100.1",
                HTTP_X_FORWARDED_FOR="10.0.0.9",
            ).status_code
            == 429
        )
        assert (
            public.post(
                f"{PUBLIC}contact/", VALID, format="json", REMOTE_ADDR="198.51.100.3"
            ).status_code
            == 202
        )
        assert ContactMessage.objects.count() == 5

    def test_form_encoded_and_get_rejected(self, public):
        assert public.get(f"{PUBLIC}contact/").status_code == 405
        response = public.post(f"{PUBLIC}contact/", "name=x", content_type="text/plain")
        assert response.status_code == 415

    def test_public_cannot_read_inbox(self, public):
        public.post(f"{PUBLIC}contact/", VALID, format="json")
        message = ContactMessage.objects.get()
        student = jwt_client(make_student())
        for client in (public, student):
            assert client.get(f"{ADMIN}contact-messages/").status_code in (401, 403)
            assert client.get(f"{ADMIN}contact-messages/{message.pk}/").status_code in (401, 403)
            assert client.patch(
                f"{ADMIN}contact-messages/{message.pk}/", {"status": "read"}, format="json"
            ).status_code in (401, 403)
        assert ContactMessage.objects.get().status == "new"

    def test_database_guards(self):
        with pytest.raises(IntegrityError), transaction.atomic():
            ContactMessage.objects.create(
                name="X", subject="S", message="M", language="bn"
            )  # neither phone nor email
        with pytest.raises(IntegrityError), transaction.atomic():
            ContactMessage.objects.create(
                name="X", email="a@b.c", subject="S", message="M", language="fr"
            )
        with pytest.raises(IntegrityError), transaction.atomic():
            ContactMessage.objects.create(
                name="X", email="a@b.c", subject="S", message="m" * 5001, language="bn"
            )


# ======================================================================================
# Admin contact inbox
# ======================================================================================
class TestContactInbox:
    def submit(self, public, **override):
        public.post(f"{PUBLIC}contact/", {**VALID, **override}, format="json")
        return ContactMessage.objects.order_by("-id").first()

    def test_list_detail_never_shows_ip(self, api, public):
        message = self.submit(public, email="r@example.org")
        rows = results(api.get(f"{ADMIN}contact-messages/"))
        assert rows[0]["id"] == message.pk
        detail = api.get(f"{ADMIN}contact-messages/{message.pk}/").json()
        assert "ip_address" not in json.dumps(detail) and "127.0.0.1" not in json.dumps(detail)
        assert detail["email"] == "r@example.org" and detail["status"] == "new"

    def test_status_change_is_audited(self, api, public, admin_user):
        message = self.submit(public)
        url = f"{ADMIN}contact-messages/{message.pk}/"
        response = api.patch(url, {"status": "read"}, format="json")
        assert response.status_code == 200
        assert response.json()["handled_by"] == {"id": admin_user.pk, "full_name": "Ops"}
        api.patch(url, {"status": "read"}, format="json")  # no-op
        api.patch(url, {"status": "resolved"}, format="json")
        entries = AuditLog.objects.filter(action="contact_message.status").order_by("id")
        assert [e.metadata["changes"]["status"] for e in entries] == [
            {"from": "new", "to": "read"},
            {"from": "read", "to": "resolved"},
        ]
        for entry in entries:  # no contact details in the audit log
            assert "Rahim" not in json.dumps(entry.metadata) + entry.summary

    def test_only_status_is_writable(self, api, public):
        message = self.submit(public)
        url = f"{ADMIN}contact-messages/{message.pk}/"
        response = api.patch(url, {"status": "archived"}, format="json")
        assert response.status_code == 400
        response = api.patch(url, {"status": "read", "message": "edited"}, format="json")
        assert response.status_code == 200
        assert ContactMessage.objects.get(pk=message.pk).message == VALID["message"]
        assert api.delete(url).status_code == 405
        assert api.put(url, {"status": "read"}, format="json").status_code == 405
        assert api.post(f"{ADMIN}contact-messages/", VALID, format="json").status_code == 405

    def test_filters_and_search(self, api, public):
        self.submit(public, subject="Refund", email="a@example.org", phone="")
        second = self.submit(public, subject="Login problem")
        services.set_contact_status(second.pk, "resolved", ctx=CTX)
        assert len(results(api.get(f"{ADMIN}contact-messages/", {"status": "new"}))) == 1
        assert len(results(api.get(f"{ADMIN}contact-messages/", {"search": "refund"}))) == 1
        assert len(results(api.get(f"{ADMIN}contact-messages/", {"search": "a@example"}))) == 1
        for params in (
            {"status": "new' OR '1'='1"},
            {"language": "de"},
            {"ordering": "ip_address"},
            {"search": "x" * 101},
        ):
            assert api.get(f"{ADMIN}contact-messages/", params).status_code == 400

    def test_csrf_and_unknown_id(self, admin_user, public):
        message = self.submit(public)
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(admin_user)
        url = f"{ADMIN}contact-messages/{message.pk}/"
        assert client.patch(url, {"status": "read"}, format="json").status_code == 403
        api = APIClient()
        api.force_login(admin_user)
        assert api.get(f"{ADMIN}contact-messages/999999/").status_code == 404
        assert ContactMessage.objects.get().status == "new"


# ======================================================================================
# Cross-cutting
# ======================================================================================
def test_bangla_validation_message(public):
    response = public.post(
        f"{PUBLIC}contact/",
        {**VALID, "phone": "", "email": ""},
        format="json",
        HTTP_ACCEPT_LANGUAGE="bn",
    )
    assert response.json()["error"]["field_errors"]["phone"] == [
        "উত্তর দেওয়ার জন্য একটি ফোন নম্বর বা ই-মেইল ঠিকানা দিন।"
    ]


def test_public_endpoints_never_leak_drafts_or_admin_fields(public):
    announcement(title_en="Draft secret", published_at=None)
    faq(question_en="Hidden FAQ", is_active=False)
    page("hidden", title_en="Hidden page", is_active=False)
    public.post(f"{PUBLIC}contact/", VALID, format="json")
    text = "".join(
        public.get(f"{PUBLIC}{path}").content.decode()
        for path in ("announcements/", "faqs/", "settings/", "app-links/")
    )
    for leaked in (
        "Draft secret",
        "Hidden FAQ",
        "Hidden page",
        "Rahim",
        "created_at",
        "handled_by",
        "ip_address",
        "leaderboard",
        '"id"',
    ):
        assert leaked not in text
