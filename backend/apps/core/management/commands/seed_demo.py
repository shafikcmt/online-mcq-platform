"""Deterministic, synthetic demo data for the staging / client-demo database.

    python manage.py seed_demo

Refuses unless the environment opts in (``DEMO_SEED_ALLOWED=true``,
``DEMO_ENVIRONMENT=staging-demo``) AND the database is a demo database
(``online_mcq_demo``) — see ``apps.core.demo``. Never runs against QA (``mcq_m7_qa``),
local or test databases.

**Production preview** (``--production-preview``): the same data in the production
database so the owner can see the live site filled, BEFORE launch only. It needs a one-off
opt-in on the command line of that run (``DEMO_SEED_ALLOWED=true``,
``DEMO_ENVIRONMENT=production-preview``) and refuses while any student, attempt,
subscription or payment exists. It seeds no payments (payment records are permanent and
could not be removed again). Remove it all with ``remove_demo`` before real students join.

Everything is created through the normal services (audited like an admin would; students
answer through the exam engine; subscriptions are granted/cancelled by the subscription
services; payments are initiated and verified by the payment services). All people are
fictional: sequential placeholder numbers (accounts without a usable password, never
contacted — staging has no SMS provider) and ``example.org`` emails.

**Idempotent:** the whole seed runs in one transaction, so the first demo category
(``demo-ssc``) exists only if everything was created; a second run finds it and changes
nothing (``--check`` only reports).

**Demo payment history without a mock payment server.** The staging runtime uses
production settings, which refuse the mock provider. This command alone, inside its own
process and only while creating the sample payments, enables the in-process mock gateway
(``seed_payment_provider`` below: scoped settings override, local-memory ledger, no
network). The sample payments are therefore stored as provider ``mock``; at runtime the
mock provider stays disabled, so reconciliation skips them and re-verify answers
``provider_disabled`` — nothing ever calls a real gateway.
"""

import contextlib
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.test.utils import override_settings
from django.utils import timezone

from apps.core.demo import (
    require_demo,
    require_no_real_activity,
    require_production_preview_environment,
)

MARKER_SLUG = "demo-ssc"  # first demo category; the seed is one transaction, so it = seeded
DEMO_PREFIX = "demo-"

STUDENTS = (  # (name, number) — fictional names, sequential placeholder numbers
    ("Ayesha Rahman", "01700000301"),
    ("Tanvir Hasan", "01700000302"),
    ("নুসরাত জাহান", "01700000303"),
    ("Rafiq Ahmed", "01700000304"),
    ("সাবরিনা ইসলাম", "01700000305"),
    ("Imran Hossain", "01700000306"),
    ("Farzana Akter", "01700000307"),
    ("মাহমুদ হাসান", "01700000308"),
    ("Sumaiya Khan", "01700000309"),
    ("Arif Chowdhury", "01700000310"),
    ("তাসনিম রহমান", "01700000311"),
    ("Kamal Uddin", "01700000312"),  # deactivated in the demo (Users filter)
)

# (category slug, en, bn) → subjects (slug, en, bn)
CATALOG = (
    (
        "demo-ssc",
        "SSC Preparation",
        "এসএসসি প্রস্তুতি",
        (
            ("demo-mathematics", "Mathematics", "গণিত"),
            ("demo-science", "General Science", "সাধারণ বিজ্ঞান"),
            ("demo-english", "English Grammar", "ইংরেজি ব্যাকরণ"),
        ),
    ),
    (
        "demo-jobs",
        "Job Preparation",
        "চাকরির প্রস্তুতি",
        (
            ("demo-general-knowledge", "General Knowledge", "সাধারণ জ্ঞান"),
            ("demo-ict", "ICT", "তথ্য ও যোগাযোগ প্রযুক্তি"),
        ),
    ),
)

