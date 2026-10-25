"""Milestone 3A: append-only audit log."""

import json

import pytest
from django.db import DatabaseError, connection, models, transaction
from django.db.models import ProtectedError
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.audit import services as audit
from apps.audit.models import AuditLog, AuditLogImmutable
from apps.audit.services import AuditContext
from apps.catalog import services
from apps.catalog.models import Category

pytestmark = pytest.mark.django_db

PW = "Strong-Pass-2026"  # test-only value
CATEGORIES = "/api/v1/admin/categories/"
SUBJECTS = "/api/v1/admin/subjects/"
AUDIT = "/api/v1/admin/audit-logs/"


@pytest.fixture
def admin_user():
    return User.objects.create_user("01612345678", password=PW, full_name="Ops", role=Role.ADMIN)


@pytest.fixture
def api(admin_user):
    client = APIClient(REMOTE_ADDR="203.0.113.5", HTTP_USER_AGENT="pytest-agent")
    client.force_login(admin_user)
    return client


def entry(action):
    return AuditLog.objects.get(action=action)


# ======================================================================================
# What gets recorded
# ======================================================================================
class TestRecording:
    def test_create(self, api, admin_user):
        response = api.post(
            CATEGORIES,
            {"name_en": "Science", "name_bn": "বিজ্ঞান", "description_en": "long text"},
            format="json",
        )
        log = entry("category.create")
        assert log.actor == admin_user
        assert log.entity_type == "catalog.category"
        assert log.entity_id == str(response.json()["id"])
        assert log.summary == "Science [science]"
        assert log.ip_address == "203.0.113.5" and log.user_agent == "pytest-agent"
        assert log.metadata == {
            "values": {
                "name_bn": "বিজ্ঞান",
                "name_en": "Science",
                "slug": "science",
                "is_active": True,
                "sort_order": 0,
            },
            "descriptions": ["description_en"],
        }

    def test_update_records_changed_fields_only(self, api):
        category_id = api.post(CATEGORIES, {"name_en": "Science"}, format="json").json()["id"]
        api.patch(
            f"{CATEGORIES}{category_id}/",
            {"name_en": "Sciences", "is_active": False, "description_bn": "গোপন নয় তবে দীর্ঘ"},
            format="json",
        )
        log = entry("category.update")
        assert log.metadata == {
            "changed_fields": ["name_en", "is_active", "description_bn"],
            "changes": {
                "name_en": {"from": "Science", "to": "Sciences"},
                "is_active": {"from": True, "to": False},
            },
        }
        assert "গোপন" not in json.dumps(log.metadata, ensure_ascii=False)  # text not copied

    def test_no_op_update_is_not_logged(self, api):
        category_id = api.post(CATEGORIES, {"name_en": "Science"}, format="json").json()["id"]
        api.patch(f"{CATEGORIES}{category_id}/", {"name_en": " Science "}, format="json")
        assert not AuditLog.objects.filter(action="category.update").exists()

    def test_failed_update_is_not_logged(self, api):
        category_id = api.post(CATEGORIES, {"name_en": "Science"}, format="json").json()["id"]
        api.patch(f"{CATEGORIES}{category_id}/", {"name_en": "", "name_bn": ""}, format="json")
        assert AuditLog.objects.count() == 1

    def test_delete_keeps_identity_of_deleted_row(self, api):
        category_id = api.post(
            CATEGORIES, {"name_en": "Science", "slug": "sci"}, format="json"
        ).json()["id"]
        api.delete(f"{CATEGORIES}{category_id}/")
        log = entry("category.delete")
        assert not Category.objects.exists()
        assert log.entity_id == str(category_id) and log.summary == "Science [sci]"
        assert log.metadata["snapshot"]["slug"] == "sci"

    def test_subject_actions(self, api):
        category_id = api.post(CATEGORIES, {"name_en": "Science"}, format="json").json()["id"]
        other_id = api.post(CATEGORIES, {"name_en": "Maths"}, format="json").json()["id"]
        subject_id = api.post(
            SUBJECTS, {"category": category_id, "name_en": "Physics"}, format="json"
        ).json()["id"]
        api.patch(f"{SUBJECTS}{subject_id}/", {"category": other_id}, format="json")
        api.delete(f"{SUBJECTS}{subject_id}/")
        assert entry("subject.create").metadata["values"]["category_id"] == category_id
        assert entry("subject.update").metadata["changes"] == {
            "category_id": {"from": category_id, "to": other_id}
        }
        assert entry("subject.delete").metadata["snapshot"]["category_id"] == other_id

    def test_forwarded_header_ignored_without_trusted_proxy(self, api, settings):
        settings.TRUSTED_PROXY_COUNT = 0
        api.post(CATEGORIES, {"name_en": "X"}, format="json", HTTP_X_FORWARDED_FOR="9.9.9.9")
        assert entry("category.create").ip_address == "203.0.113.5"

    def test_forwarded_header_used_with_trusted_proxy(self, api, settings):
        settings.TRUSTED_PROXY_COUNT = 1
        api.post(
            CATEGORIES,
            {"name_en": "X"},
            format="json",
            HTTP_X_FORWARDED_FOR="6.6.6.6, 198.51.100.7",
        )
        assert entry("category.create").ip_address == "198.51.100.7"


