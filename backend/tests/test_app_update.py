"""The "update the app" notice: admin settings, the server's version decision, and the
public endpoint the app and the website read."""

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.audit.models import AuditLog
from apps.cms.app_version import parse_version, update_state
from apps.cms.models import SiteSettings

pytestmark = pytest.mark.django_db

ADMIN = "/api/v1/admin/settings/"
UPDATE = "/api/v1/public/app-update/"
APK = "https://files.example.org/live-model-test-0.2.0.apk"
PLAY = "https://play.google.com/store/apps/details?id=com.livemodeltest.app"


@pytest.fixture(autouse=True)
def _clear():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def api():
    admin = User.objects.create_user(
        "01612345679", password="Strong-Pass-2026", full_name="Ops", role=Role.ADMIN
    )
    client = APIClient()
    client.force_login(admin)
    return client


def configure(api, **fields):
    response = api.patch(ADMIN, fields, format="json")
    assert response.status_code == 200, response.json()
    return response


def check(version=None, lang="en"):
    params = {"version": version} if version is not None else {}
    return APIClient().get(UPDATE, params, HTTP_ACCEPT_LANGUAGE=lang).json()


class TestVersionRule:
    @pytest.mark.parametrize(
        ("text", "parsed"),
        [("1.2.3", (1, 2, 3)), ("0.1.0", (0, 1, 0)), (" 10.0.5 ", (10, 0, 5))],
    )
    def test_parse(self, text, parsed):
        assert parse_version(text) == parsed

    @pytest.mark.parametrize(
        "text", ["", None, "1.2", "v1.2.3", "1.2.3-beta", "1.2.x", "1..3", "99999.0.0"]
    )
    def test_malformed_is_not_a_version(self, text):
        assert parse_version(text) is None

    def test_numeric_not_text_comparison(self):
        # "0.10.0" is newer than "0.9.0" (a text compare would say the opposite)
        assert update_state("0.9.0", "0.10.0", "")["update_available"] is True
        assert update_state("0.10.0", "0.9.0", "")["update_available"] is False

    def test_states(self):
        assert update_state("0.1.0", "0.2.0", "") == {
            "update_available": True,
            "update_required": False,
        }
        assert update_state("0.2.0", "0.2.0", "") == {
            "update_available": False,
            "update_required": False,
        }
        assert update_state("0.3.0", "0.2.0", "") == {
            "update_available": False,
            "update_required": False,
        }
        assert update_state("0.1.0", "0.3.0", "0.2.0") == {
            "update_available": True,
            "update_required": True,
        }
        assert update_state("0.2.0", "0.3.0", "0.2.0") == {
            "update_available": True,
            "update_required": False,
        }

    def test_unset_versions_switch_the_notice_off(self):
        assert update_state("0.1.0", "", "") == {
            "update_available": False,
            "update_required": False,
        }

    def test_unknown_running_version_never_alarms(self):
        for running in (None, "", "garbage"):
            assert update_state(running, "9.9.9", "9.9.9") == {
                "update_available": False,
                "update_required": False,
            }

    def test_minimum_alone_can_force(self):
        assert update_state("0.1.0", "", "0.2.0")["update_required"] is True


class TestAdminSettings:
    def test_saved_and_audited(self, api):
        configure(
            api,
            app_download_url=APK,
            app_latest_version="0.2.0",
            app_min_version="0.1.0",
            app_update_note_en="Bug fixes.",
            app_update_note_bn="ত্রুটি সংশোধন।",
        )
        row = SiteSettings.objects.get()
        assert (row.app_latest_version, row.app_min_version) == ("0.2.0", "0.1.0")
        entry = AuditLog.objects.filter(action="site_settings.update").latest("id")
        assert "app_latest_version" in entry.metadata["changed_fields"]

    @pytest.mark.parametrize("value", ["v1.0", "1.0", "1.0.0-beta", "latest", "1.0.0.0", "<b>"])
    def test_bad_versions_refused(self, api, value):
        response = api.patch(ADMIN, {"app_latest_version": value}, format="json")
        assert response.status_code == 400
        assert "app_latest_version" in response.json()["error"]["field_errors"]

    def test_minimum_cannot_be_newer_than_latest(self, api):
        response = api.patch(
            ADMIN, {"app_latest_version": "0.2.0", "app_min_version": "0.3.0"}, format="json"
        )
        assert response.status_code == 400
        assert "app_min_version" in response.json()["error"]["field_errors"]
        assert not SiteSettings.objects.exists()

    def test_the_notice_can_be_switched_off_again(self, api):
        configure(api, app_download_url=APK, app_latest_version="0.2.0")
        configure(api, app_latest_version="", app_min_version="")
        assert check("0.1.0")["update_available"] is False

    def test_only_admins_can_change_it(self):
        assert APIClient().patch(
            ADMIN, {"app_latest_version": "9.9.9"}, format="json"
        ).status_code in (401, 403)


class TestPublicEndpoint:
    def test_nothing_configured(self):
        assert check("0.1.0") == {
            "latest_version": "",
            "min_version": "",
            "download_url": "",
            "note": "",
            "update_available": False,
            "update_required": False,
        }

    def test_update_available_with_localized_note(self, api):
        configure(
            api,
            app_download_url=APK,
            app_latest_version="0.2.0",
            app_update_note_en="Bug fixes.",
            app_update_note_bn="ত্রুটি সংশোধন।",
        )
        english = check("0.1.0", "en")
        assert english["update_available"] is True and english["update_required"] is False
        assert english["download_url"] == APK and english["note"] == "Bug fixes."
        assert check("0.1.0", "bn")["note"] == "ত্রুটি সংশোধন।"

    def test_up_to_date_app_is_left_alone(self, api):
        configure(api, app_download_url=APK, app_latest_version="0.2.0")
        assert check("0.2.0")["update_available"] is False
        assert check("0.3.0")["update_available"] is False

    def test_required_update(self, api):
        configure(api, app_download_url=APK, app_latest_version="0.3.0", app_min_version="0.2.0")
        old = check("0.1.0")
        assert old["update_required"] is True and old["update_available"] is True
        assert check("0.2.0")["update_required"] is False

    def test_no_link_means_no_notice_so_nobody_is_stuck(self, api):
        configure(api, app_latest_version="0.3.0", app_min_version="0.3.0")
        state = check("0.1.0")
        assert state["update_available"] is False and state["update_required"] is False

    def test_missing_or_bad_version_param_never_alarms(self, api):
        configure(api, app_download_url=APK, app_latest_version="0.3.0", app_min_version="0.3.0")
        for version in (None, "", "banana", "0.1"):
            assert check(version)["update_available"] is False

    def test_moving_to_google_play_changes_only_the_link(self, api):
        configure(api, app_download_url=APK, app_latest_version="0.2.0")
        configure(api, app_download_url=PLAY)
        notice = check("0.1.0")
        assert notice["download_url"] == PLAY and notice["update_available"] is True

    def test_public_and_cacheable_without_login(self):
        response = APIClient().get(UPDATE, {"version": "0.1.0"})
        assert response.status_code == 200
