"""Baseline data of the disposable E2E database (run by e2e-db.sh through
`manage.py shell`, only against the template database it just created).

Kept minimal and deterministic: the admin account the suites sign in with, one
published exam so the 7B suite can check that a question used by a published exam is
locked, and (7D) two published exams with submitted results from four students, merit
NOT yet generated, plus (7E) one inactive student with an email, (7F) one open
attempt, (7G) three packages (one unused) with an active, a scheduled and a cancelled
subscription and (7H) five mock-provider payments. Everything goes through the normal
services (students submit through the exam engine, subscriptions are granted and
cancelled by the subscription services, payments are verified by the payment services) —
no shortcuts around the rules. Suites create their own throwaway data on top of this.
"""

import os
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from apps.accounts.models import Role, User
from apps.attempts import services as attempts
from apps.audit.services import AuditContext
from apps.catalog import services as catalog
from apps.catalog.models import Category, Subject
from apps.exams import services as exams
from apps.exams.models import Exam
from apps.questions import services as questions
from apps.questions.models import Question
from apps.subscriptions import services as subscriptions
from apps.subscriptions.models import Package

ctx = AuditContext()
User.objects.create_user(
    os.environ["E2E_ADMIN_MOBILE"],
    password=os.environ["E2E_ADMIN_PASSWORD"],
    full_name="E2E Admin",
    role=Role.ADMIN,
    preferred_language="en",
)
category = catalog.create_category(
    Category(slug="e2e-seed", name_en="E2E seed category", name_bn="ই২ই ক্যাটাগরি"), ctx=ctx
)
subject = catalog.create_subject(
    Subject(
        category=category, slug="e2e-seed-subject", name_en="E2E seed subject", name_bn="ই২ই বিষয়"
    ),
    ctx=ctx,
)
seeded = [
    questions.create_question(
        Question(subject=subject, text_en=f"E2E seed question {i}", text_bn=f"ই২ই প্রশ্ন {i}"),
        [
            {"text_en": f"Option {n}", "text_bn": f"অপশন {n}", "is_correct": n == 0}
            for n in range(4)
        ],
        ctx=ctx,
    )
    for i in range(3)
]
exam = exams.create_exam(
    Exam(
        title_en="E2E seed exam",
        title_bn="ই২ই পরীক্ষা",
        category=category,
        subject=subject,
        content_language="both",
        exam_type="regular",
        duration_minutes=30,
        total_questions=3,
    ),
    ctx=ctx,
    provided=set(),
)
exams.set_exam_questions(
    exam.pk, [{"question": q.pk, "sort_order": i} for i, q in enumerate(seeded)], ctx=ctx
)
exams.publish_exam(exam.pk, ctx=ctx)


# --- 7D: results ----------------------------------------------------------------------
def results_exam(title_en, title_bn, slug, **settings):
    bank = [
        questions.create_question(
            Question(subject=subject, text_en=f"{title_en} Q{i}", text_bn=f"{title_bn} প্রশ্ন {i}"),
            [
                {"text_en": f"Option {n}", "text_bn": f"অপশন {n}", "is_correct": n == 0}
                for n in range(4)
            ],
            ctx=ctx,
        )
        for i in range(3)
    ]
    created = exams.create_exam(
        Exam(
            title_en=title_en,
            title_bn=title_bn,
            slug=slug,
            category=category,
            subject=subject,
            content_language="both",
            exam_type="regular",
            duration_minutes=30,
            total_questions=3,
            **settings,
        ),
        ctx=ctx,
        provided=set(settings),
    )
    exams.set_exam_questions(
        created.pk, [{"question": q.pk, "sort_order": i} for i, q in enumerate(bank)], ctx=ctx
    )
    exams.publish_exam(created.pk, ctx=ctx)
    return created


def submit(student, exam, correct):
    """The student answers `correct` questions right (in display order) and submits."""
    attempt, _ = attempts.start_attempt(student, exam.pk)
    rows = list(attempt.answers.order_by("display_order"))[:correct]
    items = [
        {
            "question_id": row.question_id,
            "selected_option_id": row.question.options.get(is_correct=True).pk,
            "client_saved_at": timezone.now(),
        }
        for row in rows
    ]
    if items:
        attempts.save_answers(student, attempt.public_id, items)
    attempts.submit_attempt(student, attempt.public_id)


physics = results_exam(
    "E2E Results Physics",
    "ই২ই ফলাফল পদার্থবিজ্ঞান",
    "e2e-results-physics",
    pass_marks=Decimal("2"),
)
manual = results_exam(
    "E2E Results Manual", "ই২ই ফলাফল ম্যানুয়াল", "e2e-results-manual", result_visibility="manual"
)
students = {  # no password: they never sign in, they only submit through the exam engine
    name: User.objects.create_user(mobile, full_name=name)
    for name, mobile in (
        ("Ayesha Siddika", "01700000101"),
        ("Tanvir Ahmed", "01700000102"),
        ("মাহমুদা আক্তার", "01700000103"),
        ("Rafiq Islam", "01700000104"),
    )
}
for name, correct in (
    ("Ayesha Siddika", 3),
    ("Tanvir Ahmed", 2),
    ("মাহমুদা আক্তার", 1),
    ("Rafiq Islam", 0),
):
    submit(students[name], physics, correct)