# ======================================================================================
# Secrets never stored
# ======================================================================================
class TestSafety:
    def write(self, metadata, allowed=("name_en", "slug", "description_en"), **extra):
        with transaction.atomic():
            return audit.record(
                AuditContext(**extra),
                action="test.action",
                entity_type="test",
                entity_id=1,
                metadata=metadata,
                allowed_fields=allowed,
            )

    def test_allow_listed_metadata_is_stored(self):
        log = self.write(
            {
                "values": {"name_en": "Science", "slug": "science"},
                "changes": {"name_en": {"from": "A", "to": "B"}},
                "changed_fields": ["name_en", "description_en"],
            }
        )
        assert log.metadata["changes"] == {"name_en": {"from": "A", "to": "B"}}

    @pytest.mark.parametrize(
        "metadata",
        [
            {"values": {"password": "Hacked-Pass-1"}},  # not allow-listed
            {"snapshot": {"refresh_token": "eyJ..."}},
            {"changed_fields": ["otp"]},
            {"changes": {"session_id": {"from": "a", "to": "b"}}},
            {"request_body": {"name_en": "x"}},  # unknown section
            {"headers": {"Authorization": "Bearer x"}},
            {"values": {"name_en": {"nested": "dict"}}},  # values must be scalars
            {"values": {"name_en": ["list"]}},
        ],
    )
    def test_anything_else_is_refused(self, metadata):
        with pytest.raises(ValueError):
            self.write(metadata)
        assert not AuditLog.objects.exists()

    @pytest.mark.parametrize(
        "field", ["password", "password_hash", "csrf_token", "api_key", "jwt_signing_key"]
    )
    def test_sensitive_names_refused_even_if_a_caller_allow_lists_them(self, field):
        with pytest.raises(ValueError):
            self.write({"values": {field: "x"}}, allowed=(field,))

    def test_text_is_cleaned_and_capped(self):
        log = self.write(
            {"values": {"name_en": "a\x00b\u202ec" + "x" * 1000}},
            user_agent="Agent\r\nX-Injected: 1\x00" + "y" * 1000,
        )
        assert log.metadata["values"]["name_en"].startswith("a b c")
        assert len(log.metadata["values"]["name_en"]) == 300
        assert "\n" not in log.user_agent and "\x00" not in log.user_agent
        assert log.user_agent.startswith("Agent X-Injected: 1")
        assert len(log.user_agent) == 255

    def test_user_agent_from_request_is_cleaned(self, api):
        api.post(
            CATEGORIES,
            {"name_en": "X"},
            format="json",
            HTTP_USER_AGENT="Bad\x07Agent\n" + "z" * 600,
        )
        agent = entry("category.create").user_agent
        assert agent.startswith("Bad Agent") and len(agent) == 255

    def test_api_flows_store_no_secrets(self, api, admin_user, settings):
        from apps.accounts.tokens import issue_tokens

        student = User.objects.create_user("01712345678", password=PW, full_name="S")
        jwt_pair = issue_tokens(student)
        csrf = "c" * 32
        api.cookies["csrftoken"] = csrf
        api.cookies["refresh"] = jwt_pair["refresh"]  # stray token cookie
        headers = {
            "HTTP_AUTHORIZATION": f"Bearer {jwt_pair['access']}",
            "HTTP_X_CSRFTOKEN": csrf,
        }
        payload = {
            "name_en": "X",
            "description_en": "plain description text",
            "password": PW,
            "access": jwt_pair["access"],
            "refresh": jwt_pair["refresh"],
            "verification_token": "vt-secret",
            "otp": "123456",
            "csrfmiddlewaretoken": csrf,
        }
        category_id = api.post(CATEGORIES, payload, format="json", **headers).json()["id"]
        api.patch(
            f"{CATEGORIES}{category_id}/",
            {**payload, "name_en": "Y", "description_en": "changed description"},
            format="json",
            **headers,
        )
        api.delete(f"{CATEGORIES}{category_id}/", **headers)
        assert AuditLog.objects.count() == 3
        stored = AuditLog.objects.values(
            "action", "entity_type", "entity_id", "summary", "metadata", "user_agent"
        )
        dumped = json.dumps(list(stored), default=str, ensure_ascii=False)
        secrets = (
            PW,
            admin_user.password,  # password hash
            jwt_pair["access"],
            jwt_pair["refresh"],
            "vt-secret",
            "123456",
            csrf,
            api.cookies["sessionid"].value,
            settings.SECRET_KEY,
            settings.SIMPLE_JWT["SIGNING_KEY"],
            "Bearer",
            "description text",  # full descriptions are never copied
            "changed description",
        )
        for secret in secrets:
            assert secret not in dumped, secret

    @pytest.mark.django_db(transaction=True)
    def test_record_requires_the_change_transaction(self):
        with pytest.raises(RuntimeError):
            audit.record(AuditContext(), action="x", entity_type="x", entity_id=1)

    def test_change_rolls_back_if_audit_fails(self, monkeypatch):
        def broken(*args, **kwargs):
            raise DatabaseError("audit storage unavailable")

        monkeypatch.setattr(services.audit, "record", broken)
        with pytest.raises(DatabaseError), transaction.atomic():
            services.create_category(Category(name_en="X"), ctx=AuditContext())
        assert not Category.objects.exists()


