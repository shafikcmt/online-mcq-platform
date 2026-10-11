"""Milestone 3A: catalog (Category → Subjects), admin API, admin permissions."""

import threading
import unicodedata
from unittest import mock

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.db.models import ProtectedError
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.audit.models import AuditLog
from apps.audit.services import AuditContext
from apps.catalog import services
from apps.catalog.exceptions import CatalogInUse
from apps.catalog.models import Category, Subject

pytestmark = pytest.mark.django_db

PW = "Strong-Pass-2026"  # test-only value
CATEGORIES = "/api/v1/admin/categories/"
SUBJECTS = "/api/v1/admin/subjects/"
CTX = AuditContext()


def make_admin(mobile="01612345678", **extra):
    extra.setdefault("preferred_language", "en")
    return User.objects.create_user(mobile, password=PW, full_name="Ops", role=Role.ADMIN, **extra)


@pytest.fixture
def admin_user():
    return make_admin()


@pytest.fixture
def api(admin_user):
    client = APIClient()
    client.force_login(admin_user)
    return client


def category(**fields):
    fields.setdefault("name_en", "Science")
    return services.create_category(Category(**fields), ctx=CTX)


def subject(cat, **fields):
    fields.setdefault("name_en", "Physics")
    return services.create_subject(Subject(category=cat, **fields), ctx=CTX)


def errors(response):
    return response.json()["error"]["field_errors"]


# ======================================================================================
# Models & database constraints
# ======================================================================================
class TestModels:
    def test_category_with_many_subjects(self):
        cat = category()
        for name in ("Physics", "Chemistry", "Biology"):
            subject(cat, name_en=name)
        assert cat.subjects.count() == 3
        assert set(Subject.objects.values_list("category_id", flat=True)) == {cat.pk}

    def test_text_is_normalized(self):
        decomposed = "বিজ্ঞান য়"
        cat = category(name_en="  Physics \t  Basics \n", name_bn=decomposed, slug=" Phy-1 ")
        cat.refresh_from_db()
        assert cat.name_en == "Physics Basics"
        assert cat.name_bn == unicodedata.normalize("NFC", decomposed).strip()
        assert cat.slug == "phy-1"

    def test_bangla_digits_in_slug_are_converted(self):
        assert category(slug="class-১০").slug == "class-10"

    def test_description_line_endings_normalized(self):
        cat = category(description_en=" line one\r\nline two ")
        assert cat.description_en == "line one\nline two"

    def test_a_name_is_required(self):
        with pytest.raises(ValidationError) as exc:
            category(name_en="   ", name_bn="", slug="x")
        assert set(exc.value.message_dict) == {"name_bn", "name_en"}

    @pytest.mark.parametrize(
        "invisible", ["\u200b", "\u200c\u200d", " \t\n ", "\x00\x07", "—", "..."]
    )
    def test_invisible_or_punctuation_only_names_do_not_count(self, invisible):
        with pytest.raises(ValidationError) as exc:
            category(name_en=invisible, name_bn="", slug="x")
        assert set(exc.value.message_dict) == {"name_bn", "name_en"}

    def test_bangla_joiners_inside_words_are_kept(self):
        name = "র\u200dযাব"  # ZWJ is part of Bangla spelling
        assert category(name_bn=name, name_en="", slug="x").name_bn == name

    def test_control_characters_are_removed(self):
        cat = category(name_en="Sci\x00ence", description_en="line\x07 one\nline two")
        assert cat.name_en == "Science"
        assert cat.description_en == "line one\nline two"

    def test_descriptions_are_stored_as_plain_text(self):
        html = "<b>bold</b> <script>alert(1)</script>"
        assert category(description_en=html).description_en == html  # stored verbatim;
        # clients must render it as text (escaped), never as HTML.

    def test_bangla_only_name_is_enough(self):
        cat = category(name_en="", name_bn="পদার্থবিজ্ঞান", slug="physics")
        assert cat.pk and str(cat) == "পদার্থবিজ্ঞান"

    @pytest.mark.parametrize(
        "fields",
        [
            {"name_bn": "", "name_en": "", "slug": "empty"},  # name CHECK
            {"name_en": "X", "slug": "Bad slug"},  # slug format CHECK
            {"name_en": "X", "slug": ""},  # slug format CHECK
        ],
    )
    def test_database_checks_are_the_last_guard(self, fields):
        with pytest.raises(IntegrityError), transaction.atomic():
            Category.objects.create(**fields)

    def test_negative_sort_order_rejected_by_database(self):
        cat = category()
        with pytest.raises(IntegrityError), transaction.atomic():
            Category.objects.filter(pk=cat.pk).update(sort_order=-1)

    def test_negative_sort_order_rejected_by_validation(self):
        with pytest.raises(ValidationError) as exc:
            category(sort_order=-1)
        assert "sort_order" in exc.value.message_dict

    def test_category_slug_is_unique(self):
        category(slug="science")
        with pytest.raises(IntegrityError), transaction.atomic():
            Category.objects.create(name_en="Other", slug="science")

    def test_subject_slug_is_unique_within_its_category(self):
        a, b = category(slug="a"), category(slug="b")
        subject(a, slug="physics")
        subject(b, slug="physics")  # fine in another category
        with pytest.raises(IntegrityError), transaction.atomic():
            Subject.objects.create(category=a, name_en="Again", slug="physics")

    def test_subject_requires_a_category(self):
        with pytest.raises(IntegrityError), transaction.atomic():
            Subject.objects.create(name_en="Orphan", slug="orphan", category_id=None)

    def test_category_with_subjects_is_protected_at_orm_level(self):
        cat = category()
        subject(cat)
        with pytest.raises(ProtectedError):
            cat.delete()
        assert Subject.objects.count() == 1


