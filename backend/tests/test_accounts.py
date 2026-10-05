from io import StringIO
from unittest import mock

import pytest
from django.contrib.auth import authenticate, get_user_model
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, transaction
from django.db.migrations.loader import MigrationLoader
from django.test import override_settings

from apps.accounts.models import Role, StudentProfile, User

pytestmark = pytest.mark.django_db

PASSWORD = "Correct-Horse-91"  # test-only value


def make_user(mobile="01712345678", **extra):
    extra.setdefault("full_name", "Test Student")
    return User.objects.create_user(mobile, password=PASSWORD, **extra)


# --------------------------------------------------------------------------------------
# Creating users
# --------------------------------------------------------------------------------------
class TestCreateUser:
    def test_creates_a_student_with_safe_defaults(self):
        user = make_user()

        assert user.pk is not None
        assert user.mobile_number == "+8801712345678"
        assert user.role == Role.STUDENT
        assert user.is_student and not user.is_admin
        assert user.preferred_language == "bn"
        assert user.is_active is True
        assert user.is_staff is False
        assert user.is_superuser is False
        assert user.email is None
        assert user.date_joined is not None

    def test_password_is_hashed_never_plain_text(self):
        user = make_user()
        user.refresh_from_db()

        assert user.password != PASSWORD
        assert PASSWORD not in user.password
        assert user.check_password(PASSWORD)
        assert not user.check_password("wrong-password")

    @override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.Argon2PasswordHasher"])
    def test_production_hasher_is_argon2(self):
        user = make_user()
        assert user.password.startswith("argon2$")

    def test_manager_uses_set_password(self):
        real_set_password = User.set_password
        with mock.patch.object(
            User, "set_password", autospec=True, side_effect=real_set_password
        ) as set_password:
            make_user()
        set_password.assert_called_once()
        assert set_password.call_args.args[1] == PASSWORD

    def test_without_password_the_account_cannot_log_in(self):
        user = User.objects.create_user("01712345678", full_name="No Password")

        assert user.has_usable_password() is False
        assert authenticate(mobile_number="01712345678", password="") is None

    @pytest.mark.parametrize("missing", ["", None])
    def test_mobile_number_is_required(self, missing):
        with pytest.raises(ValueError):
            User.objects.create_user(missing, password=PASSWORD, full_name="X")
        assert User.objects.count() == 0

    @pytest.mark.parametrize("bad", ["12345", "01212345678", "+15551234567", "hello"])
    def test_invalid_mobile_numbers_are_rejected(self, bad):
        with pytest.raises(ValidationError) as exc:
            make_user(bad)
        assert "mobile_number" in exc.value.message_dict
        assert User.objects.count() == 0

    def test_full_name_is_required(self):
        with pytest.raises(ValidationError) as exc:
            User.objects.create_user("01712345678", password=PASSWORD, full_name="")
        assert "full_name" in exc.value.message_dict

    def test_text_is_unicode_normalized(self):
        user = make_user(full_name="  রহিম  ")
        assert user.full_name == "রহিম"


class TestMobileNumber:
    @pytest.mark.parametrize(
        "raw", ["01712345678", "+8801712345678", "8801712345678", "০১৭১২৩৪৫৬৭৮", "017-1234-5678"]
    )
    def test_every_accepted_format_is_stored_the_same_way(self, raw):
        assert make_user(raw).mobile_number == "+8801712345678"

    def test_mobile_number_is_unique_across_formats(self):
        make_user("01712345678")
        with pytest.raises(ValidationError) as exc:
            make_user("+880 1712-345678")
        assert "mobile_number" in exc.value.message_dict

    def test_database_enforces_uniqueness_too(self):
        make_user("01712345678")
        with pytest.raises(IntegrityError), transaction.atomic():
            User(mobile_number="+8801712345678", full_name="Dup").save()

    def test_lookups_normalize_the_input(self):
        user = make_user("01712345678")
        assert User.objects.get(mobile_number="০১৭১২৩৪৫৬৭৮") == user
        assert User.objects.get_by_natural_key("8801712345678") == user

    def test_database_rejects_non_e164_values(self):
        user = make_user()
        with pytest.raises(IntegrityError), transaction.atomic():
            User.objects.filter(pk=user.pk).update(mobile_number="12345")