# Each question: (text_en, text_bn, [(option_en, option_bn), …] — the FIRST option is correct)
SCIENCE = (
    (
        "What is the chemical formula of water?",
        "পানির রাসায়নিক সংকেত কী?",
        [("H₂O", "H₂O"), ("CO₂", "CO₂"), ("O₂", "O₂"), ("NaCl", "NaCl")],
    ),
    (
        "Which planet is known as the Red Planet?",
        "কোন গ্রহকে লাল গ্রহ বলা হয়?",
        [("Mars", "মঙ্গল"), ("Venus", "শুক্র"), ("Jupiter", "বৃহস্পতি"), ("Mercury", "বুধ")],
    ),
    (
        "Which gas do plants absorb for photosynthesis?",
        "সালোকসংশ্লেষণে উদ্ভিদ কোন গ্যাস গ্রহণ করে?",
        [
            ("Carbon dioxide", "কার্বন ডাই-অক্সাইড"),
            ("Oxygen", "অক্সিজেন"),
            ("Nitrogen", "নাইট্রোজেন"),
            ("Hydrogen", "হাইড্রোজেন"),
        ],
    ),
    (
        "What is the unit of electric current?",
        "বিদ্যুৎ প্রবাহের একক কী?",
        [("Ampere", "অ্যাম্পিয়ার"), ("Volt", "ভোল্ট"), ("Ohm", "ওহম"), ("Watt", "ওয়াট")],
    ),
    (
        "Which organ pumps blood through the body?",
        "কোন অঙ্গ শরীরে রক্ত সঞ্চালন করে?",
        [("Heart", "হৃৎপিণ্ড"), ("Lungs", "ফুসফুস"), ("Liver", "যকৃৎ"), ("Kidney", "বৃক্ক")],
    ),
    (
        "What is the boiling point of water at sea level?",
        "সমুদ্রপৃষ্ঠে পানির স্ফুটনাঙ্ক কত?",
        [("100 °C", "১০০ °সে"), ("90 °C", "৯০ °সে"), ("110 °C", "১১০ °সে"), ("80 °C", "৮০ °সে")],
    ),
    (
        "Which vitamin does sunlight help the body make?",
        "সূর্যালোক শরীরে কোন ভিটামিন তৈরিতে সাহায্য করে?",
        [
            ("Vitamin D", "ভিটামিন ডি"),
            ("Vitamin A", "ভিটামিন এ"),
            ("Vitamin C", "ভিটামিন সি"),
            ("Vitamin K", "ভিটামিন কে"),
        ],
    ),
    (
        "What is the hardest natural substance?",
        "সবচেয়ে কঠিন প্রাকৃতিক পদার্থ কোনটি?",
        [("Diamond", "হীরা"), ("Iron", "লোহা"), ("Gold", "সোনা"), ("Quartz", "কোয়ার্টজ")],
    ),
    (
        "Which part of the cell contains DNA?",
        "কোষের কোন অংশে ডিএনএ থাকে?",
        [
            ("Nucleus", "নিউক্লিয়াস"),
            ("Ribosome", "রাইবোসোম"),
            ("Cell wall", "কোষপ্রাচীর"),
            ("Vacuole", "কোষগহ্বর"),
        ],
    ),
    (
        "What is the speed of light, approximately?",
        "আলোর বেগ আনুমানিক কত?",
        [
            ("300,000 km/s", "৩,০০,০০০ কিমি/সে"),
            ("30,000 km/s", "৩০,০০০ কিমি/সে"),
            ("3,000 km/s", "৩,০০০ কিমি/সে"),
            ("300 km/s", "৩০০ কিমি/সে"),
        ],
    ),
)
ENGLISH = (
    (
        "Choose the correct article: ___ apple a day.",
        "সঠিক আর্টিকেল বেছে নিন: ___ apple a day.",
        [("An", "An"), ("A", "A"), ("The", "The"), ("No article", "কোনো আর্টিকেল নয়")],
    ),
    (
        "What is the past tense of 'go'?",
        "'go'-এর অতীত রূপ কী?",
        [("went", "went"), ("goed", "goed"), ("gone", "gone"), ("going", "going")],
    ),
    (
        "Which word is a noun?",
        "কোন শব্দটি বিশেষ্য?",
        [
            ("Happiness", "Happiness"),
            ("Quickly", "Quickly"),
            ("Run", "Run"),
            ("Beautiful", "Beautiful"),
        ],
    ),
    (
        "Choose the plural of 'child'.",
        "'child'-এর বহুবচন বেছে নিন।",
        [
            ("children", "children"),
            ("childs", "childs"),
            ("childes", "childes"),
            ("child", "child"),
        ],
    ),
    (
        "She ___ to school every day.",
        "She ___ to school every day.",
        [("goes", "goes"), ("go", "go"), ("going", "going"), ("gone", "gone")],
    ),
    (
        "Which is a synonym of 'big'?",
        "'big'-এর সমার্থক শব্দ কোনটি?",
        [("Large", "Large"), ("Small", "Small"), ("Thin", "Thin"), ("Short", "Short")],
    ),
    (
        "Which is an antonym of 'early'?",
        "'early'-এর বিপরীত শব্দ কোনটি?",
        [("Late", "Late"), ("Soon", "Soon"), ("Fast", "Fast"), ("First", "First")],
    ),
    (
        "Identify the adjective: 'The tall man smiled.'",
        "বিশেষণ চিহ্নিত করুন: 'The tall man smiled.'",
        [("tall", "tall"), ("man", "man"), ("smiled", "smiled"), ("The", "The")],
    ),
)
GENERAL_KNOWLEDGE = (
    (
        "What is the capital of Bangladesh?",
        "বাংলাদেশের রাজধানী কোনটি?",
        [("Dhaka", "ঢাকা"), ("Chattogram", "চট্টগ্রাম"), ("Khulna", "খুলনা"), ("Sylhet", "সিলেট")],
    ),
    (
        "Which is the national flower of Bangladesh?",
        "বাংলাদেশের জাতীয় ফুল কোনটি?",
        [("Water lily", "শাপলা"), ("Rose", "গোলাপ"), ("Lotus", "পদ্ম"), ("Jasmine", "বেলি")],
    ),
    (
        "When is the Independence Day of Bangladesh?",
        "বাংলাদেশের স্বাধীনতা দিবস কবে?",
        [
            ("26 March", "২৬ মার্চ"),
            ("16 December", "১৬ ডিসেম্বর"),
            ("21 February", "২১ ফেব্রুয়ারি"),
            ("14 April", "১৪ এপ্রিল"),
        ],
    ),
    (
        "Which is the longest river in the world?",
        "পৃথিবীর দীর্ঘতম নদী কোনটি?",
        [("Nile", "নীল নদ"), ("Amazon", "আমাজন"), ("Padma", "পদ্মা"), ("Yangtze", "ইয়াংসি")],
    ),
    (
        "What is the currency of Bangladesh?",
        "বাংলাদেশের মুদ্রার নাম কী?",
        [("Taka", "টাকা"), ("Rupee", "রুপি"), ("Dollar", "ডলার"), ("Ringgit", "রিংগিত")],
    ),
    (
        "Which is the largest ocean?",
        "সবচেয়ে বড় মহাসাগর কোনটি?",
        [
            ("Pacific", "প্রশান্ত মহাসাগর"),
            ("Atlantic", "আটলান্টিক মহাসাগর"),
            ("Indian", "ভারত মহাসাগর"),
            ("Arctic", "উত্তর মহাসাগর"),
        ],
    ),
    (
        "International Mother Language Day is on?",
        "আন্তর্জাতিক মাতৃভাষা দিবস কবে?",
        [
            ("21 February", "২১ ফেব্রুয়ারি"),
            ("26 March", "২৬ মার্চ"),
            ("1 May", "১ মে"),
            ("16 December", "১৬ ডিসেম্বর"),
        ],
    ),
    (
        "Which is the largest mangrove forest in the world?",
        "পৃথিবীর বৃহত্তম ম্যানগ্রোভ বন কোনটি?",
        [("Sundarbans", "সুন্দরবন"), ("Amazon", "আমাজন"), ("Lawachara", "লাউয়াছড়া"), ("Bhawal", "ভাওয়াল")],
    ),
)
ICT = (
    (
        "What does CPU stand for?",
        "CPU-এর পূর্ণরূপ কী?",
        [
            ("Central Processing Unit", "সেন্ট্রাল প্রসেসিং ইউনিট"),
            ("Computer Personal Unit", "কম্পিউটার পার্সোনাল ইউনিট"),
            ("Central Program Utility", "সেন্ট্রাল প্রোগ্রাম ইউটিলিটি"),
            ("Control Processing Unit", "কন্ট্রোল প্রসেসিং ইউনিট"),
        ],
    ),
    (
        "Which device is an input device?",
        "কোনটি ইনপুট ডিভাইস?",
        [("Keyboard", "কীবোর্ড"), ("Monitor", "মনিটর"), ("Printer", "প্রিন্টার"), ("Speaker", "স্পিকার")],
    ),
    (
        "1 byte equals how many bits?",
        "১ বাইট সমান কত বিট?",
        [("8", "৮"), ("4", "৪"), ("16", "১৬"), ("2", "২")],
    ),
    (
        "What does HTML stand for?",
        "HTML-এর পূর্ণরূপ কী?",
        [
            ("HyperText Markup Language", "হাইপারটেক্সট মার্কআপ ল্যাঙ্গুয়েজ"),
            ("High Text Machine Language", "হাই টেক্সট মেশিন ল্যাঙ্গুয়েজ"),
            ("Hyper Tool Multi Language", "হাইপার টুল মাল্টি ল্যাঙ্গুয়েজ"),
            ("Home Text Markup Language", "হোম টেক্সট মার্কআপ ল্যাঙ্গুয়েজ"),
        ],
    ),
    (
        "Which is a web browser?",
        "কোনটি ওয়েব ব্রাউজার?",
        [("Firefox", "ফায়ারফক্স"), ("Excel", "এক্সেল"), ("Windows", "উইন্ডোজ"), ("Photoshop", "ফটোশপ")],
    ),
    (
        "The binary number 101 equals which decimal?",
        "বাইনারি ১০১ দশমিকে কত?",
        [("5", "৫"), ("3", "৩"), ("6", "৬"), ("4", "৪")],
    ),
    (
        "Which is volatile memory?",
        "কোনটি অস্থায়ী মেমোরি?",
        [("RAM", "র‍্যাম"), ("ROM", "রম"), ("Hard disk", "হার্ড ডিস্ক"), ("DVD", "ডিভিডি")],
    ),
    (
        "What does 'www' stand for?",
        "'www'-এর পূর্ণরূপ কী?",
        [
            ("World Wide Web", "ওয়ার্ল্ড ওয়াইড ওয়েব"),
            ("Wide Web World", "ওয়াইড ওয়েব ওয়ার্ল্ড"),
            ("Web World Wide", "ওয়েব ওয়ার্ল্ড ওয়াইড"),
            ("World Web Wide", "ওয়ার্ল্ড ওয়েব ওয়াইড"),
        ],
    ),
)

