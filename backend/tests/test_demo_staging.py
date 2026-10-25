"""Staging / client-demo infrastructure: the demo guards, ``seed_demo`` (deterministic,
idempotent, synthetic, payment-safe) and ``create_demo_admin``, plus sanity checks of the
committed staging configuration (Compose file and env template)."""

import io
import re
from datetime import timedelta
from pathlib import Path
from unittest import mock

import pytest
import yaml
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone

from apps.accounts.models import Role, User
from apps.audit.models import AuditLog
from apps.core import demo
from apps.core.management.commands.seed_demo import STUDENTS, counts
from apps.payments import services as payment_services
from apps.payments.models import Payment
from apps.results.models import Result
from apps.subscriptions.models import Package, Subscription

REPO = Path(__file__).resolve().parents[2]
DEMO_PASSWORD = "Demo-Only-Test-Passphrase-2026"  # test value only


@pytest.fixture
def demo_env(monkeypatch):
    monkeypatch.setenv("DEMO_SEED_ALLOWED", "true")
    monkeypatch.setenv("DEMO_ENVIRONMENT", "staging-demo")
    with mock.patch.object(demo, "database_name", return_value="online_mcq_demo"):
        yield


def run(*args, stdin=""):
    out = io.StringIO()
    with mock.patch("sys.stdin", io.StringIO(stdin)):
        call_command(*args, stdout=out)
    return out.getvalue()


# ======================================================================================
# Guards
# ======================================================================================
class TestGuards:
    @pytest.mark.parametrize(
        ("name", "ok"),
        [
            ("online_mcq_demo", True),
            ("online_mcq_demo_2", True),
            ("mcq_m7_qa", False),
            ("online_mcq", False),
            ("test_online_mcq", False),
            ("online_mcq_demo_x; drop", False),
            ("online_mcq_production", False),
            ("", False),
        ],
    )
    def test_demo_database_names(self, name, ok):
        assert demo.is_demo_database(name) is ok

    @pytest.mark.django_db
    @pytest.mark.parametrize("command", ["seed_demo", "create_demo_admin"])
    def test_refused_without_opt_in(self, monkeypatch, command):
        monkeypatch.delenv("DEMO_SEED_ALLOWED", raising=False)
        monkeypatch.setenv("DEMO_ENVIRONMENT", "staging-demo")
        args = [command] + (
            ["--mobile", "01800000001", "--password-stdin"] if "admin" in command else []
        )
        with mock.patch.object(demo, "database_name", return_value="online_mcq_demo"):
            with pytest.raises(CommandError, match="DEMO_SEED_ALLOWED"):
                run(*args, stdin=DEMO_PASSWORD)
        monkeypatch.setenv("DEMO_SEED_ALLOWED", "true")
        monkeypatch.setenv("DEMO_ENVIRONMENT", "local")
        with mock.patch.object(demo, "database_name", return_value="online_mcq_demo"):
            with pytest.raises(CommandError, match="DEMO_ENVIRONMENT"):
                run(*args, stdin=DEMO_PASSWORD)
        assert not User.objects.exists()

    @pytest.mark.django_db
    @pytest.mark.parametrize("name", ["mcq_m7_qa", "online_mcq", "test_online_mcq"])
    def test_refused_on_other_databases(self, monkeypatch, name):
        monkeypatch.setenv("DEMO_SEED_ALLOWED", "true")
        monkeypatch.setenv("DEMO_ENVIRONMENT", "staging-demo")
        with mock.patch.object(demo, "database_name", return_value=name):
            with pytest.raises(CommandError, match="not a demo database"):
                run("seed_demo")
            with pytest.raises(CommandError, match="not a demo database"):
                run(
                    "create_demo_admin",
                    "--mobile",
                    "01800000001",
                    "--password-stdin",
                    stdin=DEMO_PASSWORD,
                )
        assert not User.objects.exists()

    @pytest.mark.django_db
    def test_real_test_database_is_refused_without_patching(self, monkeypatch):
        monkeypatch.setenv("DEMO_SEED_ALLOWED", "true")
        monkeypatch.setenv("DEMO_ENVIRONMENT", "staging-demo")
        with pytest.raises(CommandError, match="not a demo database"):
            run("seed_demo")


# ======================================================================================
# seed_demo
# ======================================================================================
EXPECTED_COUNTS = {
    "students": 12,
    "categories": 2,
    "subjects": 5,
    "questions": 46,
    "exams": 5,
    "attempts": 18,  # 11 + 6 submitted, 1 open
    "results": 17,
    "packages": 3,
    "subscriptions": 5,  # active, scheduled, cancelled (manual) + 2 from payments
    "payments": 6,
}