class TestEmail:
    def test_email_is_optional(self):
        make_user("01712345678")
        make_user("01812345678")  # two users without email are fine
        make_user("01912345678", email="")  # empty string is stored as NULL
        assert User.objects.filter(email__isnull=True).count() == 3

    def test_email_is_lower_cased_and_trimmed(self):
        assert make_user(email="  Student@Example.COM ").email == "student@example.com"

    def test_email_is_unique_when_provided_case_insensitive(self):
        make_user("01712345678", email="student@example.com")
        with pytest.raises(ValidationError):
            make_user("01812345678", email="STUDENT@example.com")

    def test_database_enforces_case_insensitive_email_uniqueness(self):
        make_user("01712345678", email="student@example.com")
        other = make_user("01812345678")
        with pytest.raises(IntegrityError), transaction.atomic():
            User.objects.filter(pk=other.pk).update(email="Student@Example.com")

    def test_invalid_email_is_rejected(self):
        with pytest.raises(ValidationError) as exc:
            make_user(email="not-an-email")
        assert "email" in exc.value.message_dict


class TestRolesAndLanguage:
    def test_supported_roles(self):
        assert set(Role.values) == {"student", "admin"}

    def test_admin_role_can_be_assigned(self):
        user = make_user(role=Role.ADMIN)
        assert user.is_admin and not user.is_student

    def test_unknown_role_is_rejected(self):
        with pytest.raises(ValidationError) as exc:
            make_user(role="moderator")
        assert "role" in exc.value.message_dict

    def test_database_rejects_unknown_role(self):
        user = make_user()
        with pytest.raises(IntegrityError), transaction.atomic():
            User.objects.filter(pk=user.pk).update(role="superhero")

    def test_default_student_language_is_bangla(self):
        assert make_user().preferred_language == "bn"

    @override_settings(LANGUAGE_CODE="en")
    def test_default_language_comes_from_configuration(self):
        assert make_user().preferred_language == "en"

    def test_english_can_be_chosen(self):
        assert make_user(preferred_language="en").preferred_language == "en"

    def test_unsupported_language_is_rejected(self):
        with pytest.raises(ValidationError) as exc:
            make_user(preferred_language="fr")
        assert "preferred_language" in exc.value.message_dict

    def test_database_rejects_unsupported_language(self):
        user = make_user()
        with pytest.raises(IntegrityError), transaction.atomic():
            User.objects.filter(pk=user.pk).update(preferred_language="fr")


# --------------------------------------------------------------------------------------
# Superusers
# --------------------------------------------------------------------------------------
class TestCreateSuperuser:
    def test_creates_an_admin_with_staff_and_superuser_flags(self):
        admin = User.objects.create_superuser("01812345678", PASSWORD, full_name="Ops Admin")

        assert admin.role == Role.ADMIN
        assert admin.is_staff and admin.is_superuser and admin.is_active
        assert admin.preferred_language == "en"  # Admin default language
        assert admin.check_password(PASSWORD)
        assert not StudentProfile.objects.filter(user=admin).exists()

    def test_password_is_required(self):
        with pytest.raises(ValueError):
            User.objects.create_superuser("01812345678", None, full_name="Ops Admin")

    @pytest.mark.parametrize(
        "override", [{"is_staff": False}, {"is_superuser": False}, {"role": Role.STUDENT}]
    )
    def test_inconsistent_flags_are_rejected(self, override):
        with pytest.raises(ValueError):
            User.objects.create_superuser("01812345678", PASSWORD, full_name="X", **override)

    def test_createsuperuser_command_non_interactive(self, monkeypatch):
        monkeypatch.setenv("DJANGO_SUPERUSER_MOBILE_NUMBER", "০১৮১২৩৪৫৬৭৮")
        monkeypatch.setenv("DJANGO_SUPERUSER_FULL_NAME", "Ops Admin")
        monkeypatch.setenv("DJANGO_SUPERUSER_PASSWORD", PASSWORD)

        call_command("createsuperuser", interactive=False, stdout=StringIO())

        admin = User.objects.get(mobile_number="+8801812345678")
        assert admin.is_superuser and admin.check_password(PASSWORD)

    def test_createsuperuser_command_interactive_prompts_for_mobile_number(self):
        answers = iter(["01812345678", "Interactive Admin"])
        prompts = []

        def fake_input(prompt=""):
            prompts.append(prompt)
            return next(answers)

        class FakeTTY(StringIO):
            def isatty(self):  # createsuperuser only prompts on a real terminal
                return True

        from django.utils import translation

        with (
            translation.override("en"),
            mock.patch("builtins.input", fake_input),
            mock.patch("getpass.getpass", return_value=PASSWORD),
        ):
            call_command("createsuperuser", interactive=True, stdout=StringIO(), stdin=FakeTTY())

        assert any("Mobile number" in p for p in prompts)
        assert User.objects.get(mobile_number="+8801812345678").is_superuser

    def test_createsuperuser_prompt_is_translated(self):
        from django.utils import translation

        with translation.override("bn"):
            assert str(User._meta.get_field("mobile_number").verbose_name) == "মোবাইল নম্বর"

    def test_createsuperuser_rejects_invalid_mobile(self, monkeypatch):
        monkeypatch.setenv("DJANGO_SUPERUSER_MOBILE_NUMBER", "12345")
        monkeypatch.setenv("DJANGO_SUPERUSER_FULL_NAME", "Ops Admin")
        monkeypatch.setenv("DJANGO_SUPERUSER_PASSWORD", PASSWORD)

        with pytest.raises(CommandError):
            call_command("createsuperuser", interactive=False, stdout=StringIO())
        assert User.objects.count() == 0