BN_DIGITS = str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯")


def _bn(value) -> str:
    return str(value).translate(BN_DIGITS)


def math_questions():
    """Twelve deterministic arithmetic questions (bilingual digits)."""
    rows = []
    for i in range(12):
        a, b = 12 + i * 7, 5 + i * 3
        if i % 3 == 0:
            text_en, text_bn, answer = f"What is {a} + {b}?", f"{_bn(a)} + {_bn(b)} = কত?", a + b
        elif i % 3 == 1:
            text_en, text_bn, answer = f"What is {a} − {b}?", f"{_bn(a)} − {_bn(b)} = কত?", a - b
        else:
            x, y = 3 + i, 4 + i % 5
            text_en, text_bn, answer = f"What is {x} × {y}?", f"{_bn(x)} × {_bn(y)} = কত?", x * y
        values = [answer, answer + 1, answer - 2, answer + 10]
        rows.append((text_en, text_bn, [(str(v), _bn(v)) for v in values]))
    return rows


@contextlib.contextmanager
def seed_payment_provider():
    """Seed-only, in-process mock payment provider (see the module docstring). Scoped to
    this ``with`` block of this one command process; the ledger lives in local memory;
    the mock gateway makes no network call. Runtime settings are untouched."""
    with override_settings(
        PAYMENT_PROVIDER="mock",
        PAYMENT_MOCK_ALLOWED=True,
        CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
    ):
        yield