# ======================================================================================
# Permissions
# ======================================================================================
class TestPermissions:
    def test_anonymous_is_rejected(self):
        client = APIClient()
        response = client.get(CATEGORIES)
        assert response.status_code == 401
        assert response["WWW-Authenticate"].startswith("Session")
        assert client.post(CATEGORIES, {"name_en": "X"}, format="json").status_code == 401
        assert not Category.objects.exists()

    def test_student_jwt_is_not_accepted(self):
        from apps.accounts.tokens import issue_tokens

        student = User.objects.create_user("01712345678", password=PW, full_name="S")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(student)['access']}")
        assert client.get(CATEGORIES).status_code == 401
        assert client.post(CATEGORIES, {"name_en": "X"}, format="json").status_code == 401
        assert not Category.objects.exists()

    def test_student_session_is_forbidden(self):
        student = User.objects.create_user("01712345678", password=PW, full_name="S")
        client = APIClient()
        client.force_login(student)
        assert client.get(CATEGORIES).status_code == 403
        assert client.post(SUBJECTS, {"name_en": "X"}, format="json").status_code == 403
        assert client.get("/api/v1/admin/audit-logs/").status_code == 403

    def test_staff_flag_alone_is_not_enough(self):
        staff_student = User.objects.create_user(
            "01712345678", password=PW, full_name="S", is_staff=True
        )
        client = APIClient()
        client.force_login(staff_student)
        assert client.get(CATEGORIES).status_code == 403

    @pytest.mark.parametrize(
        "flags", [{"is_superuser": True, "is_staff": True}, {"is_superuser": True}]
    )
    def test_superuser_flag_without_admin_role_is_forbidden(self, flags):
        user = User.objects.create_user("01712345678", password=PW, full_name="S", **flags)
        client = APIClient()
        client.force_login(user)
        assert client.get(CATEGORIES).status_code == 403
        assert client.post(CATEGORIES, {"name_en": "X"}, format="json").status_code == 403

    def test_students_cannot_mutate_existing_data(self):
        from apps.accounts.tokens import issue_tokens

        cat = category(slug="science")
        sub = subject(cat)
        student = User.objects.create_user("01712345678", password=PW, full_name="S")
        jwt_client = APIClient()
        jwt_client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(student)['access']}")
        session_client = APIClient()
        session_client.force_login(student)
        for client, expected in ((jwt_client, 401), (session_client, 403)):
            for url in (f"{CATEGORIES}{cat.pk}/", f"{SUBJECTS}{sub.pk}/"):
                assert client.patch(url, {"name_en": "Hacked"}, format="json").status_code == (
                    expected
                )
                assert client.delete(url).status_code == expected
        cat.refresh_from_db()
        assert cat.name_en == "Science" and Subject.objects.filter(pk=sub.pk).exists()
        assert AuditLog.objects.filter(action__endswith=".update").count() == 0

    def test_audit_log_endpoint_requires_admin(self):
        assert APIClient().get("/api/v1/admin/audit-logs/").status_code == 401

    def test_get_needs_no_csrf_and_changes_nothing(self, admin_user):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(admin_user)
        cat = category()
        for url in (CATEGORIES, f"{CATEGORIES}{cat.pk}/", SUBJECTS, "/api/v1/admin/audit-logs/"):
            assert client.get(url).status_code == 200
            assert client.head(url).status_code == 200
        assert AuditLog.objects.count() == 1  # only the fixture's create

    @pytest.mark.parametrize("method", ["patch", "delete"])
    def test_csrf_is_required_for_patch_and_delete(self, admin_user, method):
        cat = category()
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(admin_user)
        response = getattr(client, method)(
            f"{CATEGORIES}{cat.pk}/", {"name_en": "Y"}, format="json"
        )
        assert response.status_code == 403
        cat.refresh_from_db()
        assert cat.name_en == "Science"

    def test_inactive_admin_is_rejected(self, admin_user):
        client = APIClient()
        client.force_login(admin_user)
        User.objects.filter(pk=admin_user.pk).update(is_active=False)
        assert client.get(CATEGORIES).status_code == 401

    def test_demoted_admin_loses_access_immediately(self, api, admin_user):
        assert api.get(CATEGORIES).status_code == 200
        User.objects.filter(pk=admin_user.pk).update(role=Role.STUDENT)
        assert api.get(CATEGORIES).status_code == 403

    def test_password_change_ends_admin_sessions(self, api, admin_user):
        admin_user.set_password("Changed-Pass-2027")
        admin_user.save()
        assert api.get(CATEGORIES).status_code == 401

    def test_admin_session_cannot_use_student_endpoints(self, api):
        assert api.get("/api/v1/me/").status_code == 401

    def test_valid_admin_is_allowed(self, api):
        assert api.get(CATEGORIES).status_code == 200
        assert api.get(SUBJECTS).status_code == 200
        assert api.get("/api/v1/admin/audit-logs/").status_code == 200

    def test_csrf_is_required_for_session_writes(self, admin_user):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(admin_user)
        assert client.get(CATEGORIES).status_code == 200  # safe method
        response = client.post(CATEGORIES, {"name_en": "X"}, format="json")
        assert response.status_code == 403 and not Category.objects.exists()
        token = "a" * 32
        client.cookies["csrftoken"] = token
        response = client.post(CATEGORIES, {"name_en": "X"}, format="json", HTTP_X_CSRFTOKEN=token)
        assert response.status_code == 201


