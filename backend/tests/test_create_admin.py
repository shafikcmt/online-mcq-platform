"""``create_admin``: the production way to create the first Admin Panel account (and to
reset an admin's password) — hidden prompt, validated password, never echoed or logged."""

import io
import logging
from unittest import mock

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.accounts.models import Role, User
from apps.audit.models import AuditLog

pytestmark = pytest.mark.django_db

PASSWORD = "Prod-Admin-Test-Passphrase-2026"  # test value only
MOBILE = "01700000009"
STORED = "+8801700000009"


def run(*args, stdin="", tty=False):
    out = io.StringIO()
    fake_stdin = io.StringIO(stdin)
    fake_stdin.isatty = lambda: tty
    with mock.patch("sys.stdin", fake_stdin):
        call_command("create_admin", *args, stdout=out)
    return out.getvalue()


def create(password=PASSWORD, *extra):
    return run(
        "--mobile", MOBILE, "--full-name", "Site Owner", "--password-stdin", *extra, stdin=password
    )


def test_creates_a_panel_admin_that_is_not_a_superuser(caplog):
    caplog.set_level(logging.DEBUG)
    out = create()
    assert "created" in out
    admin = User.objects.get(mobile_number=STORED)
    assert (admin.role, admin.full_name, admin.is_active) == (Role.ADMIN, "Site Owner", True)
    assert not admin.is_superuser and not admin.is_staff
    assert admin.check_password(PASSWORD)
    # The password is never echoed, logged or audited.
    assert PASSWORD not in out and PASSWORD not in caplog.text
    entry = AuditLog.objects.get(action="user.admin_create")
    assert entry.entity_id == str(admin.pk)
    assert PASSWORD not in str(entry.metadata) + entry.summary


def test_hidden_prompt_asks_twice_and_never_echoes():
    with mock.patch("getpass.getpass", side_effect=[PASSWORD, PASSWORD]) as prompt:
        out = run("--mobile", MOBILE, "--full-name", "Site Owner", tty=True)
    assert prompt.call_count == 2
    assert all("hidden" in call.args[0] for call in prompt.call_args_list)
    assert PASSWORD not in out
    assert User.objects.get(mobile_number=STORED).check_password(PASSWORD)


def test_mismatched_prompt_changes_nothing():
    with mock.patch("getpass.getpass", side_effect=[PASSWORD, PASSWORD + "x"]):
        with pytest.raises(CommandError, match="do not match"):
            run("--mobile", MOBILE, "--full-name", "Site Owner", tty=True)
    assert not User.objects.filter(mobile_number=STORED).exists()


def test_refuses_without_a_terminal_unless_password_stdin():
    with pytest.raises(CommandError, match="No terminal"):
        run("--mobile", MOBILE, "--full-name", "Site Owner", stdin=PASSWORD + "\n")
    assert not User.objects.exists()


def test_there_is_no_password_argument():
    with pytest.raises(CommandError):
        call_command("create_admin", "--mobile", MOBILE, "--full-name", "X", "--password", PASSWORD)


@pytest.mark.parametrize(
    ("password", "reason"),
    [
        ("short", "too short"),
        ("", "cannot be empty"),
        ("password123", "too common"),
        ("98127364501", "entirely numeric"),
    ],
)
def test_weak_passwords_are_refused(password, reason):
    with pytest.raises(CommandError, match=reason):
        create(password)
    assert not User.objects.exists()


def test_password_similar_to_the_name_is_refused():
    with pytest.raises(CommandError, match="similar"):
        run(
            "--mobile",
            MOBILE,
            "--full-name",
            "Rahimuddin Talukder",
            "--password-stdin",
            stdin="RahimuddinTalukder",
        )


def test_existing_admin_is_never_changed_silently():
    create()
    with pytest.raises(CommandError, match="already exists"):
        create("Different-Passphrase-2026-xyz")
    assert User.objects.get(mobile_number=STORED).check_password(PASSWORD)


def test_reset_password_for_an_existing_admin():
    create()
    out = create("Different-Passphrase-2026-xyz", "--reset-password")
    assert "new password" in out
    admin = User.objects.get(mobile_number=STORED)
    assert admin.check_password("Different-Passphrase-2026-xyz")
    assert User.objects.filter(role=Role.ADMIN).count() == 1
    assert AuditLog.objects.filter(action="user.admin_password_reset").count() == 1


def test_reset_needs_an_existing_admin():
    with pytest.raises(CommandError, match="nothing to reset"):
        create(PASSWORD, "--reset-password")
    assert not User.objects.exists()


def test_never_takes_over_a_student_or_superuser():
    User.objects.create_user(MOBILE, password="Student-Passphrase-2026", full_name="S")
    with pytest.raises(CommandError, match="not an Admin Panel admin"):
        create()
    with pytest.raises(CommandError, match="not an Admin Panel admin"):
        create(PASSWORD, "--reset-password")
    assert User.objects.get(mobile_number=STORED).role == Role.STUDENT

    User.objects.create_superuser(
        "01700000010", password="Super-User-Passphrase-2026", full_name="Root"
    )
    with pytest.raises(CommandError, match="not an Admin Panel admin"):
        run(
            "--mobile",
            "01700000010",
            "--full-name",
            "X",
            "--password-stdin",
            "--reset-password",
            stdin=PASSWORD,
        )


def test_rejects_invalid_number_and_empty_name():
    with pytest.raises(CommandError, match="valid Bangladeshi"):
        run("--mobile", "12345", "--full-name", "X", "--password-stdin", stdin=PASSWORD)
    with pytest.raises(CommandError, match="cannot be empty"):
        run("--mobile", MOBILE, "--full-name", "   ", "--password-stdin", stdin=PASSWORD)


def test_works_outside_the_demo_and_signs_in_to_the_admin_panel(monkeypatch, client):
    monkeypatch.delenv("DEMO_ENVIRONMENT", raising=False)
    monkeypatch.delenv("DEMO_SEED_ALLOWED", raising=False)
    create()
    client.get("/api/v1/admin/auth/csrf/")
    response = client.post(
        "/api/v1/admin/auth/login/",
        {"mobile_number": MOBILE, "password": PASSWORD},
        content_type="application/json",
        HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
    )
    assert response.status_code == 200, response.content
