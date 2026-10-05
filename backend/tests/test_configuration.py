from io import StringIO
from unittest import mock

import pytest
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.core.management import call_command
from django.core.management.base import CommandError

from config.celery import app as celery_app
from config.settings.checks import validate_production_settings

GOOD = {
    "secret_key": "x" * 60,
    "debug": False,
    "allowed_hosts": ["api.example.com"],
    "db_password": "a-real-password",
}


def test_postgresql_is_the_database():
    assert settings.DATABASES["default"]["ENGINE"] == "django.db.backends.postgresql"


def test_languages_and_defaults():
    assert [code for code, _ in settings.LANGUAGES] == ["bn", "en"]
    assert settings.LANGUAGE_CODE == "bn"
    assert settings.ADMIN_DEFAULT_LANGUAGE == "en"
    assert settings.USE_I18N is True


def test_time_is_stored_in_utc():
    assert settings.USE_TZ is True
    assert settings.TIME_ZONE == "UTC"


def test_celery_reads_broker_from_django_settings():
    assert celery_app.main == "online_mcq"
    assert celery_app.conf.broker_url == settings.CELERY_BROKER_URL


def test_production_settings_accept_safe_values():
    validate_production_settings(**GOOD)


@pytest.mark.parametrize(
    "override",
    [
        {"secret_key": "change-me"},
        {"secret_key": "too-short"},
        {"debug": True},
        {"allowed_hosts": []},
        {"allowed_hosts": ["*"]},
        {"db_password": "change-me"},
    ],
)
def test_production_settings_reject_unsafe_values(override):
    with pytest.raises(ImproperlyConfigured):
        validate_production_settings(**{**GOOD, **override})


def test_custom_user_model_is_active():
    from django.contrib.auth import get_user_model

    from apps.accounts.models import User

    assert settings.AUTH_USER_MODEL == "accounts.User"
    assert get_user_model() is User


def test_migrate_guard_still_blocks_the_default_user_model(settings):
    # Protects against anyone switching back to Django's default user model.
    settings.AUTH_USER_MODEL = "auth.User"
    with pytest.raises(CommandError, match="custom User model"):
        call_command("migrate", verbosity=0)


@pytest.mark.django_db
def test_migrate_runs_normally_with_the_custom_user_model():
    # The test database was created by this same command; running it again is a no-op.
    out = StringIO()
    call_command("migrate", "--check", stdout=out)  # exits non-zero if anything is unapplied


@pytest.mark.django_db
def test_no_missing_migrations():
    call_command("makemigrations", "--check", "--dry-run", verbosity=0)


def test_migrate_guard_is_a_thin_wrapper_around_django_migrate():
    from django.core.management import load_command_class
    from django.core.management.commands.migrate import Command as DjangoMigrateCommand

    command = load_command_class("apps.core", "migrate")
    assert isinstance(command, DjangoMigrateCommand)  # keeps every normal migrate option


def test_migrate_delegates_to_django_once_custom_user_model_is_set(settings):
    # Simulates Milestone 2 (AUTH_USER_MODEL = "accounts.User"): the guard must step aside.
    settings.AUTH_USER_MODEL = "accounts.User"
    with mock.patch(
        "django.core.management.commands.migrate.Command.handle", return_value=None
    ) as django_handle:
        call_command("migrate", "--plan", verbosity=0)

    django_handle.assert_called_once()
    assert django_handle.call_args.kwargs["plan"] is True


def test_check_services_reports_success():
    out = StringIO()
    with (
        mock.patch("apps.core.management.commands.check_services.connection") as conn,
        mock.patch("apps.core.management.commands.check_services.redis.Redis.from_url") as from_url,
    ):
        call_command("check_services", stdout=out)

    conn.cursor.return_value.__enter__.return_value.execute.assert_called_once_with("SELECT 1")
    assert from_url.return_value.ping.call_count == 2
    assert "PostgreSQL: OK" in out.getvalue()


def test_check_services_fails_when_redis_is_down():
    with (
        mock.patch("apps.core.management.commands.check_services.connection"),
        mock.patch(
            "apps.core.management.commands.check_services.redis.Redis.from_url",
            side_effect=ConnectionError,
        ),
        pytest.raises(CommandError, match="Redis"),
    ):
        call_command("check_services", stdout=StringIO())