# ======================================================================================
# Category CRUD
# ======================================================================================
class TestCategoryApi:
    def test_create_generates_slug_from_english_name(self, api):
        response = api.post(CATEGORIES, {"name_en": "Physics & Chemistry"}, format="json")
        assert response.status_code == 201
        body = response.json()
        assert body["slug"] == "physics-chemistry"
        assert body["subject_count"] == 0 and body["is_active"] is True
        again = api.post(CATEGORIES, {"name_en": "Physics_Chemistry"}, format="json")
        assert again.json()["slug"] == "physics-chemistry-2"

    def test_response_shape(self, api):
        body = api.post(
            CATEGORIES,
            {"name_bn": "বিজ্ঞান", "name_en": "Science", "description_bn": "বর্ণনা"},
            format="json",
        ).json()
        assert set(body) == {
            "id",
            "name_bn",
            "name_en",
            "slug",
            "description_bn",
            "description_en",
            "is_active",
            "sort_order",
            "subject_count",
            "created_at",
            "updated_at",
        }

    def test_bangla_only_needs_an_explicit_slug(self, api):
        response = api.post(CATEGORIES, {"name_bn": "বিজ্ঞান"}, format="json")
        assert response.status_code == 400 and "slug" in errors(response)
        ok = api.post(CATEGORIES, {"name_bn": "বিজ্ঞান", "slug": "science"}, format="json")
        assert ok.status_code == 201

    def test_names_required(self, api):
        response = api.post(CATEGORIES, {"name_bn": " ", "name_en": "", "slug": "x"}, format="json")
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "validation_error"
        assert set(errors(response)) == {"name_bn", "name_en"}

    @pytest.mark.parametrize(
        "payload, field",
        [
            ({"name_en": "X", "slug": "has space"}, "slug"),
            ({"name_en": "X", "slug": "bad_underscore"}, "slug"),
            ({"name_en": "X", "slug": "বাংলা"}, "slug"),
            ({"name_en": "X", "sort_order": -1}, "sort_order"),
            ({"name_en": "X", "sort_order": 2_147_483_648}, "sort_order"),
            ({"name_en": "X" * 121}, "name_en"),
            ({"name_en": "X", "description_en": "d" * 2001}, "description_en"),
            ({"name_en": "X", "is_active": "maybe"}, "is_active"),
        ],
    )
    def test_validation_errors(self, api, payload, field):
        response = api.post(CATEGORIES, payload, format="json")
        assert response.status_code == 400
        assert field in errors(response)
        assert not Category.objects.exists()

    def test_bangla_digit_sort_order_is_accepted(self, api):
        response = api.post(CATEGORIES, {"name_en": "X", "sort_order": "৫"}, format="json")
        assert response.status_code == 201 and response.json()["sort_order"] == 5

    def test_duplicate_slug(self, api):
        category(slug="science")
        response = api.post(CATEGORIES, {"name_en": "Other", "slug": "SCIENCE"}, format="json")
        assert response.status_code == 400
        assert errors(response)["slug"] == ["A category with this slug already exists."]

    def test_read_only_fields_are_ignored(self, api):
        response = api.post(
            CATEGORIES,
            {"name_en": "X", "id": 999, "subject_count": 50, "created_at": "2000-01-01T00:00Z"},
            format="json",
        )
        body = response.json()
        assert body["id"] != 999 and body["subject_count"] == 0
        assert not body["created_at"].startswith("2000")

    def test_retrieve_update_delete(self, api):
        cat = category(name_en="Science", slug="science")
        url = f"{CATEGORIES}{cat.pk}/"
        assert api.get(url).json()["name_en"] == "Science"
        response = api.patch(url, {"name_bn": "বিজ্ঞান", "is_active": False}, format="json")
        assert response.status_code == 200
        assert response.json()["name_bn"] == "বিজ্ঞান" and response.json()["is_active"] is False
        assert response.json()["slug"] == "science"  # unchanged
        assert api.put(url, {"name_en": "X"}, format="json").status_code == 405
        assert api.delete(url).status_code == 204
        assert api.get(url).status_code == 404
        assert api.patch(url, {"name_en": "Y"}, format="json").status_code == 404
        assert api.delete(url).status_code == 404

    def test_patch_cannot_clear_both_names(self, api):
        cat = category(name_en="Science", slug="science")
        response = api.patch(f"{CATEGORIES}{cat.pk}/", {"name_en": ""}, format="json")
        assert response.status_code == 400
        cat.refresh_from_db()
        assert cat.name_en == "Science"

    def test_patch_to_taken_slug(self, api):
        category(slug="one")
        two = category(slug="two")
        response = api.patch(f"{CATEGORIES}{two.pk}/", {"slug": "one"}, format="json")
        assert response.status_code == 400 and "slug" in errors(response)

    def test_messages_in_bangla(self, api):
        response = api.post(
            CATEGORIES, {"name_en": "", "slug": "x"}, format="json", HTTP_ACCEPT_LANGUAGE="bn"
        )
        assert response["Content-Language"] == "bn"
        message = errors(response)["name_en"][0]
        assert any("ঀ" <= ch <= "৿" for ch in message)

    def test_admin_preferred_language_is_used_by_default(self, admin_user):
        User.objects.filter(pk=admin_user.pk).update(preferred_language="bn")
        client = APIClient()
        client.force_login(admin_user)
        response = client.post(CATEGORIES, {"name_en": "", "slug": "x"}, format="json")
        assert response["Content-Language"] == "bn"


