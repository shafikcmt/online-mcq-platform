"""Demo data in the PRODUCTION database before launch: ``seed_demo --production-preview``
(one-off opt-in, refused once real activity exists) and ``remove_demo`` (removes exactly the
demo data, refuses when real data depends on it)."""

import io

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.accounts.models import Role, User
from apps.audit.models import AuditLog
from apps.catalog.models import Category, Subject
from apps.core.management.commands.seed_demo import STUDENTS, counts
from apps.exams.models import Exam, ExamQuestion
from apps.questions.models import Question

DEMO_NUMBER = STUDENTS[0][1]


@pytest.fixture
def preview_env(monkeypatch):
    # The real test database name (not a demo name) — like production.
    monkeypatch.setenv("DEMO_SEED_ALLOWED", "true")
    monkeypatch.setenv("DEMO_ENVIRONMENT", "production-preview")


def run(*args):
    out = io.StringIO()
    call_command(*args, stdout=out)
    return out.getvalue()


def seed():
    assert "seeded" in run("seed_demo", "--production-preview")


@pytest.mark.django_db
class TestProductionPreviewSeed:
    def test_refused_without_the_one_off_opt_in(self, monkeypatch):
        monkeypatch.delenv("DEMO_SEED_ALLOWED", raising=False)
        monkeypatch.setenv("DEMO_ENVIRONMENT", "production-preview")
        with pytest.raises(CommandError, match="DEMO_SEED_ALLOWED"):
            run("seed_demo", "--production-preview")
        monkeypatch.setenv("DEMO_SEED_ALLOWED", "true")
        monkeypatch.setenv("DEMO_ENVIRONMENT", "staging-demo")
        with pytest.raises(CommandError, match="production-preview"):
            run("seed_demo", "--production-preview")
        assert counts()["categories"] == 0

    def test_plain_seed_still_refuses_a_non_demo_database(self, preview_env):
        with pytest.raises(CommandError, match="Refusing"):
            run("seed_demo")

    def test_seeds_an_empty_platform_and_is_idempotent(self, preview_env):
        User.objects.create_superuser(
            "01811111111", "Owner-Test-Passphrase-2026", full_name="Owner"
        )
        seed()
        first = counts()
        assert first["students"] == len(STUDENTS) and first["exams"] == 5
        assert first["payments"] == 0  # permanent records: never seeded in production
        assert "already seeded" in run("seed_demo", "--production-preview")
        assert counts() == first

    def test_refused_once_real_activity_exists(self, preview_env):
        User.objects.create_user("01911111111", "Real-Student-Passphrase-1", full_name="Real")
        with pytest.raises(CommandError, match="real activity"):
            run("seed_demo", "--production-preview")
        assert counts()["categories"] == 0


@pytest.mark.django_db
class TestRemoveDemo:
    def test_nothing_to_remove(self):
        assert "nothing to remove" in run("remove_demo")

    def test_dry_run_changes_nothing(self, preview_env):
        seed()
        before = counts()
        out = run("remove_demo")
        assert "would remove" in out and "--confirm" in out
        assert counts() == before

    def test_removes_exactly_the_demo_data(self, preview_env):
        owner = User.objects.create_superuser(
            "01811111111", "Owner-Test-Passphrase-2026", full_name="Owner"
        )
        seed()
        # Real content added by the admin after the seed — must survive.
        real_category = Category.objects.create(slug="ssc", name_en="SSC", name_bn="এসএসসি")
        real_subject = Subject.objects.create(
            category=real_category, slug="ssc-math", name_en="Math", name_bn="গণিত"
        )
        audit_before = AuditLog.objects.count()

        out = run("remove_demo", "--confirm")
        assert "removed" in out
        left = counts()
        assert left["students"] == 0
        assert all(
            left[key] == 0
            for key in ("exams", "questions", "attempts", "results", "packages", "subscriptions")
        )
        assert left["categories"] == 1 and left["subjects"] == 1  # only the real ones
        assert Category.objects.filter(pk=real_category.pk).exists()
        assert Subject.objects.filter(pk=real_subject.pk).exists()
        assert User.objects.filter(pk=owner.pk).exists()
        # Append-only audit log: history kept, one entry for this run.
        assert AuditLog.objects.count() == audit_before + 1
        assert AuditLog.objects.filter(action="demo.removed").count() == 1
        assert "nothing to remove" in run("remove_demo")

    def test_a_real_person_with_a_demo_number_is_never_removed(self, preview_env):
        seed()
        # Simulate: a real person later owns one of the placeholder numbers (has a password).
        person = User.objects.get(role=Role.STUDENT, full_name=STUDENTS[0][0])
        person.set_password("Real-Owner-Passphrase-7")
        person.save(update_fields=["password"])
        with pytest.raises(CommandError, match="real students"):
            run("remove_demo", "--confirm")  # their demo attempts would be lost: refused
        assert counts()["exams"] == 5  # nothing removed

    def test_refuses_demo_data_with_permanent_payments(self, monkeypatch):
        # The staging demo seeds payments; those records can never be deleted.
        from unittest import mock

        from apps.core import demo

        monkeypatch.setenv("DEMO_SEED_ALLOWED", "true")
        monkeypatch.setenv("DEMO_ENVIRONMENT", "staging-demo")
        with mock.patch.object(demo, "database_name", return_value="online_mcq_demo"):
            run("seed_demo")
        before = counts()
        with pytest.raises(CommandError, match="payment records are permanent"):
            run("remove_demo", "--confirm")
        assert counts() == before

    def test_refuses_when_a_real_exam_uses_demo_questions(self, preview_env):
        seed()
        demo_exam = Exam.objects.get(slug="demo-english-practice")  # the draft
        real = Exam.objects.create(
            slug="real-exam",
            title_en="Real",
            category=demo_exam.category,
            duration_minutes=10,
            total_questions=1,
        )
        ExamQuestion.objects.create(exam=real, question=Question.objects.first(), sort_order=1)
        before = counts()
        with pytest.raises(CommandError, match="non-demo exams"):
            run("remove_demo", "--confirm")
        assert counts() == before
