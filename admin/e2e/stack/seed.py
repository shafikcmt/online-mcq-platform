"""Baseline data of the disposable E2E database (run by e2e-db.sh through
`manage.py shell`, only against the template database it just created).

Kept minimal and deterministic: the admin account the suites sign in with, one
published exam so the 7B suite can check that a question used by a published exam is
locked, and (7D) two published exams with submitted results from four students, merit
NOT yet generated, plus (7E) one inactive student with an email. Everything goes
through the normal services (students submit through the exam engine) — no shortcuts
around the rules. Suites create their own throwaway data on top of this.
"""

import os
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

# --- 7E: users ------------------------------------------------------------------------
# One more student with an email and a deactivated account (no password, no results), so
# the Users suite can check email masking and the active filter.
User.objects.create_user(
    "01700000105",
    full_name="Nusrat Jahan",
    email="nusrat.jahan@example.org",
    is_active=False,
)
print(
    "e2e seed: admin + 1 category, 1 subject, 3 questions, 1 published exam; "
    "results: 2 exams, 4 students, 5 submitted results (merit not generated); "
    "users: 1 inactive student with an email"
)