# --------------------------------------------------------------------------------------
# Student profile
# --------------------------------------------------------------------------------------
class TestStudentProfile:
    def test_students_get_a_profile_automatically(self):
        user = make_user()
        assert isinstance(user.student_profile, StudentProfile)
        assert user.student_profile.display_name == ""

    def test_profile_is_one_to_one(self):
        user = make_user()
        with pytest.raises(IntegrityError), transaction.atomic():
            StudentProfile.objects.create(user=user)

    def test_ensure_student_profile_is_idempotent(self):
        user = make_user()
        user.ensure_student_profile()
        user.ensure_student_profile()
        assert StudentProfile.objects.filter(user=user).count() == 1

    def test_admins_do_not_get_a_student_profile(self):
        admin = make_user(role=Role.ADMIN)
        assert not StudentProfile.objects.filter(user=admin).exists()

    def test_display_name_is_normalized(self):
        profile = make_user().student_profile
        profile.display_name = "  Star Learner  "
        profile.save()
        profile.refresh_from_db()
        assert profile.display_name == "Star Learner"

    def test_profile_is_deleted_with_its_user(self):
        user = make_user()
        user.delete()
        assert StudentProfile.objects.count() == 0


# --------------------------------------------------------------------------------------
# Django authentication compatibility & security
# --------------------------------------------------------------------------------------
class TestAuthentication:
    def test_get_user_model_is_the_custom_model(self):
        assert get_user_model() is User
        assert User.USERNAME_FIELD == "mobile_number"
        assert User.EMAIL_FIELD == "email"

    @pytest.mark.parametrize("login", ["01712345678", "+8801712345678", "০১৭১২৩৪৫৬৭৮"])
    def test_authenticate_with_any_accepted_mobile_format(self, login):
        user = make_user()
        assert authenticate(mobile_number=login, password=PASSWORD) == user

    @pytest.mark.parametrize("bad_login", ["not-a-number", "12345", ""])
    def test_invalid_mobile_login_fails_quietly(self, bad_login):
        make_user()
        assert authenticate(mobile_number=bad_login, password=PASSWORD) is None
        assert not User.objects.filter(mobile_number=bad_login).exists()

    def test_wrong_password_fails(self):
        make_user()
        assert authenticate(mobile_number="01712345678", password="wrong") is None

    def test_inactive_users_cannot_authenticate(self):
        user = make_user()
        user.is_active = False
        user.save()
        assert authenticate(mobile_number="01712345678", password=PASSWORD) is None

    def test_inactive_user_cannot_use_django_admin(self, client):
        admin = User.objects.create_superuser("01812345678", PASSWORD, full_name="Ops")
        admin.is_active = False
        admin.save()
        assert client.login(mobile_number="01812345678", password=PASSWORD) is False

    def test_string_representation_never_contains_secrets(self):
        user = make_user(email="s@example.com")
        assert str(user) == "+8801712345678"
        assert user.password not in str(user) and user.password not in repr(user)