class TestCategoryListing:
    @pytest.fixture
    def data(self):
        return [
            category(name_en="Physics", name_bn="পদার্থবিজ্ঞান", slug="physics", sort_order=2),
            category(name_en="Biology", name_bn="জীববিজ্ঞান", slug="biology", sort_order=1),
            category(name_en="Art", name_bn="চারুকলা", slug="art", sort_order=3, is_active=False),
        ]

    def slugs(self, api, query=""):
        response = api.get(CATEGORIES + query)
        assert response.status_code == 200, response.content
        return [row["slug"] for row in response.json()["results"]]

    def test_default_order_and_pagination_shape(self, api, data):
        body = api.get(CATEGORIES).json()
        assert set(body) == {"count", "next", "previous", "results"} and body["count"] == 3
        assert self.slugs(api) == ["biology", "physics", "art"]

    def test_filters_search_and_ordering(self, api, data):
        assert self.slugs(api, "?is_active=true") == ["biology", "physics"]
        assert self.slugs(api, "?is_active=false") == ["art"]
        assert self.slugs(api, "?search=phys") == ["physics"]
        assert self.slugs(api, "?search=জীব") == ["biology"]
        assert self.slugs(api, "?ordering=name_en") == ["art", "biology", "physics"]
        assert self.slugs(api, "?ordering=-sort_order") == ["art", "physics", "biology"]
        assert self.slugs(api, "?ordering=-created_at") == ["art", "biology", "physics"]

    @pytest.mark.parametrize(
        "query, field",
        [
            ("?is_active=maybe", "is_active"),
            ("?ordering=password", "ordering"),
            ("?ordering=category__name_en", "ordering"),
            ("?search=" + "x" * 101, "search"),
        ],
    )
    def test_invalid_query_parameters(self, api, data, query, field):
        response = api.get(CATEGORIES + query)
        assert response.status_code == 400 and field in errors(response)

    def test_ties_are_ordered_by_id(self, api):
        ids = [category(name_en=f"C{i}", slug=f"c{i}", sort_order=1).pk for i in range(5)]
        response = api.get(CATEGORIES + "?page_size=2&ordering=sort_order")
        pages = [row["id"] for row in response.json()["results"]]
        pages += [
            row["id"] for row in api.get(CATEGORIES + "?page=2&page_size=2").json()["results"]
        ]
        pages += [
            row["id"] for row in api.get(CATEGORIES + "?page=3&page_size=2").json()["results"]
        ]
        assert pages == ids

    def test_public_categories_expose_no_admin_fields(self, api, data):
        """Added in Milestone 3C (deferred from 3A): active categories only, public fields."""
        rows = APIClient().get("/api/v1/public/categories/").json()["results"]
        assert [row["slug"] for row in rows] == ["biology", "physics"]  # "art" is inactive
        assert all(set(row) == {"slug", "name", "description", "subjects"} for row in rows)

    def test_subject_count(self, api, data):
        subject(data[0])
        subject(data[0], name_en="Optics")
        rows = {row["slug"]: row["subject_count"] for row in api.get(CATEGORIES).json()["results"]}
        assert rows == {"physics": 2, "biology": 0, "art": 0}


