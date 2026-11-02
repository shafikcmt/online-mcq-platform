"""Sanity checks of the committed PRODUCTION deployment configuration: the Compose file,
the nginx templates and the env template. They guard the properties the live server relies
on (only nginx public, database and Redis isolated, images pinned by commit, website
indexable, admin never indexed, no secrets in the repository)."""

import os
import re
import secrets
import subprocess
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[2]
NGINX = REPO / "deploy" / "nginx"


def compose():
    return yaml.safe_load((REPO / "docker-compose.prod.yml").read_text())


def network_names(service):
    networks = service["networks"]
    return set(networks) if isinstance(networks, dict) else set(networks)


def env_template():
    values = {}
    for line in (REPO / ".env.prod.example").read_text().splitlines():
        if line.strip() and not line.lstrip().startswith("#"):
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip()
    return values


class TestCompose:
    def test_only_nginx_publishes_ports(self):
        services = compose()["services"]
        assert set(services) == {
            "nginx",
            "admin",
            "website",
            "backend",
            "celery",
            "celery-beat",
            "postgres",
            "redis",
        }
        assert [name for name, s in services.items() if s.get("ports")] == ["nginx"]

    def test_database_and_redis_are_isolated_from_the_internet(self):
        config = compose()
        assert config["networks"]["internal"] == {"internal": True}
        services = config["services"]
        for name in ("postgres", "redis"):
            assert network_names(services[name]) == {"internal"}, name
        # Integrations (payment gateway, SMS) need the internet: backend and Celery only.
        for name in ("backend", "celery", "celery-beat"):
            assert network_names(services[name]) == {"internal", "egress"}, name
        for name in ("admin", "website"):
            assert network_names(services[name]) == {"internal"}, name
        assert network_names(services["nginx"]) == {"edge", "internal"}

    def test_images_come_from_the_registry_pinned_by_commit(self):
        for name, service in compose()["services"].items():
            assert "build" not in service, f"{name} must not be built on the server"
            if name in {"backend", "celery", "celery-beat", "admin", "website"}:
                assert service["image"].endswith(
                    ":${IMAGE_TAG:?IMAGE_TAG (the git commit SHA) must be set}"
                ), name
                assert "ghcr.io/shafikcmt/online-mcq-platform" in service["image"], name

    def test_services_are_resilient_and_bounded(self):
        for name, service in compose()["services"].items():
            assert service["restart"] == "unless-stopped", name
            assert service["logging"]["options"]["max-size"], name
            assert service["mem_limit"], name
            if name not in {"celery", "celery-beat"}:
                assert service["healthcheck"], name

    def test_data_volumes_are_persistent_and_named(self):
        config = compose()
        assert config["name"] == "mcq-prod"  # fixed project name → the same volumes every release
        assert set(config["volumes"]) == {"postgres_data", "static_files", "media_files"}
        assert "postgres_data:/var/lib/postgresql/data" in config["services"]["postgres"]["volumes"]

    def test_no_demo_or_qa_leftovers(self):
        text = (REPO / "docker-compose.prod.yml").read_text()
        assert "mcq_m7_qa" not in text and "runserver" not in text
        assert "SITE_NOINDEX" not in compose()["services"]["website"].get("environment", {})


class TestNginx:
    def test_website_is_indexable_and_admin_is_not(self):
        site = (NGINX / "prod-site.conf").read_text()
        admin = (NGINX / "prod-admin.conf").read_text()
        assert "add_header X-Robots-Tag" not in site and "location = /robots.txt" not in site
        # Every add_header group on the admin host repeats the noindex header.
        server = admin.split("listen 443", 1)[1]
        assert server.count('X-Robots-Tag "noindex, nofollow" always') == server.count(
            "Strict-Transport-Security"
        ) - server.count("proxy_hide_header Strict-Transport-Security")

    def test_website_host_exposes_only_the_public_api(self):
        site = (NGINX / "prod-site.conf").read_text()
        locations = re.findall(r"location\s+(\S+)", site)
        assert "/api/v1/public/" in locations
        assert re.search(r"location /api/ \{\s*return 404;", site)
        assert "${DJANGO_ADMIN_URL}" not in site

    def test_www_redirects_to_the_canonical_host(self):
        site = (NGINX / "prod-site.conf").read_text()
        assert "server_name www.${SITE_HOST};" in site
        assert site.count("return 301 https://${SITE_HOST}$request_uri;") == 2

    def test_unknown_hosts_are_dropped(self):
        default = (NGINX / "prod-default.conf").read_text()
        assert "listen 80 default_server;" in default and "return 444;" in default
        assert "listen 443 ssl default_server;" in default and "ssl_reject_handshake on;" in default

    def test_compose_mounts_every_production_template(self):
        volumes = compose()["services"]["nginx"]["volumes"]
        for name in ("prod-default.conf", "prod-site.conf", "prod-admin.conf"):
            assert any(
                v.startswith(f"./deploy/nginx/{name}:/etc/nginx/templates/") for v in volumes
            )
            assert (NGINX / name).exists()


