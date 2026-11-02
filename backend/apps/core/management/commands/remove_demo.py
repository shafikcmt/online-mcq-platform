"""Remove the demo data created by ``seed_demo`` — and nothing else.

    python manage.py remove_demo            # shows what would be removed; changes nothing
    python manage.py remove_demo --confirm  # removes it (one transaction)

What counts as demo data:

- categories, subjects, exams and packages whose slug starts with ``demo-``;
- every question inside a demo subject (anything added inside a demo category is demo);
- the seeded students: one of the ``seed_demo`` numbers AND no usable password (a real
  person who registered with such a number has a password, so is never touched);
- the seeded students' attempts, results, subscriptions, grants and notifications.

Payments are permanent financial records (append-only, enforced by PostgreSQL), so demo data
that has payments — the staging demo — cannot be removed; it refuses. The production
preview (``seed_demo --production-preview``) seeds no payments.

It refuses, changing nothing, when real data depends on demo data: a real student's
attempt, result, subscription or payment on a demo exam or package, a non-demo exam in a
demo category/subject or using a demo question, or a non-demo package rule pointing at a
demo category/exam. Settings, admins, pages, FAQs, notices and every non-demo item are never
touched. The audit log is append-only, so its history stays; this run adds one entry.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q

from apps.core.management.commands.seed_demo import DEMO_PREFIX


def demo_scope() -> dict:
    """Querysets of everything demo (evaluated lazily)."""
    from apps.attempts.models import ExamAttempt
    from apps.catalog.models import Category, Subject
    from apps.core.demo import demo_students
    from apps.exams.models import Exam
    from apps.notifications.models import Notification
    from apps.payments.models import Payment
    from apps.questions.models import Question
    from apps.results.models import Result
    from apps.subscriptions.models import GrantRequest, Package, Subscription

    students = demo_students()
    categories = Category.objects.filter(slug__startswith=DEMO_PREFIX)
    subjects = Subject.objects.filter(Q(slug__startswith=DEMO_PREFIX) | Q(category__in=categories))
    exams = Exam.objects.filter(slug__startswith=DEMO_PREFIX)
    packages = Package.objects.filter(slug__startswith=DEMO_PREFIX)
    payments = Payment.objects.filter(Q(user__in=students) | Q(package__in=packages))
    return {
        "notifications": Notification.objects.filter(user__in=students),
        "payments": payments,  # only checked: never deleted (see blockers)
        "grants": GrantRequest.objects.filter(Q(user__in=students) | Q(package__in=packages)),
        "subscriptions": Subscription.objects.filter(
            Q(user__in=students) | Q(package__in=packages)
        ),
        "results": Result.objects.filter(Q(user__in=students) | Q(exam__in=exams)),
        "attempts": ExamAttempt.objects.filter(Q(user__in=students) | Q(exam__in=exams)),
        "packages": packages,
        "exams": exams,
        "questions": Question.objects.filter(subject__in=subjects),
        "subjects": subjects,
        "categories": categories,
        "students": students,
    }


def blockers(scope: dict) -> list[str]:
    """Real (non-demo) data that depends on demo data: removal must not touch it."""
    from apps.exams.models import Exam, ExamQuestion
    from apps.subscriptions.models import PackageAccessRule

    students = scope["students"]
    found = []
    if scope["payments"].exists():
        found.append(
            f"payments: {scope['payments'].count()} (payment records are permanent and are "
            "never deleted)"
        )
    checks = {
        "real students' attempts on demo exams": scope["attempts"].exclude(user__in=students),
        "real students' results on demo exams": scope["results"].exclude(user__in=students),
        "real students' subscriptions to demo packages": scope["subscriptions"].exclude(
            user__in=students
        ),
        "real students' grants of demo packages": scope["grants"].exclude(user__in=students),
        "non-demo exams in a demo category or subject": Exam.objects.exclude(
            pk__in=scope["exams"]
        ).filter(Q(category__in=scope["categories"]) | Q(subject__in=scope["subjects"])),
        "non-demo exams using demo questions": ExamQuestion.objects.exclude(
            exam__in=scope["exams"]
        ).filter(question__in=scope["questions"]),
        "non-demo package rules pointing at demo content": PackageAccessRule.objects.exclude(
            package__in=scope["packages"]
        ).filter(Q(category__in=scope["categories"]) | Q(exam__in=scope["exams"])),
    }
    for label, queryset in checks.items():
        count = queryset.count()
        if count:
            found.append(f"{label}: {count}")
    return found


class Command(BaseCommand):
    help = "Remove the seed_demo data (dry run unless --confirm)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--confirm", action="store_true", help="Actually remove it (default: only show)."
        )

    def handle(self, *args, confirm=False, **options):
        scope = demo_scope()
        counts = {name: queryset.count() for name, queryset in scope.items()}
        listing = ", ".join(f"{name}={count}" for name, count in counts.items())
        if not any(counts.values()):
            self.stdout.write("remove_demo: no demo data found — nothing to remove.")
            return

        problems = blockers(scope)
        if problems:
            raise CommandError(
                "Refusing: real data depends on demo data, nothing was removed — "
                + "; ".join(problems)
            )
        if not confirm:
            self.stdout.write(f"remove_demo: would remove {listing}.")
            self.stdout.write("Nothing changed. Run again with --confirm to remove it.")
            return

        from apps.audit.services import AuditContext, record

        with transaction.atomic():
            # Dependants first: every relation here is PROTECT, so the order matters.
            # The querysets are re-evaluated per step from ids taken up front.
            steps = {name: qs for name, qs in scope.items() if name != "payments"}
            ids = {name: list(qs.values_list("pk", flat=True)) for name, qs in steps.items()}
            models = {name: qs.model for name, qs in steps.items()}
            for name in ids:
                models[name].objects.filter(pk__in=ids[name]).delete()
            record(
                AuditContext(),
                action="demo.removed",
                entity_type="demo",
                entity_id="seed_demo",
                summary="Demo data removed",
                metadata={"values": counts},
                allowed_fields=tuple(counts),
            )
        self.stdout.write(self.style.SUCCESS(f"remove_demo: removed {listing}."))