# ======================================================================================
# Subject CRUD
# ======================================================================================
class TestSubjectApi:
    def test_create_and_slug_scope(self, api):
        a, b = category(slug="a"), category(slug="b")
        first = api.post(SUBJECTS, {"category": a.pk, "name_en": "Physics"}, format="json")
        assert first.status_code == 201 and first.json()["slug"] == "physics"
        assert first.json()["category"] == a.pk
        other = api.post(SUBJECTS, {"category": b.pk, "name_en": "Physics"}, format="json")
        assert other.json()["slug"] == "physics"  # unique per category, not globally
        explicit = api.post(
            SUBJECTS, {"category": a.pk, "name_en": "X", "slug": "physics"}, format="json"
        )
        assert explicit.status_code == 400
        assert errors(explicit)["slug"] == ["This category already has a subject with this slug."]

    @pytest.mark.parametrize("category_value", [None, 999999, "abc"])
    def test_category_must_exist(self, api, category_value):
        payload = {"name_en": "Physics"}
        if category_value is not None:
            payload["category"] = category_value
        response = api.post(SUBJECTS, payload, format="json")
        assert response.status_code == 400 and "category" in errors(response)

    def test_move_to_another_category(self, api):
        a, b = category(slug="a"), category(slug="b")
        sub = subject(a, slug="physics")
        response = api.patch(f"{SUBJECTS}{sub.pk}/", {"category": b.pk}, format="json")
        assert response.status_code == 200 and response.json()["category"] == b.pk

    def test_move_into_slug_clash_is_rejected(self, api):
        a, b = category(slug="a"), category(slug="b")
        subject(b, slug="physics")
        sub = subject(a, slug="physics")
        response = api.patch(
            f"{SUBJECTS}{sub.pk}/", {"category": b.pk, "name_en": "Renamed"}, format="json"
        )
        assert response.status_code == 400 and "slug" in errors(response)
        sub.refresh_from_db()
        assert sub.category_id == a.pk and sub.name_en == "Physics"  # nothing changed
        assert not AuditLog.objects.filter(action="subject.update").exists()

    def test_category_fk_is_protect(self):
        """Questions (3B) will use the same PROTECT pattern on Subject."""
        from django.db import models

        assert Subject._meta.get_field("category").remote_field.on_delete is models.PROTECT

    def test_filters(self, api):
        a, b = category(slug="a"), category(slug="b")
        subject(a, name_en="Physics", name_bn="পদার্থ", slug="physics")
        subject(a, name_en="Chemistry", slug="chemistry", is_active=False, sort_order=5)
        subject(b, name_en="Algebra", slug="algebra")

        def slugs(query):
            return [row["slug"] for row in api.get(SUBJECTS + query).json()["results"]]

        assert slugs(f"?category={a.pk}") == ["physics", "chemistry"]
        assert slugs(f"?category={a.pk}&is_active=true") == ["physics"]
        assert slugs("?search=পদার্থ") == ["physics"]
        assert slugs("?ordering=name_en") == ["algebra", "chemistry", "physics"]
        assert api.get(SUBJECTS + "?category=abc").status_code == 400
        assert api.get(SUBJECTS + "?category=0").status_code == 400

    def test_update_and_delete(self, api):
        sub = subject(category())
        url = f"{SUBJECTS}{sub.pk}/"
        response = api.patch(url, {"sort_order": 4, "description_bn": "নোট"}, format="json")
        assert response.status_code == 200 and response.json()["sort_order"] == 4
        assert api.delete(url).status_code == 204
        assert not Subject.objects.exists()


