"""Admin Users API (Milestone 7E): read-only list and detail with masked personal data."""

import json
from datetime import timedelta

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.api.admin_users import mask_email
from apps.accounts.models import Role, StudentProfile, User
from apps.payments import services as payment_services
from apps.subscriptions.models import Subscription
from tests.test_attempts import published, start
from tests.test_exams import make_subject
from tests.test_results import take
from tests.test_subscriptions import all_paid, grant, jwt_client, make_package

pytestmark = pytest.mark.django_db

USERS = "/api/v1/admin/users/"
PW = "Strong-Pass-2026"  # test-only value
LIST_FIELDS = {
    "id",
    "full_name",
    "display_name",
    "role",
    "preferred_language",
    "is_active",
    "is_mobile_verified",
    "mobile_display",
    "email_display",
    "date_joined",
    "updated_at",
}
DETAIL_FIELDS = LIST_FIELDS | {
    "attempts_count",
    "results_count",
    "active_subscriptions_count",
    "payments_count",
}
NEVER = (
    "password",
    "auth_version",
    "is_staff",
    "is_superuser",
    "groups",
    "user_permissions",
    "permissions",
    "mobile_number",
    "email",
    "token",
    "otp",
    "last_login",
)


@pytest.fixture(autouse=True)
def _settings(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "media")
    settings.PAYMENT_PROVIDER = "mock"
    settings.PAYMENT_MOCK_ALLOWED = True
    settings.PAYMENT_CALLBACK_BASE_URL = "https://api.test"
    settings.PAYMENT_RETURN_URL = "https://app.test/return"


@pytest.fixture
def admin():
    return User.objects.create_user(
        "01612345678",
        password=PW,
        full_name="Ops Admin",
        role=Role.ADMIN,
        email="ops@corp.example",
        preferred_language="en",  # English messages, whether or not .mo files are compiled
    )


@pytest.fixture
def client(admin):
    api = APIClient()
    api.force_login(admin)
    return api


def student(mobile, name, email=None, **fields):
    user = User.objects.create_user(mobile, password=PW, full_name=name, email=email, **fields)
    user.ensure_student_profile()
    return user


@pytest.fixture
def people(admin):
    rahim = student("01712345678", "Rahim Uddin", "rahim.uddin@gmail.com")
    StudentProfile.objects.filter(user=rahim).update(display_name="Rahim U.")
    karima = student("01812345679", "Karima Begum")
    inactive = student("01912000111", "Nadia Inactive", "nadia@example.org", is_active=False)
    return {"admin": admin, "rahim": rahim, "karima": karima, "inactive": inactive}


def ids(response):
    assert response.status_code == 200, response.content
    return [row["id"] for row in response.json()["results"]]


# --------------------------------------------------------------------------------------
# Fields, masking, permissions, methods
# --------------------------------------------------------------------------------------
class TestFieldsAndMasking:
    def test_list_rows_have_exactly_the_safe_fields(self, client, people):
        body = client.get(USERS).json()
        assert body["count"] == 4
        for row in body["results"]:
            assert set(row) == LIST_FIELDS
        text = json.dumps(body)
        for name in NEVER:
            assert f'"{name}"' not in text

    def test_personal_data_is_masked_and_raw_values_never_returned(self, client, people):
        body = client.get(USERS).json()
        text = json.dumps(body)
        for user in people.values():
            assert user.mobile_number not in text
            assert "01712345678" not in text
            if user.email:
                assert user.email not in text
        rahim = next(r for r in body["results"] if r["id"] == people["rahim"].pk)
        assert rahim["mobile_display"] == "+88017*****678"
        assert rahim["email_display"] == "r***@g***.com"
        assert rahim["display_name"] == "Rahim U."
        karima = next(r for r in body["results"] if r["id"] == people["karima"].pk)
        assert karima["email_display"] is None
        admin = next(r for r in body["results"] if r["id"] == people["admin"].pk)
        assert admin["display_name"] == "" and admin["role"] == "admin"

    def test_detail_has_exactly_the_safe_fields(self, client, people):
        body = client.get(f"{USERS}{people['rahim'].pk}/").json()
        assert set(body) == DETAIL_FIELDS
        assert people["rahim"].mobile_number not in json.dumps(body)
        assert body["mobile_display"] == "+88017*****678"

    @pytest.mark.parametrize(
        ("value", "masked"),
        [
            ("rahim.uddin@gmail.com", "r***@g***.com"),
            ("a@b.co", "a***@b***.co"),
            ("x@localhost", "x***@l***"),
            ("", None),
            (None, None),
            ("not-an-email", None),
        ],
    )
    def test_mask_email(self, value, masked):
        assert mask_email(value) == masked

    def test_admin_only(self, people):
        assert APIClient().get(USERS).status_code == 401
        assert APIClient().get(f"{USERS}{people['rahim'].pk}/").status_code == 401
        assert jwt_client(people["rahim"]).get(USERS).status_code == 401  # no student JWT
        session = APIClient()
        session.force_login(people["rahim"])
        assert session.get(USERS).status_code == 403
        assert session.get(f"{USERS}{people['rahim'].pk}/").status_code == 403

    @pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
    def test_read_only(self, client, people, method):
        target = people["rahim"]
        for path in (USERS, f"{USERS}{target.pk}/"):
            response = getattr(client, method)(path, {"is_active": False}, format="json")
            assert response.status_code == 405
        target.refresh_from_db()
        assert target.is_active is True

    def test_detail_404(self, client, people):
        assert client.get(f"{USERS}999999/").status_code == 404