def admin_locations():
    """{location path: body} of the HTTPS server on the admin host."""
    server = (NGINX / "prod-admin.conf").read_text().split("listen 443", 1)[1]
    return dict(re.findall(r"location\s+(?:= )?(\S+)\s*\{(.*?)\n    \}", server, re.S))


class TestAdminBasicAuth:
    def test_basic_auth_covers_panel_pages_and_django_admin_only(self):
        locations = admin_locations()
        protected = {path for path, body in locations.items() if "auth_basic " in body}
        assert protected == {"/", "/${DJANGO_ADMIN_URL}"}
        # The mobile app, payment callbacks and the panel's own API calls, the question
        # images and the robots file stay reachable without the extra password.
        for path in ("/api/", "/media/", "/static/", "/robots.txt"):
            assert path in locations and "auth_basic" not in locations[path], path
        for path in protected:
            assert "auth_basic_user_file /etc/nginx/auth/admin.htpasswd;" in locations[path]

    def test_basic_auth_password_is_never_forwarded(self):
        locations = admin_locations()
        for path in ("/", "/${DJANGO_ADMIN_URL}"):
            assert 'proxy_set_header Authorization     "";' in locations[path], path
        # The API keeps Bearer tokens (mobile app) but drops "Basic …" headers.
        assert "proxy_set_header Authorization     $admin_api_authorization;" in locations["/api/"]
        conf = (NGINX / "prod-admin.conf").read_text()
        assert '"~*^Basic " "";' in conf

    def test_password_file_is_mounted_from_the_server_read_only(self):
        volumes = compose()["services"]["nginx"]["volumes"]
        assert "/srv/mcq/nginx/admin.htpasswd:/etc/nginx/auth/admin.htpasswd:ro" in volumes
        assert not list(REPO.rglob("*.htpasswd"))

    def test_website_has_no_basic_auth(self):
        assert "auth_basic" not in (NGINX / "prod-site.conf").read_text()


class TestEnvTemplate:
    SECRETS = (
        "DJANGO_SECRET_KEY",
        "JWT_SIGNING_KEY",
        "POSTGRES_PASSWORD",
    )

    def test_secrets_are_placeholders(self):
        env = env_template()
        for key in self.SECRETS:
            assert env[key] == "change-me", key
        assert env["DJANGO_ADMIN_URL"] == "change-me/"

    def test_production_is_safe_by_default(self):
        env = env_template()
        assert env["DJANGO_SETTINGS_MODULE"] == "config.settings.prod"
        assert env["DJANGO_DEBUG"] == "false"
        # No merchant account yet: the server takes no payments (never fake ones).
        assert env["PAYMENT_PROVIDER"] == "unavailable"
        assert not any(key.startswith("SSLCOMMERZ_") for key in env)
        assert "PAYMENT_ALLOW_SANDBOX_IN_PRODUCTION" not in env
        assert "PAYMENT_MOCK_ALLOWED" not in env
        assert env["API_DOCS_ENABLED"] == "false"
        assert env["TRUSTED_PROXY_COUNT"] == "1"
        assert env["HSTS_SECONDS"] == env["DJANGO_SECURE_HSTS_SECONDS"]
        assert "DEMO_ENVIRONMENT" not in env and "DEMO_SEED_ALLOWED" not in env
        assert env["PAYMENT_CALLBACK_BASE_URL"].startswith("https://")

    def test_hosts_match(self):
        env = env_template()
        hosts = env["DJANGO_ALLOWED_HOSTS"].split(",")
        assert env["SITE_HOST"] in hosts and env["ADMIN_HOST"] in hosts
        assert "*" not in hosts

    def test_real_env_file_is_never_committed(self):
        ignored = (REPO / ".gitignore").read_text().splitlines()
        assert ".env.*" in ignored and "!.env.prod.example" in ignored


def test_production_env_template_passes_djangos_deploy_check():
    """The committed .env.prod.example — with its placeholders replaced by throwaway random
    values, exactly what the server owner does — starts production settings cleanly:
    no payment credentials needed (PAYMENT_PROVIDER=unavailable)."""
    env = {"PATH": os.environ["PATH"]}
    for key, value in env_template().items():
        if value == "change-me":
            value = secrets.token_urlsafe(48)
        elif value == "change-me/":
            value = f"ops-{secrets.token_hex(8)}/"
        env[key] = value
    result = subprocess.run(  # noqa: S603 — fixed arguments, no shell
        [sys.executable, "manage.py", "check", "--deploy", "--fail-level", "WARNING"],
        cwd=REPO / "backend",
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "no issues (1 silenced)" in result.stdout