# ======================================================================================
# Delete protection
# ======================================================================================
class TestDeleteProtection:
    def test_category_with_subjects_cannot_be_deleted(self, api):
        cat = category()
        sub = subject(cat)
        response = api.delete(f"{CATEGORIES}{cat.pk}/")
        assert response.status_code == 409
        error = response.json()["error"]
        assert error["code"] == "in_use" and error["details"] == {"subject_count": 1}
        assert Category.objects.filter(pk=cat.pk).exists()
        assert Subject.objects.filter(pk=sub.pk).exists()  # no cascade
        assert not AuditLog.objects.filter(action="category.delete").exists()
        # After the subject is gone the category can be deleted.
        assert api.delete(f"{SUBJECTS}{sub.pk}/").status_code == 204
        assert api.delete(f"{CATEGORIES}{cat.pk}/").status_code == 204

    def test_subject_still_referenced_returns_409(self, api):
        """Milestone 3B: a question referencing the subject (PROTECT) must block deletion."""
        sub = subject(category())
        with mock.patch.object(Subject, "delete", side_effect=ProtectedError("in use", set())):
            response = api.delete(f"{SUBJECTS}{sub.pk}/")
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "in_use"
        assert Subject.objects.filter(pk=sub.pk).exists()
        assert not AuditLog.objects.filter(action="subject.delete").exists()

    def test_in_use_message_is_translated(self, api):
        cat = category()
        subject(cat)
        response = api.delete(f"{CATEGORIES}{cat.pk}/", HTTP_ACCEPT_LANGUAGE="bn")
        assert any("ঀ" <= ch <= "৿" for ch in response.json()["error"]["message"])