# --------------------------------------------------------------------------------------
# Search, filters, ordering, pagination
# --------------------------------------------------------------------------------------
class TestSearch:
    def test_name_full_and_partial(self, client, people):
        assert ids(client.get(f"{USERS}?search=Rahim Uddin")) == [people["rahim"].pk]
        assert ids(client.get(f"{USERS}?search=karim")) == [people["karima"].pk]
        assert ids(client.get(f"{USERS}?search=nobody")) == []

    def test_mobile_any_form_and_bangla_digits(self, client, people):
        rahim = [people["rahim"].pk]
        for value in ("01712345678", "+8801712345678", "8801712345678", "017-1234-5678"):
            assert ids(client.get(USERS, {"search": value})) == rahim
        assert ids(client.get(USERS, {"search": "০১৭১২৩৪৫৬৭৮"})) == rahim  # Bangla digits

    def test_mobile_fragment(self, client, people):
        assert ids(client.get(USERS, {"search": "712345678"})) == [people["rahim"].pk]
        assert ids(client.get(USERS, {"search": "১২৩৪৫৬৭৯"})) == [people["karima"].pk]
        # Fewer than 3 digits never match numbers (a name/email match still could).
        assert ids(client.get(USERS, {"search": "17"})) == []

    def test_email(self, client, people):
        assert ids(client.get(USERS, {"search": "rahim.uddin@gmail"})) == [people["rahim"].pk]
        assert ids(client.get(USERS, {"search": "example.org"})) == [people["inactive"].pk]

    def test_search_keeps_masking(self, client, people):
        body = client.get(USERS, {"search": "01712345678"}).json()
        assert body["results"][0]["mobile_display"] == "+88017*****678"
        assert "01712345678" not in json.dumps(body)
        body = client.get(USERS, {"search": "rahim.uddin@gmail.com"}).json()
        assert "rahim.uddin@gmail.com" not in json.dumps(body)

    def test_search_too_long(self, client, people):
        assert client.get(USERS, {"search": "x" * 101}).status_code == 400