@pytest.mark.django_db
class TestSeedDemo:
    def test_seeds_deterministic_synthetic_data(self, demo_env, settings):
        settings.PAYMENT_MOCK_ALLOWED = False  # the staging runtime: mock disabled
        out = run("seed_demo")
        assert "seeded" in out
        assert counts() == EXPECTED_COUNTS
        # Fictional people only: sequential placeholder numbers, no usable password.
        numbers = set(
            User.objects.filter(role=Role.STUDENT).values_list("mobile_number", flat=True)
        )
        assert numbers == {f"+880{number[1:]}" for _name, number in STUDENTS}
        assert not any(u.has_usable_password() for u in User.objects.filter(role=Role.STUDENT))
        assert User.objects.filter(role=Role.STUDENT, is_active=False).count() == 1
        assert not User.objects.filter(role=Role.ADMIN).exists()  # admins are created separately
        # Merit list on the maths exam.
        assert Result.objects.filter(exam__slug="demo-math-model-test-1", merit_position=1).exists()
        # Payments: statuses, renewal, purchased validity.
        statuses = sorted(Payment.objects.values_list("status", flat=True))
        assert statuses == ["cancelled", "failed", "pending", "success", "success", "success"]
        assert set(Payment.objects.values_list("provider", flat=True)) == {"mock"}
        renewal = Payment.objects.filter(user__full_name="Tanvir Hasan", status="success")
        assert renewal.count() == 2
        assert len({p.subscription_id for p in renewal}) == 1
        bought = Payment.objects.get(user__full_name="মাহমুদ হাসান")
        assert bought.validity_days == 30
        assert Package.objects.get(slug="demo-full-access").validity_days == 45
        sub = bought.subscription
        assert sub.expires_at - sub.starts_at == timedelta(days=30)
        # Runtime setting untouched by the seed-only mock gateway.
        assert settings.PAYMENT_MOCK_ALLOWED is False

    def test_second_run_changes_nothing(self, demo_env):
        run("seed_demo")
        before = (
            counts(),
            AuditLog.objects.count(),
            Subscription.objects.order_by("pk").values_list("pk", "expires_at", "price_paid"),
        )
        before = (before[0], before[1], list(before[2]))
        out = run("seed_demo")
        assert "already seeded" in out
        after = (
            counts(),
            AuditLog.objects.count(),
            list(Subscription.objects.order_by("pk").values_list("pk", "expires_at", "price_paid")),
        )
        assert after == before
        assert "already seeded" in run("seed_demo", "--check")

    def test_check_before_seeding(self, demo_env):
        assert "not seeded yet" in run("seed_demo", "--check")
        assert counts()["students"] == 0

    def test_runtime_never_calls_a_gateway_for_seeded_payments(self, demo_env, settings):
        run("seed_demo")
        settings.PAYMENT_MOCK_ALLOWED = False  # production settings force this
        Payment.objects.filter(status="pending").update(
            created_at=timezone.now() - timedelta(days=2)
        )
        with mock.patch.object(payment_services, "get_gateway") as gateway:
            payment_services.reconcile_payments()
        gateway.assert_not_called()  # the mock provider is disabled: skipped, no call
        assert Payment.objects.filter(status="pending").count() == 1


# ======================================================================================
# create_demo_admin
# ======================================================================================
@pytest.mark.django_db
class TestCreateDemoAdmin:
    def test_creates_admin_not_superuser_and_never_prints_password(self, demo_env):
        out = run(
            "create_demo_admin",
            "--mobile",
            "01800000001",
            "--full-name",
            "Client Demo",
            "--password-stdin",
            stdin=DEMO_PASSWORD + "\n",
        )
        assert DEMO_PASSWORD not in out
        admin = User.objects.get(mobile_number="+8801800000001")
        assert (admin.role, admin.full_name, admin.is_active) == (Role.ADMIN, "Client Demo", True)
        assert not admin.is_superuser and not admin.is_staff
        assert admin.check_password(DEMO_PASSWORD)

    def test_reset_password(self, demo_env):
        run("create_demo_admin", "--mobile", "01800000001", "--password-stdin", stdin=DEMO_PASSWORD)
        out = run(
            "create_demo_admin",
            "--mobile",
            "01800000001",
            "--password-stdin",
            stdin="Another-Demo-Passphrase-2026",
        )
        assert "new password" in out
        admin = User.objects.get(mobile_number="+8801800000001")
        assert admin.check_password("Another-Demo-Passphrase-2026")
        assert User.objects.filter(role=Role.ADMIN).count() == 1

    def test_signs_in_to_the_admin_panel(self, demo_env, client):
        run("create_demo_admin", "--mobile", "01800000001", "--password-stdin", stdin=DEMO_PASSWORD)
        client.get("/api/v1/admin/auth/csrf/")
        response = client.post(
            "/api/v1/admin/auth/login/",
            {"mobile_number": "01800000001", "password": DEMO_PASSWORD},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
        )
        assert response.status_code == 200, response.content

    @pytest.mark.parametrize("existing", ["student", "superuser"])
    def test_never_converts_other_accounts(self, demo_env, existing):
        if existing == "student":
            User.objects.create_user("01800000001", full_name="A student")
        else:
            User.objects.create_superuser(
                "01800000001", password="Ops-Pass-2026-xyz", full_name="Operator"
            )
        with pytest.raises(CommandError, match="not a demo admin"):
            run(
                "create_demo_admin",
                "--mobile",
                "01800000001",
                "--password-stdin",
                stdin=DEMO_PASSWORD,
            )
        user = User.objects.get()
        assert not user.check_password(DEMO_PASSWORD)

    @pytest.mark.parametrize("password", ["", "short", "12345678901"])
    def test_rejects_weak_or_empty_password(self, demo_env, password):
        with pytest.raises(CommandError):
            run("create_demo_admin", "--mobile", "01800000001", "--password-stdin", stdin=password)
        assert not User.objects.exists()

    def test_rejects_invalid_number(self, demo_env):
        with pytest.raises(CommandError, match="mobile"):
            run("create_demo_admin", "--mobile", "12345", "--password-stdin", stdin=DEMO_PASSWORD)


