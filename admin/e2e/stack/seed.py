"""Baseline data of the disposable E2E database (run by e2e-db.sh through
`manage.py shell`, only against the template database it just created).

Kept minimal and deterministic: the admin account the suites sign in with, and one
published exam so the 7B suite can check that a question used by a published exam is
locked. Everything goes through the normal services — no shortcuts around the rules.
Suites create their own throwaway data on top of this.
"""

import os

from apps.accounts.models import Role, User
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
print("e2e seed: admin + 1 category, 1 subject, 3 questions, 1 published exam")