class TestFiltersAndOrdering:
    def test_role(self, client, people):
        assert ids(client.get(f"{USERS}?role=admin")) == [people["admin"].pk]
        assert set(ids(client.get(f"{USERS}?role=student"))) == {
            people["rahim"].pk,
            people["karima"].pk,
            people["inactive"].pk,
        }
        assert client.get(f"{USERS}?role=owner").status_code == 400

    def test_active(self, client, people):
        assert ids(client.get(f"{USERS}?is_active=false")) == [people["inactive"].pk]
        assert people["inactive"].pk not in ids(client.get(f"{USERS}?is_active=true"))
        assert client.get(f"{USERS}?is_active=maybe").status_code == 400

    def test_ordering(self, client, people):
        base = timezone.now() - timedelta(days=10)
        for offset, key in enumerate(("karima", "admin", "rahim", "inactive")):
            User.objects.filter(pk=people[key].pk).update(date_joined=base + timedelta(days=offset))
        joined = [people[k].pk for k in ("karima", "admin", "rahim", "inactive")]
        assert ids(client.get(f"{USERS}?ordering=date_joined")) == joined
        assert ids(client.get(f"{USERS}?ordering=-date_joined")) == joined[::-1]
        assert ids(client.get(USERS)) == joined[::-1]  # default: newest first
        names = [people[k].pk for k in ("karima", "inactive", "admin", "rahim")]
        assert ids(client.get(f"{USERS}?ordering=full_name")) == names
        assert ids(client.get(f"{USERS}?ordering=-full_name")) == names[::-1]

    def test_unknown_ordering_rejected(self, client, people):
        for value in ("mobile_number", "email", "password", "-auth_version"):
            response = client.get(f"{USERS}?ordering={value}")
            assert response.status_code == 400
            assert response.json()["error"]["field_errors"] == {
                "ordering": ["Unknown ordering field."]
            }

    def test_pagination(self, client, people):
        first = client.get(f"{USERS}?page_size=3&ordering=full_name").json()
        assert first["count"] == 4 and len(first["results"]) == 3 and first["next"]
        second = client.get(f"{USERS}?page_size=3&ordering=full_name&page=2").json()
        assert len(second["results"]) == 1

    def test_list_query_count_does_not_grow_with_rows(self, client, people):
        for n in range(6):
            student(f"0171500{n:04d}", f"Extra {n}", f"extra{n}@example.org")
        with CaptureQueriesContext(connection) as one:
            assert client.get(f"{USERS}?page_size=1").status_code == 200
        with CaptureQueriesContext(connection) as many:
            assert client.get(f"{USERS}?page_size=10").status_code == 200
        assert len(many.captured_queries) == len(one.captured_queries)


# --------------------------------------------------------------------------------------
# Detail counts
# --------------------------------------------------------------------------------------
class TestDetailCounts:
    def test_counts_use_each_module_definition(self, client, people):
        rahim = people["rahim"]
        subject = make_subject()
        take(rahim, published(subject, title_en="One"), "c--")  # attempt + result
        take(rahim, published(subject, title_en="Two"), "cc-")  # attempt + result
        start(rahim, published(subject, title_en="Open"))  # attempt in progress, no result
        now = timezone.now()
        gold = make_package("gold", rules=all_paid())
        silver = make_package("silver", rules=all_paid())
        bronze = make_package("bronze", rules=all_paid())
        later = make_package("later", rules=all_paid())
        grant(rahim, gold)  # active
        grant(rahim, silver)  # parallel active (another package)
        expired = grant(rahim, bronze).subscription
        Subscription.objects.filter(pk=expired.pk).update(
            starts_at=now - timedelta(days=40), expires_at=now - timedelta(days=10)
        )
        grant(rahim, later, starts_at=now + timedelta(days=5))  # scheduled: not active yet
        payment_services.initiate_payment(rahim, gold.pk, idempotency_key="k1")
        payment_services.initiate_payment(rahim, silver.pk, idempotency_key="k2")
        body = client.get(f"{USERS}{rahim.pk}/").json()
        assert body["attempts_count"] == 3
        assert body["results_count"] == 2
        assert body["active_subscriptions_count"] == 2  # not expired, not scheduled
        assert body["payments_count"] == 2

    def test_counts_are_per_user(self, client, people):
        take(people["karima"], published(make_subject(), title_en="Karima"), "c--")
        body = client.get(f"{USERS}{people['rahim'].pk}/").json()
        assert body["attempts_count"] == 0 and body["results_count"] == 0
        assert body["active_subscriptions_count"] == 0 and body["payments_count"] == 0
        other = client.get(f"{USERS}{people['karima'].pk}/").json()
        assert other["attempts_count"] == 1 and other["results_count"] == 1

    def test_counts_only_on_detail(self, client, people):
        row = client.get(USERS).json()["results"][0]
        assert "attempts_count" not in row and "payments_count" not in row