# ======================================================================================
# Committed staging configuration
# ======================================================================================
def env_template() -> dict:
    values = {}
    for line in (REPO / ".env.staging.example").read_text().splitlines():
        if line.strip() and not line.lstrip().startswith("#"):
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip()
    return values


class TestStagingConfig:
    def test_compose_publishes_only_nginx_and_isolates_the_rest(self):
        compose = yaml.safe_load((REPO / "docker-compose.staging.yml").read_text())
        services = compose["services"]
        assert set(services) == {
            "nginx",
            "admin",
            "backend",
            "celery",
            "celery-beat",
            "postgres",
            "redis",
        }
        assert [name for name, s in services.items() if s.get("ports")] == ["nginx"]
        assert compose["networks"]["internal"] == {"internal": True}
        for name, service in services.items():
            networks = service["networks"]
            names = set(networks) if isinstance(networks, dict) else set(networks)
            assert names == ({"edge", "internal"} if name == "nginx" else {"internal"}), name
            assert service["restart"] == "unless-stopped", name
            assert service["logging"]["options"]["max-size"], name
        assert services["backend"]["build"]["target"] == "production"
        assert set(compose["volumes"]) == {"postgres_data", "static_files", "media_files"}
        text = (REPO / "docker-compose.staging.yml").read_text()
        assert "mcq_m7_qa" not in text and "runserver" not in text

    def test_env_template_is_safe(self):
        env = env_template()
        assert env["POSTGRES_DB"] == "online_mcq_demo"
        assert env["DJANGO_DEBUG"] == "false"
        assert env["API_DOCS_ENABLED"] == "false"
        assert env["DJANGO_SETTINGS_MODULE"] == "config.settings.prod"
        assert env["TRUSTED_PROXY_COUNT"] == "1"
        assert env["CSRF_TRUSTED_ORIGINS"] == ""
        assert env["PAYMENT_PROVIDER"] != "mock"
        assert env["SSLCOMMERZ_SANDBOX"] == "true"
        assert env["DEMO_ENVIRONMENT"] == demo.DEMO_ENVIRONMENT_MARKER
        # Secrets are placeholders that production settings refuse until replaced.
        for key in ("DJANGO_SECRET_KEY", "JWT_SIGNING_KEY", "POSTGRES_PASSWORD"):
            assert env[key] == "change-me", key
        assert env["SSLCOMMERZ_STORE_ID"].startswith("demo-placeholder")
        assert env["SSLCOMMERZ_STORE_PASSWORD"].startswith("demo-placeholder")
        assert all(
            "example.com" in env[k] for k in ("DEMO_HOST", "API_ORIGIN", "DJANGO_ALLOWED_HOSTS")
        )
        assert "mcq_m7_qa" not in (REPO / ".env.staging.example").read_text()

    def test_nginx_sites_route_one_origin(self):
        for name in ("demo-admin.conf", "demo-admin-http.conf"):
            text = (REPO / "deploy" / "nginx" / name).read_text()
            for needle in (
                "location /api/",
                "location /static/",
                "location /media/",
                "X-Forwarded-Proto",
                "X-Forwarded-For",
                'X-Robots-Tag "noindex, nofollow"',
                "server backend:8000",
                "server admin:3000",
                "${DEMO_HOST}",
            ):
                assert needle in text, (name, needle)
            assert not re.search(
                r"\b(?!example)\w+\.(com|net|org|bd)\b", text.replace("demo-admin.example.com", "")
            )
        https = (REPO / "deploy" / "nginx" / "demo-admin.conf").read_text()
        assert "listen 443 ssl" in https and "return 301 https://" in https
        assert (
            "ssl_certificate"
            not in (REPO / "deploy" / "nginx" / "demo-admin-http.conf").read_text()
        )