# ======================================================================================
# Append-only
# ======================================================================================
class TestAppendOnly:
    @pytest.fixture
    def log(self, api):
        api.post(CATEGORIES, {"name_en": "Science"}, format="json")
        return entry("category.create")

    def test_model_refuses_changes(self, log):
        log.summary = "tampered"
        with pytest.raises(AuditLogImmutable):
            log.save()
        with pytest.raises(AuditLogImmutable):
            log.delete()
        with pytest.raises(AuditLogImmutable):
            AuditLog.objects.filter(pk=log.pk).update(summary="tampered")
        with pytest.raises(AuditLogImmutable):
            AuditLog.objects.all().delete()

    @pytest.mark.parametrize(
        "sql",
        [
            "UPDATE audit_auditlog SET summary = 'tampered'",
            "DELETE FROM audit_auditlog",
        ],
    )
    def test_database_trigger_refuses_changes(self, log, sql):
        with pytest.raises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
            cursor.execute(sql)
        log_after = AuditLog.objects.get(pk=log.pk)
        assert log_after.summary == "Science [science]"

    @pytest.mark.parametrize(
        "attempt",
        [
            lambda log: AuditLog._base_manager.filter(pk=log.pk).update(summary="tampered"),
            lambda log: AuditLog._base_manager.filter(pk=log.pk).delete(),
            lambda log: models.QuerySet(model=AuditLog).update(summary="tampered"),
            lambda log: models.Model.save(log, force_update=True),
            lambda log: models.Model.delete(log),
            lambda log: AuditLog._base_manager.bulk_update([log], ["summary"]),
        ],
        ids=["base-update", "base-delete", "raw-qs-update", "model-save", "model-delete", "bulk"],
    )
    def test_orm_bypass_is_stopped_by_the_database(self, log, attempt):
        log.summary = "tampered"
        with pytest.raises(DatabaseError), transaction.atomic():
            attempt(log)
        assert AuditLog.objects.get(pk=log.pk).summary == "Science [science]"

    def test_api_is_read_only(self, api, log):
        response = api.get(AUDIT)
        assert response.status_code == 200 and response.json()["count"] == 1
        row = response.json()["results"][0]
        assert row["action"] == "category.create" and row["entity_id"] == log.entity_id
        assert "user_agent" not in row
        assert api.post(AUDIT, {"action": "x"}, format="json").status_code == 405
        assert api.patch(AUDIT, {"action": "x"}, format="json").status_code == 405
        assert api.delete(AUDIT).status_code == 405
        assert api.get(f"{AUDIT}{log.pk}/").status_code == 404  # no detail/update route
        assert api.delete(f"{AUDIT}{log.pk}/").status_code == 404
        assert AuditLog.objects.count() == 1

    def test_api_filters(self, api, log):
        api.post(SUBJECTS, {"category": int(log.entity_id), "name_en": "P"}, format="json")
        assert api.get(AUDIT + "?entity_type=catalog.subject").json()["count"] == 1
        assert api.get(AUDIT + "?action=category.create").json()["count"] == 1
        query = f"?entity_type=catalog.category&entity_id={log.entity_id}"
        assert api.get(AUDIT + query).json()["count"] == 1
        assert api.get(AUDIT + f"?actor={log.actor_id}").json()["count"] == 2
        assert api.get(AUDIT + "?actor=abc").status_code == 400

    def test_django_admin_is_read_only(self, client, log):
        superuser = User.objects.create_superuser("01512345678", PW, full_name="Root")
        client.force_login(superuser)
        assert client.get("/django-admin/audit/auditlog/").status_code == 200
        assert client.get(f"/django-admin/audit/auditlog/{log.pk}/change/").status_code == 200
        assert client.get("/django-admin/audit/auditlog/add/").status_code == 403
        assert (
            client.post(
                f"/django-admin/audit/auditlog/{log.pk}/delete/", {"post": "yes"}
            ).status_code
            == 403
        )
        client.post(f"/django-admin/audit/auditlog/{log.pk}/change/", {"summary": "tampered"})
        assert AuditLog.objects.get(pk=log.pk).summary == "Science [science]"
        assert AuditLog.objects.count() == 1

    def test_actor_with_audit_history_cannot_be_deleted(self, log, admin_user):
        with pytest.raises(ProtectedError):
            admin_user.delete()
        # The supported path is deactivation, which keeps the audit trail intact.
        admin_user.is_active = False
        admin_user.save()
        assert AuditLog.objects.get(pk=log.pk).actor_id == admin_user.pk

    def test_users_without_audit_history_can_still_be_deleted(self):
        user = User.objects.create_user("01812345678", password=PW, full_name="Temp")
        user.delete()
        assert not User.objects.filter(pk=user.pk).exists()


@pytest.mark.django_db(transaction=True)
def test_migration_reversal_removes_trigger_before_table():
    """audit 0001 reversed: trigger + function dropped, table dropped; re-applied cleanly."""
    from django.core.management import call_command

    def trigger_objects():
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT count(*) FROM pg_trigger WHERE tgname = 'audit_auditlog_append_only'"
            )
            triggers = cursor.fetchone()[0]
            cursor.execute(
                "SELECT count(*) FROM pg_proc WHERE proname = 'audit_auditlog_block_changes'"
            )
            return triggers, cursor.fetchone()[0]

    assert trigger_objects() == (1, 1)
    with transaction.atomic():
        audit.record(AuditContext(), action="x.y", entity_type="x", entity_id=1)
    call_command("migrate", "audit", "zero", verbosity=0)
    try:
        assert trigger_objects() == (0, 0)
        assert "audit_auditlog" not in connection.introspection.table_names()
    finally:
        # Every app, not just audit: migrations that depend on audit (payments.0002 reads
        # the package audit history) were unapplied with it and must come back too.
        call_command("migrate", verbosity=0)
    assert trigger_objects() == (1, 1)
    assert AuditLog.objects.count() == 0