# --------------------------------------------------------------------------------------
# Activate / deactivate (Milestone 10C: requirement "Activate/deactivate account")
# --------------------------------------------------------------------------------------
class TestActivation:
    @staticmethod
    def url(user, action):
        return f"{USERS}{user.pk}/{action}/"

    @staticmethod
    def signed_in(user):
        from apps.accounts.tokens import issue_tokens

        return issue_tokens(user)

    @staticmethod
    def api_status(access=None, refresh=None, login=None):
        api = APIClient()
        if access:
            api.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
            return api.get("/api/v1/me/").status_code
        if refresh:
            return api.post(
                "/api/v1/auth/token/refresh/", {"refresh": refresh}, format="json"
            ).status_code
        return api.post(
            "/api/v1/auth/login/", {"mobile_number": login, "password": PW}, format="json"
        ).status_code

    def test_deactivate_signs_the_student_out_everywhere_and_is_audited(self, client, people):
        from apps.audit.models import AuditLog

        rahim = people["rahim"]
        tokens = self.signed_in(rahim)
        assert self.api_status(access=tokens["access"]) == 200
        response = client.post(self.url(rahim, "deactivate"))
        assert response.status_code == 200, response.content
        body = response.json()
        assert set(body) == DETAIL_FIELDS and body["is_active"] is False
        assert "01712345678" not in response.content.decode()  # still masked
        assert self.api_status(access=tokens["access"]) == 401
        assert self.api_status(refresh=tokens["refresh"]) == 401
        assert self.api_status(login="01712345678") == 401
        entry = AuditLog.objects.get(action="user.deactivate")
        assert (entry.entity_type, entry.entity_id) == ("accounts.user", str(rahim.pk))
        assert entry.actor_id == people["admin"].pk
        assert entry.metadata == {"changes": {"is_active": {"from": True, "to": False}}}

    def test_activate_restores_sign_in_but_not_old_tokens(self, client, people):
        from apps.audit.models import AuditLog

        rahim = people["rahim"]
        old = self.signed_in(rahim)
        client.post(self.url(rahim, "deactivate"))
        response = client.post(self.url(rahim, "activate"))
        assert response.status_code == 200 and response.json()["is_active"] is True
        assert self.api_status(access=old["access"]) == 401  # revoked for good
        assert self.api_status(refresh=old["refresh"]) == 401
        assert self.api_status(login="01712345678") == 200  # a fresh sign-in works
        assert AuditLog.objects.get(action="user.activate").metadata == {
            "changes": {"is_active": {"from": False, "to": True}}
        }

    def test_same_state_changes_nothing(self, client, people):
        from apps.audit.models import AuditLog

        rahim, nadia = people["rahim"], people["inactive"]
        assert client.post(self.url(rahim, "activate")).json()["is_active"] is True
        assert client.post(self.url(nadia, "deactivate")).json()["is_active"] is False
        assert not AuditLog.objects.filter(action__startswith="user.").exists()

    def test_staff_accounts_are_refused(self, client, people):
        admin = people["admin"]
        other = User.objects.create_user("01612345600", password=PW, full_name="X", role=Role.ADMIN)
        for target in (admin, other):  # never yourself, never another admin
            response = client.post(self.url(target, "deactivate"))
            assert response.status_code == 409
            assert response.json()["error"]["code"] == "not_a_student"
            target.refresh_from_db()
            assert target.is_active is True

    def test_unknown_user(self, client, people):
        assert client.post(f"{USERS}999999/deactivate/").status_code == 404

    def test_admin_session_csrf_and_role_required(self, people):
        rahim = people["rahim"]
        assert APIClient().post(self.url(rahim, "deactivate")).status_code == 401
        assert jwt_client(people["karima"]).post(self.url(rahim, "deactivate")).status_code == 401
        session = APIClient()
        session.force_login(people["karima"])  # a student's session
        assert session.post(self.url(rahim, "deactivate")).status_code == 403
        strict = APIClient(enforce_csrf_checks=True)
        strict.force_login(people["admin"])
        assert strict.post(self.url(rahim, "deactivate")).status_code == 403  # no CSRF token
        for method in ("get", "put", "patch", "delete"):
            assert getattr(APIClient(), method)(self.url(rahim, "activate")).status_code in (
                401,
                405,
            )
        rahim.refresh_from_db()
        assert rahim.is_active is True

    def test_history_is_kept(self, client, people):
        rahim = people["rahim"]
        grant(rahim, make_package("gold", rules=all_paid()))
        before = client.get(f"{USERS}{rahim.pk}/").json()
        client.post(self.url(rahim, "deactivate"))
        after = client.post(self.url(rahim, "activate")).json()
        for field in ("attempts_count", "results_count", "active_subscriptions_count"):
            assert after[field] == before[field]
        assert Subscription.objects.filter(user=rahim).count() == 1
