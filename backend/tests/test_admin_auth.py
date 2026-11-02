"""Milestone 7: Admin Panel sign-in (session cookie + CSRF), admin role only."""

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.audit.models import AuditLog
from tests.test_subscriptions import jwt_client

pytestmark = pytest.mark.django_db

PW = "Strong-Pass-2026"
BASE = "/api/v1/admin/auth/"


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def admin():
    return User.objects.create_user("01611111111", password=PW, full_name="Ops", role=Role.ADMIN)


@pytest.fixture
def student():
    return User.objects.create_user("01722222222", password=PW, full_name="Student")


def csrf_client():
    """A browser-like client: CSRF checks on, token cookie fetched first."""
    client = APIClient(enforce_csrf_checks=True)
    assert client.get(f"{BASE}csrf/").status_code == 204
    token = client.cookies["csrftoken"].value
    return client, token


def sign_in(client, token, mobile="01611111111", password=PW):
    return client.post(
        f"{BASE}login/",
        {"mobile_number": mobile, "password": password},
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )


def test_login_me_logout_flow(admin):
    client, token = csrf_client()
    response = sign_in(client, token)
    assert response.status_code == 200
    assert response.json() == {
        "full_name": "Ops",
        "mobile_number": response.json()["mobile_number"],
        "preferred_language": admin.preferred_language,
        "role": "admin",
    }
    assert "01611111111" not in response.content.decode()  # masked
    assert client.cookies["sessionid"]["httponly"]
    assert AuditLog.objects.filter(action="admin.login", actor=admin).count() == 1
    assert client.get(f"{BASE}me/").status_code == 200
    assert client.get("/api/v1/admin/dashboard/").status_code == 200
    token = client.cookies["csrftoken"].value  # rotated on login
    assert client.post(f"{BASE}logout/").status_code == 403  # no CSRF token
    assert client.post(f"{BASE}logout/", HTTP_X_CSRFTOKEN=token).status_code == 204
    assert client.get(f"{BASE}me/").status_code == 401


def test_login_requires_csrf(admin):
    client = APIClient(enforce_csrf_checks=True)
    response = client.post(
        f"{BASE}login/", {"mobile_number": "01611111111", "password": PW}, format="json"
    )
    assert response.status_code == 403
    assert "sessionid" not in client.cookies


@pytest.mark.parametrize("who", ["student", "wrong_password", "unknown", "inactive"])
def test_non_admins_and_bad_credentials_get_one_generic_error(admin, student, who):
    client, token = csrf_client()
    if who == "inactive":
        User.objects.filter(pk=admin.pk).update(is_active=False)
    mobile, password = {
        "student": ("01722222222", PW),
        "wrong_password": ("01611111111", "nope-nope-1"),
        "unknown": ("01799999999", PW),
        "inactive": ("01611111111", PW),
    }[who]
    response = sign_in(client, token, mobile, password)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_credentials"
    assert client.get(f"{BASE}me/").status_code == 401
    assert not AuditLog.objects.filter(action="admin.login").exists()


def test_login_is_throttled(settings, admin):
    settings.AUTH_THROTTLE_RATES = {**settings.AUTH_THROTTLE_RATES, "admin_login": "2/hour"}
    client, token = csrf_client()
    for _ in range(2):
        assert sign_in(client, token, password="wrong-pass-1").status_code == 401
    assert sign_in(client, token).status_code == 429


def test_student_jwt_is_not_admin_auth(student):
    client = jwt_client(student)
    assert client.get(f"{BASE}me/").status_code == 401
    assert client.get("/api/v1/admin/dashboard/").status_code == 401


def test_admin_session_is_not_student_auth(admin):
    client, token = csrf_client()
    sign_in(client, token)
    assert client.get("/api/v1/me/").status_code == 401


# --------------------------------------------------------------------------------------
# Session lifetime, rotation, invalidation
# --------------------------------------------------------------------------------------
def test_admin_session_expires_after_twelve_hours(settings, admin):
    assert settings.ADMIN_SESSION_AGE_SECONDS == 12 * 60 * 60
    client, token = csrf_client()
    assert sign_in(client, token).status_code == 200
    assert 12 * 3600 - 5 <= client.session.get_expiry_age() <= 12 * 3600
    assert client.cookies["sessionid"]["max-age"] == 12 * 3600
    # Only this session: other sessions keep Django's default lifetime.
    other = APIClient()
    other.force_login(admin)
    assert other.session.get_expiry_age() == settings.SESSION_COOKIE_AGE != 12 * 3600


def test_session_id_rotates_on_login(admin):
    client, token = csrf_client()
    session = client.session
    session["visited"] = True
    session.save()
    client.cookies["sessionid"] = session.session_key
    before = session.session_key
    assert sign_in(client, token).status_code == 200
    assert client.cookies["sessionid"].value != before


def test_logout_invalidates_the_session_server_side(admin):
    client, token = csrf_client()
    sign_in(client, token)
    stolen = client.cookies["sessionid"].value
    client.post(f"{BASE}logout/", HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value)
    replay = APIClient()
    replay.cookies["sessionid"] = stolen
    assert replay.get(f"{BASE}me/").status_code == 401


def test_deactivated_admin_loses_access_immediately(admin):
    client, token = csrf_client()
    sign_in(client, token)
    User.objects.filter(pk=admin.pk).update(is_active=False)
    assert client.get(f"{BASE}me/").status_code in (401, 403)
    assert client.get("/api/v1/admin/dashboard/").status_code in (401, 403)