class Command(BaseCommand):
    help = "Seed deterministic, synthetic demo data (demo database only; idempotent)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--check", action="store_true", help="Only report whether the demo data exists."
        )
        parser.add_argument(
            "--production-preview",
            action="store_true",
            help="Seed the production database before launch (see the module docstring).",
        )

    def handle(self, *args, check=False, production_preview=False, **options):
        from apps.catalog.models import Category
        from apps.core.demo import database_name

        if production_preview:
            require_production_preview_environment()
            name = database_name()
        else:
            name = require_demo()

        seeded = Category.objects.filter(slug=MARKER_SLUG).exists()
        if seeded or check:
            state = "already seeded — nothing changed" if seeded else "not seeded yet"
            self.stdout.write(f"seed_demo [{name}]: {state}.")
            return
        if production_preview:
            require_no_real_activity()
        with transaction.atomic():
            counts = Seeder(with_payments=not production_preview).run()
        summary = ", ".join(f"{key}={value}" for key, value in counts.items())
        self.stdout.write(self.style.SUCCESS(f"seed_demo [{name}]: seeded ({summary})."))


class Seeder:
    """Builds the demo data through the normal services (one transaction)."""

    def __init__(self, *, with_payments: bool = True):
        from apps.audit.services import AuditContext

        # Payments and their events are permanent financial records (append-only, enforced
        # by PostgreSQL), so they could never be removed again: the production preview
        # seeds no payments.
        self.with_payments = with_payments
        self.ctx = AuditContext()
        self.now = timezone.now()

    # -- people --------------------------------------------------------------------------
    def students(self):
        from apps.accounts.models import User

        created = {}
        for full_name, number in STUDENTS:
            # No password: these accounts cannot sign in; they exist to show data.
            created[full_name] = User.objects.create_user(number, full_name=full_name)
        created["Kamal Uddin"].is_active = False
        created["Kamal Uddin"].save(update_fields=["is_active"])
        return created

    # -- content -------------------------------------------------------------------------
    def catalog(self):
        from apps.catalog import services as catalog
        from apps.catalog.models import Category, Subject

        subjects = {}
        for order, (slug, name_en, name_bn, subject_rows) in enumerate(CATALOG):
            category = catalog.create_category(
                Category(slug=slug, name_en=name_en, name_bn=name_bn, sort_order=order),
                ctx=self.ctx,
            )
            for sub_order, (sub_slug, sub_en, sub_bn) in enumerate(subject_rows):
                subjects[sub_slug] = catalog.create_subject(
                    Subject(
                        category=category,
                        slug=sub_slug,
                        name_en=sub_en,
                        name_bn=sub_bn,
                        sort_order=sub_order,
                    ),
                    ctx=self.ctx,
                )
        return subjects

    def questions(self, subjects):
        from apps.questions import services as questions
        from apps.questions.models import Question

        banks = {
            "demo-mathematics": math_questions(),
            "demo-science": SCIENCE,
            "demo-english": ENGLISH,
            "demo-general-knowledge": GENERAL_KNOWLEDGE,
            "demo-ict": ICT,
        }
        difficulties = ("easy", "medium", "hard")
        made = {}
        for slug, bank in banks.items():
            made[slug] = [
                questions.create_question(
                    Question(
                        subject=subjects[slug],
                        text_en=text_en,
                        text_bn=text_bn,
                        difficulty=difficulties[index % 3],
                    ),
                    [
                        {"text_en": en, "text_bn": bn, "is_correct": position == 0}
                        for position, (en, bn) in enumerate(options)
                    ],
                    ctx=self.ctx,
                )
                for index, (text_en, text_bn, options) in enumerate(bank)
            ]
        return made

    def exam(self, subject, bank, slug, title_en, title_bn, *, publish=True, **settings):
        from apps.exams import services as exams
        from apps.exams.models import Exam

        exam = exams.create_exam(
            Exam(
                title_en=title_en,
                title_bn=title_bn,
                slug=slug,
                category=subject.category,
                subject=subject,
                content_language="both",
                exam_type="regular",
                duration_minutes=20,
                total_questions=len(bank),
                **settings,
            ),
            ctx=self.ctx,
            provided=set(settings),
        )
        exams.set_exam_questions(
            exam.pk,
            [{"question": q.pk, "sort_order": i} for i, q in enumerate(bank)],
            ctx=self.ctx,
        )
        if publish:
            exams.publish_exam(exam.pk, ctx=self.ctx)
        exam.refresh_from_db()
        return exam

    def submit(self, student, exam, correct):
        """The student answers ``correct`` questions right (display order) and submits."""
        from apps.attempts import services as attempts

        attempt, _created = attempts.start_attempt(student, exam.pk)
        rows = list(attempt.answers.order_by("display_order"))
        items = []
        for index, row in enumerate(rows):
            right = row.question.options.get(is_correct=True)
            wrong = row.question.options.filter(is_correct=False).order_by("pk").first()
            if index < correct:
                items.append(right)
            elif index < correct + 2:  # a couple of wrong answers, the rest unanswered
                items.append(wrong)
            else:
                break
        payload = [
            {
                "question_id": row.question_id,
                "selected_option_id": option.pk,
                "client_saved_at": timezone.now(),
            }
            for row, option in zip(rows, items, strict=False)
        ]
        if payload:
            attempts.save_answers(student, attempt.public_id, payload)
        attempts.submit_attempt(student, attempt.public_id)

    # -- commerce ------------------------------------------------------------------------
    def package(self, slug, name_en, name_bn, price, validity_days, rules, **extra):
        from apps.subscriptions import services as subscriptions
        from apps.subscriptions.models import Package

        package = subscriptions.create_package(
            Package(
                slug=slug,
                name_en=name_en,
                name_bn=name_bn,
                price=Decimal(price),
                validity_days=validity_days,
                **extra,
            ),
            ctx=self.ctx,
        )
        subscriptions.set_access_rules(package.pk, rules, ctx=self.ctx)
        return package

    @staticmethod
    def pay(student, package, result=None):
        """One payment through the payment services and the seed-only mock gateway:
        initiate → (checkout outcome → provider callback → server-side verification)."""
        from apps.payments import services as payments
        from apps.payments.gateways import mock as mock_gateway

        payment, _created = payments.initiate_payment(student, package.pk)
        if result:
            val_id = mock_gateway.complete(payment.merchant_reference, result)
            payments.process_callback(
                "mock", result, {"tran_id": payment.merchant_reference, "val_id": val_id}
            )
        payment.refresh_from_db()
        return payment

    # -- the whole demo ------------------------------------------------------------------
    def run(self) -> dict:
        from apps.catalog.models import Category
        from apps.exams import services as exams
        from apps.results import services as results
        from apps.subscriptions import services as subscriptions

        people = self.students()
        subjects = self.catalog()
        bank = self.questions(subjects)

        # Exams: two published free exams with results (one with a merit list), one paid,
        # one scheduled, one draft.
        math = self.exam(
            subjects["demo-mathematics"],
            bank["demo-mathematics"][:10],
            "demo-math-model-test-1",
            "Mathematics Model Test 1",
            "গণিত মডেল টেস্ট ১",
            pass_marks=Decimal("5"),
        )
        science = self.exam(
            subjects["demo-science"],
            bank["demo-science"],
            "demo-science-quiz",
            "General Science Quiz",
            "সাধারণ বিজ্ঞান কুইজ",
            result_visibility="manual",
        )
        paid = self.exam(
            subjects["demo-general-knowledge"],
            bank["demo-general-knowledge"],
            "demo-gk-premium",
            "General Knowledge Premium Test",
            "সাধারণ জ্ঞান প্রিমিয়াম টেস্ট",
            access_type="paid",
        )
        self.exam(
            subjects["demo-ict"],
            bank["demo-ict"],
            "demo-ict-weekly",
            "Weekly ICT Test",
            "সাপ্তাহিক আইসিটি টেস্ট",
            start_at=self.now + timedelta(days=3),
            end_at=self.now + timedelta(days=4),
        )
        self.exam(
            subjects["demo-english"],
            bank["demo-english"],
            "demo-english-practice",
            "English Grammar Practice",
            "ইংরেজি ব্যাকরণ অনুশীলন",
            publish=False,
        )

        active = [s for s in people.values() if s.is_active]
        scores = (10, 9, 9, 8, 7, 6, 5, 4, 3, 2, 1)
        for student, correct in zip(active, scores, strict=False):
            self.submit(student, math, correct)
        for student, correct in zip(active[:6], (9, 8, 6, 5, 3, 2), strict=False):
            self.submit(student, science, correct)
        results.generate_merit(math.pk, ctx=self.ctx)
        exams.publish_results(science.pk, ctx=self.ctx)
        # One attempt still open (shows in Attempts as in progress).
        from apps.attempts import services as attempts

        attempts.start_attempt(active[6], science.pk)

        # Packages: a category package (featured), an all-paid-exams package, an exam package.
        ssc = Category.objects.get(slug="demo-ssc")
        science_pack = self.package(
            "demo-ssc-science-pack",
            "SSC Science Pack",
            "এসএসসি বিজ্ঞান প্যাক",
            "300",
            30,
            [{"rule_type": "category", "category": ssc.pk}],
            is_featured=True,
            sort_order=1,
            features_en=["All SSC exams", "Merit lists"],
            features_bn=["সব এসএসসি পরীক্ষা", "মেধা তালিকা"],
        )
        full_access = self.package(
            "demo-full-access",
            "Full Access",
            "ফুল অ্যাক্সেস",
            "500",
            30,
            [{"rule_type": "all_paid_exams"}],
            sort_order=2,
        )
        self.package(
            "demo-gk-premium-pass",
            "GK Premium Pass",
            "সাধারণ জ্ঞান প্রিমিয়াম পাস",
            "150",
            15,
            [{"rule_type": "exam", "exam": paid.pk}],
            sort_order=3,
        )

        # Manual subscriptions: active, scheduled, cancelled.
        subscriptions.grant_subscription(people["Ayesha Rahman"].pk, science_pack.pk, ctx=self.ctx)
        subscriptions.grant_subscription(
            people["নুসরাত জাহান"].pk,
            science_pack.pk,
            ctx=self.ctx,
            starts_at=self.now + timedelta(days=5),
        )
        cancelled = subscriptions.grant_subscription(
            people["Rafiq Ahmed"].pk, science_pack.pk, ctx=self.ctx
        )
        subscriptions.cancel_subscription(cancelled.subscription.pk, ctx=self.ctx)

        if not self.with_payments:
            return counts()

        # Payments (seed-only mock gateway; no network): a renewal (two verified payments
        # extend one subscription), failed, cancelled, pending, and a purchased-validity
        # example (bought at 30 days, the package was then changed to 45 days before the
        # payment was verified — the subscription still runs 30 days).
        with seed_payment_provider():
            self.pay(people["Tanvir Hasan"], full_access, "success")
            self.pay(people["Tanvir Hasan"], full_access, "success")
            self.pay(people["সাবরিনা ইসলাম"], science_pack, "fail")
            self.pay(people["Imran Hossain"], science_pack, "cancel")
            self.pay(people["Farzana Akter"], full_access)  # still pending
            bought = self.pay(people["মাহমুদ হাসান"], full_access)
            subscriptions.update_package(full_access.pk, {"validity_days": 45}, ctx=self.ctx)
            from apps.payments import services as payments
            from apps.payments.gateways import mock as mock_gateway

            val_id = mock_gateway.complete(bought.merchant_reference, "success")
            payments.process_callback(
                "mock", "success", {"tran_id": bought.merchant_reference, "val_id": val_id}
            )

        return counts()


def counts() -> dict:
    from apps.accounts.models import Role, User
    from apps.attempts.models import ExamAttempt
    from apps.catalog.models import Category, Subject
    from apps.exams.models import Exam
    from apps.payments.models import Payment
    from apps.questions.models import Question
    from apps.results.models import Result
    from apps.subscriptions.models import Package, Subscription

    return {
        "students": User.objects.filter(role=Role.STUDENT).count(),
        "categories": Category.objects.count(),
        "subjects": Subject.objects.count(),
        "questions": Question.objects.count(),
        "exams": Exam.objects.count(),
        "attempts": ExamAttempt.objects.count(),
        "results": Result.objects.count(),
        "packages": Package.objects.count(),
        "subscriptions": Subscription.objects.count(),
        "payments": Payment.objects.count(),
    }