submit(students["Ayesha Siddika"], manual, 1)
# 7F: one open attempt (started through the exam engine, not submitted) for the Attempts
# suite. Its deadline is the exam's 30 minutes; nothing finalizes it on the test stack.
attempts.start_attempt(students["Tanvir Ahmed"], manual.pk)

# --- 7E: users ------------------------------------------------------------------------
# One more student with an email and a deactivated account (no password, no results), so
# the Users suite can check email masking and the active filter.
User.objects.create_user(
    "01700000105",
    full_name="Nusrat Jahan",
    email="nusrat.jahan@example.org",
    is_active=False,
)

# --- 7G: packages and subscriptions -----------------------------------------------------
# A paid exam (draft) so a package can have an exam rule; three packages; subscriptions
# granted (and one cancelled) through the services. An expired subscription would need
# a start in the past, which the services do not allow: the backend tests cover it.
paid_exam = exams.create_exam(
    Exam(
        title_en="E2E Paid Mock",
        title_bn="ই২ই পেইড মক",
        slug="e2e-paid-mock",
        category=category,
        subject=subject,
        content_language="both",
        exam_type="regular",
        access_type="paid",
        duration_minutes=30,
        total_questions=3,
    ),
    ctx=ctx,
    provided={"access_type"},
)


def package(slug, name_en, name_bn, price, validity_days, rules, **extra):
    created = subscriptions.create_package(
        Package(
            slug=slug,
            name_en=name_en,
            name_bn=name_bn,
            price=Decimal(price),
            validity_days=validity_days,
            **extra,
        ),
        ctx=ctx,
    )
    subscriptions.set_access_rules(created.pk, rules, ctx=ctx)
    return created


gold = package(
    "e2e-gold",
    "E2E Gold",
    "ই২ই গোল্ড",
    "500",
    30,
    [{"rule_type": "category", "category": category.pk}],
    features_en=["Every exam of the seed category", "Merit lists"],
    features_bn=["সিড ক্যাটাগরির সব পরীক্ষা", "মেধা তালিকা"],
    is_featured=True,
    sort_order=1,
)
silver = package(
    "e2e-silver",
    "E2E Silver",
    "ই২ই সিলভার",
    "250",
    60,
    [{"rule_type": "exam", "exam": paid_exam.pk}],
    sort_order=2,
)
package("e2e-unused", "E2E Unused", "ই২ই অব্যবহৃত", "100", 7, [], sort_order=3)
subscriptions.grant_subscription(students["Tanvir Ahmed"].pk, gold.pk, ctx=ctx)
subscriptions.grant_subscription(
    students["মাহমুদা আক্তার"].pk,
    silver.pk,
    ctx=ctx,
    starts_at=timezone.now() + timedelta(days=3),
)
cancelled = subscriptions.grant_subscription(students["Rafiq Islam"].pk, gold.pk, ctx=ctx)
subscriptions.cancel_subscription(cancelled.subscription.pk, ctx=ctx)

# --- 7H: payments -----------------------------------------------------------------------
# Five payments through the normal payment services and the MOCK provider only (never a
# real gateway): initiate → the mock checkout outcome → the provider callback → server-
# side verification. Tanvir pays for E2E Gold twice: both verified payments EXTEND his
# running Gold subscription (the renewal case — two payments, one subscription, no new
# subscription row). One failed, one cancelled and one still pending (no subscription).
# The mock provider's ledger lives in this process's memory only (local-memory cache), so
# seeding touches no Redis database at all.
from django.test import override_settings  # noqa: E402

from apps.payments import services as payments  # noqa: E402
from apps.payments.gateways import mock as mock_gateway  # noqa: E402


def pay(student, pkg, result=None):
    payment, _created = payments.initiate_payment(student, pkg.pk)
    if result:
        val_id = mock_gateway.complete(payment.merchant_reference, result)
        payments.process_callback(
            "mock", result, {"tran_id": payment.merchant_reference, "val_id": val_id}
        )
    payment.refresh_from_db()
    return payment


with override_settings(
    PAYMENT_PROVIDER="mock",
    PAYMENT_MOCK_ALLOWED=True,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
):
    first = pay(students["Tanvir Ahmed"], gold, "success")
    renewal = pay(students["Tanvir Ahmed"], gold, "success")
    failed = pay(students["মাহমুদা আক্তার"], silver, "fail")
    cancelled_payment = pay(students["Rafiq Islam"], silver, "cancel")
    open_payment = pay(students["Rafiq Islam"], gold)
assert first.status == renewal.status == "success", (first.status, renewal.status)
assert first.subscription_id == renewal.subscription_id is not None
assert (failed.status, cancelled_payment.status, open_payment.status) == (
    "failed",
    "cancelled",
    "pending",
)

print(
    "e2e seed: admin + 1 category, 1 subject, 3 questions, 1 published exam; "
    "results: 2 exams, 4 students, 5 submitted results (merit not generated), "
    "1 open attempt; "
    "users: 1 inactive student with an email; "
    "packages: 3 (1 unused), subscriptions: active, scheduled, cancelled; "
    "payments (mock): 2 successful renewing one subscription, failed, cancelled, pending"
)