# --------------------------------------------------------------------------------------
# Throttles: admin buckets are separate from student login buckets
# --------------------------------------------------------------------------------------
def student_login(mobile, password, **extra):
    return APIClient().post(
        "/api/v1/auth/login/",
        {"mobile_number": mobile, "password": password},
        format="json",
        **extra,
    )


def _rates(settings, **rates):
    settings.AUTH_THROTTLE_RATES = {**settings.AUTH_THROTTLE_RATES, **rates}


def test_student_logins_do_not_use_up_the_admin_budget(settings, admin, student):
    _rates(settings, login_ip="100/hour", admin_login_ip="2/hour", login="100/hour")
    for _ in range(5):
        assert student_login("01722222222", PW).status_code == 200
    client, token = csrf_client()
    assert sign_in(client, token).status_code == 200


def test_admin_logins_do_not_use_up_the_student_budget(settings, admin, student):
    _rates(settings, login_ip="2/hour", admin_login_ip="100/hour", admin_login="100/hour")
    for _ in range(5):
        client, token = csrf_client()
        assert sign_in(client, token).status_code == 200
    assert student_login("01722222222", PW).status_code == 200


def test_admin_ip_budget_is_enforced(settings, admin):
    _rates(settings, admin_login_ip="3/hour", admin_login="100/hour")
    client, token = csrf_client()
    for i in range(3):
        assert sign_in(client, token, mobile=f"0161111110{i}", password="x").status_code == 401
    assert sign_in(client, token).status_code == 429  # correct password, but the IP is out


def test_429_does_not_reveal_whether_the_account_exists(settings, admin):
    _rates(settings, admin_login="1/hour", admin_login_ip="100/hour")
    bodies = []
    for mobile in ("01611111111", "01799999999"):  # real admin, unknown number
        client, token = csrf_client()
        sign_in(client, token, mobile=mobile, password="wrong-pass-1")
        blocked = sign_in(client, token, mobile=mobile, password="wrong-pass-1")
        assert blocked.status_code == 429
        bodies.append(
            (blocked.json()["error"]["code"], blocked.headers.get("Retry-After") is not None)
        )
    assert bodies[0] == bodies[1]


# --------------------------------------------------------------------------------------
# Real client IP behind the reverse proxy (nginx: TRUSTED_PROXY_COUNT=1)
# --------------------------------------------------------------------------------------
NGINX = "10.0.0.5"  # REMOTE_ADDR as seen by Django = the reverse proxy


def test_audit_records_the_real_client_ip_behind_one_proxy(settings, admin):
    settings.TRUSTED_PROXY_COUNT = 1
    client, token = csrf_client()
    # A client-supplied X-Forwarded-For ("6.6.6.6") is ignored: nginx appends the real
    # address on the right and only the trusted hop counts.
    response = client.post(
        f"{BASE}login/",
        {"mobile_number": "01611111111", "password": PW},
        format="json",
        HTTP_X_CSRFTOKEN=token,
        REMOTE_ADDR=NGINX,
        HTTP_X_FORWARDED_FOR="6.6.6.6, 203.0.113.9",
    )
    assert response.status_code == 200
    latest = AuditLog.objects.filter(action="admin.login").order_by("-id").first()
    assert latest.ip_address == "203.0.113.9"


def test_throttle_buckets_follow_the_real_ip_not_spoofed_headers(settings, admin):
    settings.TRUSTED_PROXY_COUNT = 1
    _rates(settings, admin_login_ip="2/hour", admin_login="100/hour")

    def attempt(real_ip, spoof):
        client, token = csrf_client()
        return client.post(
            f"{BASE}login/",
            {"mobile_number": "01799999999", "password": "x"},
            format="json",
            HTTP_X_CSRFTOKEN=token,
            REMOTE_ADDR=NGINX,
            HTTP_X_FORWARDED_FOR=f"{spoof}, {real_ip}",
        ).status_code

    assert attempt("203.0.113.9", "1.1.1.1") == 401
    assert attempt("203.0.113.9", "2.2.2.2") == 401
    assert attempt("203.0.113.9", "3.3.3.3") == 429  # rotating the spoofed part does not help
    assert attempt("198.51.100.7", "1.1.1.1") == 401  # another real client has its own bucket


def test_without_trusted_proxy_forwarded_headers_are_ignored(settings, admin):
    settings.TRUSTED_PROXY_COUNT = 0
    _rates(settings, admin_login_ip="2/hour", admin_login="100/hour")
    for spoof in ("1.1.1.1", "2.2.2.2"):
        client, token = csrf_client()
        response = client.post(
            f"{BASE}login/",
            {"mobile_number": "01799999999", "password": "x"},
            format="json",
            HTTP_X_CSRFTOKEN=token,
            HTTP_X_FORWARDED_FOR=spoof,
        )
        assert response.status_code == 401
    client, token = csrf_client()
    blocked = client.post(
        f"{BASE}login/",
        {"mobile_number": "01799999999", "password": "x"},
        format="json",
        HTTP_X_CSRFTOKEN=token,
        HTTP_X_FORWARDED_FOR="9.9.9.9",
    )
    assert blocked.status_code == 429  # a forged header cannot open a new bucket