# ======================================================================================
# Concurrency
# ======================================================================================
def _run_concurrently(*funcs):
    barrier = threading.Barrier(len(funcs))
    results = [None] * len(funcs)

    def runner(index, func):
        try:
            barrier.wait()
            results[index] = func()
        except Exception as exc:  # noqa: BLE001 — collected and asserted by the test
            results[index] = exc
        finally:
            connection.close()

    threads = [threading.Thread(target=runner, args=(i, f)) for i, f in enumerate(funcs)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    return results


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_category_delete_racing_subject_create_stays_consistent(run):
    cat = category(slug=f"race-{run}")
    deleted, created = _run_concurrently(
        lambda: services.delete_category(cat.pk, ctx=CTX),
        lambda: services.create_subject(Subject(category_id=cat.pk, name_en="Physics"), ctx=CTX),
    )
    if isinstance(deleted, CatalogInUse):  # subject won the race
        assert isinstance(created, Subject)
        assert Subject.objects.filter(category_id=cat.pk).count() == 1
        assert Category.objects.filter(pk=cat.pk).exists()
    else:  # delete won: the subject was refused cleanly (no orphan, no IntegrityError)
        assert deleted is None
        assert isinstance(created, ValidationError) and "category" in created.message_dict
        assert not Category.objects.filter(pk=cat.pk).exists()
        assert not Subject.objects.exists()


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_category_delete_racing_subject_move_in_stays_consistent(run):
    source, target = category(slug=f"source-{run}"), category(slug=f"target-{run}")
    sub = subject(source)
    deleted, moved = _run_concurrently(
        lambda: services.delete_category(target.pk, ctx=CTX),
        lambda: services.update_subject(sub.pk, {"category": target}, ctx=CTX),
    )
    sub.refresh_from_db()
    if isinstance(deleted, CatalogInUse):  # move won
        assert isinstance(moved, Subject) and sub.category_id == target.pk
        assert Category.objects.filter(pk=target.pk).exists()
    else:  # delete won: the move was refused and the subject stayed where it was
        assert deleted is None
        assert isinstance(moved, ValidationError) and "category" in moved.message_dict
        assert sub.category_id == source.pk
        assert not Category.objects.filter(pk=target.pk).exists()
    assert Subject.objects.count() == 1  # never deleted, never orphaned


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_category_delete_racing_subject_move_out_stays_consistent(run):
    source, target = category(slug=f"source-{run}"), category(slug=f"target-{run}")
    sub = subject(source)
    deleted, moved = _run_concurrently(
        lambda: services.delete_category(source.pk, ctx=CTX),
        lambda: services.update_subject(sub.pk, {"category": target}, ctx=CTX),
    )
    assert isinstance(moved, Subject)
    sub.refresh_from_db()
    assert sub.category_id == target.pk
    # Either outcome is valid: deleted after the move, or refused while it still had it.
    assert deleted is None or isinstance(deleted, CatalogInUse)
    assert Category.objects.filter(pk=source.pk).exists() == isinstance(deleted, CatalogInUse)


@pytest.mark.django_db(transaction=True)
def test_concurrent_duplicate_subject_slug_gives_one_success():
    cat = category(slug="race")
    results = _run_concurrently(
        *[
            lambda: services.create_subject(
                Subject(category_id=cat.pk, name_en="X", slug="same"), ctx=CTX
            )
            for _ in range(3)
        ]
    )
    assert sum(isinstance(r, Subject) for r in results) == 1
    assert all(
        isinstance(r, ValidationError) and "slug" in r.message_dict
        for r in results
        if not isinstance(r, Subject)
    )
    assert Subject.objects.count() == 1


@pytest.mark.django_db(transaction=True)
def test_concurrent_duplicate_slug_gives_one_success():
    results = _run_concurrently(
        *[
            lambda: services.create_category(Category(name_en="X", slug="same"), ctx=CTX)
            for _ in range(3)
        ]
    )
    assert sum(isinstance(r, Category) for r in results) == 1
    failures = [r for r in results if not isinstance(r, Category)]
    assert all(isinstance(r, ValidationError) and "slug" in r.message_dict for r in failures)
    assert Category.objects.count() == 1
    assert AuditLog.objects.filter(action="category.create").count() == 1


# ======================================================================================
# Internal Django admin
# ======================================================================================
class TestDjangoAdmin:
    @pytest.fixture
    def ops(self, client):
        superuser = User.objects.create_superuser("01512345678", PW, full_name="Ops")
        client.force_login(superuser)
        return client

    def test_pages_load(self, ops):
        cat = category()
        sub = subject(cat)
        for url in (
            "/django-admin/catalog/category/",
            "/django-admin/catalog/category/?is_active__exact=1&q=sci",
            f"/django-admin/catalog/category/{cat.pk}/change/",
            "/django-admin/catalog/subject/",
            f"/django-admin/catalog/subject/?category__id__exact={cat.pk}",
            f"/django-admin/catalog/subject/{sub.pk}/change/",
        ):
            assert ops.get(url).status_code == 200, url

    FORM = {
        "name_bn": "",
        "name_en": "  Science  ",
        "slug": "Science",
        "description_bn": "",
        "description_en": "",
        "is_active": "on",
        "sort_order": "0",
    }

    def test_create_update_delete_each_log_exactly_once(self, ops):
        response = ops.post("/django-admin/catalog/category/add/", self.FORM)
        assert response.status_code == 302, response.content
        cat = Category.objects.get()
        assert cat.name_en == "Science" and cat.slug == "science"
        create = AuditLog.objects.get()
        assert create.action == "category.create"
        assert create.actor.mobile_number == "+8801512345678"

        change_url = f"/django-admin/catalog/category/{cat.pk}/change/"
        response = ops.post(change_url, {**self.FORM, "name_en": "Sciences"})
        assert response.status_code == 302
        assert AuditLog.objects.filter(action="category.update").count() == 1
        assert AuditLog.objects.get(action="category.update").metadata["changed_fields"] == [
            "name_en"
        ]

        ops.post(change_url, {**self.FORM, "name_en": "Sciences"})  # unchanged form
        assert AuditLog.objects.filter(action="category.update").count() == 1

        response = ops.post(f"/django-admin/catalog/category/{cat.pk}/delete/", {"post": "yes"})
        assert response.status_code == 302
        assert not Category.objects.exists()
        assert AuditLog.objects.filter(action="category.delete").count() == 1
        assert AuditLog.objects.count() == 3

    def test_failed_validation_logs_nothing(self, ops):
        response = ops.post(
            "/django-admin/catalog/category/add/", {**self.FORM, "name_en": " ", "slug": "a b"}
        )
        assert response.status_code == 200  # form re-displayed with errors
        assert not Category.objects.exists() and not AuditLog.objects.exists()
        cat = category()
        AuditLog_count = AuditLog.objects.count()
        response = ops.post(
            f"/django-admin/catalog/category/{cat.pk}/change/", {**self.FORM, "name_en": ""}
        )
        assert response.status_code == 200
        assert AuditLog.objects.count() == AuditLog_count

    def test_subject_admin_is_audited(self, ops):
        cat = category()
        form = {**self.FORM, "category": cat.pk, "slug": "physics", "name_en": "Physics"}
        assert ops.post("/django-admin/catalog/subject/add/", form).status_code == 302
        sub = Subject.objects.get()
        ops.post(f"/django-admin/catalog/subject/{sub.pk}/change/", {**form, "sort_order": "3"})
        ops.post(f"/django-admin/catalog/subject/{sub.pk}/delete/", {"post": "yes"})
        actions = list(AuditLog.objects.order_by("id").values_list("action", flat=True))
        assert actions == ["category.create", "subject.create", "subject.update", "subject.delete"]

    def test_bulk_delete_action_is_audited_per_object(self, ops):
        ids = [category(name_en=f"C{i}", slug=f"c{i}").pk for i in range(2)]
        response = ops.post(
            "/django-admin/catalog/category/",
            {"action": "delete_selected", "_selected_action": ids, "post": "yes"},
        )
        assert response.status_code == 302
        assert not Category.objects.exists()
        assert AuditLog.objects.filter(action="category.delete").count() == 2

    def test_admin_cannot_delete_category_with_subjects(self, ops):
        cat = category()
        subject(cat)
        response = ops.post(f"/django-admin/catalog/category/{cat.pk}/delete/", {"post": "yes"})
        assert response.status_code in (200, 302)
        assert Category.objects.filter(pk=cat.pk).exists() and Subject.objects.exists()
        assert not AuditLog.objects.filter(action="category.delete").exists()