class TestDjangoAdmin:
    @pytest.fixture
    def admin_client(self, client):
        User.objects.create_superuser("01812345678", PASSWORD, full_name="Ops")
        client.login(mobile_number="01812345678", password=PASSWORD)
        return client

    def test_students_cannot_access_django_admin(self, client):
        make_user()
        client.login(mobile_number="01712345678", password=PASSWORD)
        response = client.get("/django-admin/accounts/user/")
        assert response.status_code == 302  # redirected to the admin login page

    def test_admin_pages_load(self, admin_client):
        assert admin_client.get("/django-admin/accounts/user/").status_code == 200
        assert admin_client.get("/django-admin/accounts/user/add/").status_code == 200
        assert admin_client.get("/django-admin/accounts/studentprofile/").status_code == 200

    def test_change_page_never_shows_the_password(self, admin_client):
        student = make_user()
        page = admin_client.get(f"/django-admin/accounts/user/{student.pk}/change/")
        assert page.status_code == 200
        assert PASSWORD.encode() not in page.content

    def test_creating_a_student_in_admin_hashes_password_and_creates_profile(self, admin_client):
        response = admin_client.post(
            "/django-admin/accounts/user/add/",
            {
                "mobile_number": "01912345678",
                "full_name": "Admin Created",
                "email": "",
                "role": "student",
                "preferred_language": "bn",
                "usable_password": "true",
                "password1": PASSWORD,
                "password2": PASSWORD,
            },
        )
        assert response.status_code == 302, response.content[:500]
        user = User.objects.get(mobile_number="+8801912345678")
        assert user.check_password(PASSWORD) and user.password != PASSWORD
        assert StudentProfile.objects.filter(user=user).exists()

    def test_profile_inline_is_editable_on_the_change_page(self, admin_client):
        student = make_user()
        page = admin_client.get(f"/django-admin/accounts/user/{student.pk}/change/")
        assert b"display_name" in page.content

    def test_django_admin_defaults_to_english(self, admin_client):
        response = admin_client.get("/django-admin/")
        assert response["Content-Language"] == "en"


# --------------------------------------------------------------------------------------
# Migrations
# --------------------------------------------------------------------------------------
class TestMigrations:
    def test_first_project_migration_creates_the_custom_user(self):
        loader = MigrationLoader(None, ignore_no_migrations=True)
        initial = loader.disk_migrations[("accounts", "0001_initial")]
        created = [op.name for op in initial.operations if hasattr(op, "fields")]
        assert created == ["User", "StudentProfile"]

    def test_django_admin_log_depends_on_the_custom_user_migration(self):
        loader = MigrationLoader(None, ignore_no_migrations=True)
        parents = {p.key for p in loader.graph.node_map[("admin", "0001_initial")].parents}
        assert ("accounts", "0001_initial") in parents

    def test_no_project_migration_points_at_django_default_user(self):
        loader = MigrationLoader(None, ignore_no_migrations=True)
        for (app_label, _name), migration in loader.disk_migrations.items():
            if app_label not in {"accounts", "core"}:
                continue
            source = repr(migration.operations).lower()
            assert "auth.user'" not in source and 'auth.user"' not in source

    def test_auth_user_table_does_not_exist(self, django_db_setup):
        from django.db import connection

        assert "auth_user" not in connection.introspection.table_names()
        assert "accounts_user" in connection.introspection.table_names()


# --------------------------------------------------------------------------------------
# Localization (Bangla + English)
# --------------------------------------------------------------------------------------
class TestLocalization:
    @pytest.mark.parametrize(
        ("language", "expected"),
        [
            ("bn", "সঠিক বাংলাদেশি মোবাইল নম্বর লিখুন"),
            ("en", "Enter a valid Bangladeshi mobile number"),
        ],
    )
    def test_mobile_validation_message_is_translated(self, language, expected):
        from django.utils import translation

        with translation.override(language):
            with pytest.raises(ValidationError) as exc:
                make_user("12345")
            # Messages are translated lazily, so read them while the language is active.
            assert expected in exc.value.message_dict["mobile_number"][0]

    @pytest.mark.parametrize(
        ("language", "student", "admin"),
        [("bn", "শিক্ষার্থী", "অ্যাডমিন"), ("en", "Student", "Admin")],
    )
    def test_role_labels_are_translated(self, language, student, admin):
        from django.utils import translation

        with translation.override(language):
            assert str(Role.STUDENT.label) == student
            assert str(Role.ADMIN.label) == admin

    def test_duplicate_mobile_message_is_translated(self):
        from django.utils import translation

        make_user()
        with translation.override("bn"):
            with pytest.raises(ValidationError) as exc:
                make_user("01712345678")
            assert "ইতিমধ্যে" in exc.value.message_dict["mobile_number"][0]
        with translation.override("en"):
            assert "already exists" in exc.value.message_dict["mobile_number"][0]

    def test_api_error_message_follows_request_language(self, client):
        bangla = client.get("/api/v1/missing/", HTTP_ACCEPT_LANGUAGE="bn").json()["error"]
        english = client.get("/api/v1/missing/", HTTP_ACCEPT_LANGUAGE="en").json()["error"]

        assert bangla["code"] == english["code"] == "not_found"
        assert bangla["message"] == "অনুরোধ করা তথ্যটি পাওয়া যায়নি।"
        assert english["message"] == "The requested resource was not found."
