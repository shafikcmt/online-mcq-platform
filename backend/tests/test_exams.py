"""Milestone 3C: exam builder, question lock, publish rules, duplicate, public listing."""

import json
import threading
from datetime import timedelta
from decimal import Decimal
from unittest import mock

import pytest
from django.core.exceptions import ValidationError
from django.db import DatabaseError, IntegrityError, connection, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.audit.models import AuditLog
from apps.audit.services import AuditContext
from apps.catalog import services as catalog
from apps.catalog.models import Category, Subject
from apps.exams import services
from apps.exams.exceptions import ExamStateError
from apps.exams.models import Exam, ExamQuestion, ExamStatus
from apps.questions import services as question_services
from apps.questions.exceptions import QuestionInUse, QuestionLocked
from apps.questions.models import Question, QuestionOption

pytestmark = pytest.mark.django_db

PW = "Strong-Pass-2026"  # test-only value
EXAMS = "/api/v1/admin/exams/"
PUBLIC = "/api/v1/public/exams/"
CTX = AuditContext()


# --------------------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def _media(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "media")


@pytest.fixture
def admin_user():
    return User.objects.create_user(
        "01612345678", password=PW, full_name="Ops", role=Role.ADMIN, preferred_language="en"
    )


@pytest.fixture
def api(admin_user):
    client = APIClient()
    client.force_login(admin_user)
    return client


def make_category(slug="science", **fields):
    existing = Category.objects.filter(slug=slug).first()
    if existing:
        return existing
    fields.setdefault("name_en", slug.title())
    return catalog.create_category(Category(slug=slug, **fields), ctx=CTX)


def make_subject(slug="physics", category=None, **fields):
    category = category or make_category()
    fields.setdefault("name_en", slug.title())
    return catalog.create_subject(Subject(category=category, slug=slug, **fields), ctx=CTX)


@pytest.fixture
def subject():
    return make_subject()


def make_question(subject, langs=("bn", "en"), n=4, **fields):
    for lang in langs:
        fields.setdefault(f"text_{lang}", f"Question text {lang} {Question.objects.count()}")
    options = [
        {**{f"text_{lang}": f"Option {i} {lang}" for lang in langs}, "is_correct": i == 0}
        for i in range(n)
    ]
    return question_services.create_question(Question(subject=subject, **fields), options, ctx=CTX)


def exam_data(subject, /, **extra):
    data = {
        "title_bn": "পদার্থবিজ্ঞান মডেল টেস্ট",
        "title_en": "Physics Model Test",
        "category": subject.category,
        "content_language": "both",
        "exam_type": "regular",
        "duration_minutes": 30,
        "total_questions": 3,
    }
    data.update(extra)
    return data


def make_exam(subject, /, questions=None, publish=False, **extra):
    exam = services.create_exam(Exam(**exam_data(subject, **extra)), ctx=CTX, provided=set(extra))
    questions = [make_question(subject) for _ in range(3)] if questions is None else questions
    services.set_exam_questions(
        exam.pk, [{"question": q.pk, "sort_order": i} for i, q in enumerate(questions)], ctx=CTX
    )
    if publish:
        services.publish_exam(exam.pk, ctx=CTX)
    exam.refresh_from_db()
    return exam


def api_payload(subject, /, **extra):
    data = exam_data(subject, **extra)
    if "category" not in extra:
        data["category"] = subject.category_id
    return data


def errors(response):
    return response.json()["error"]["field_errors"]


def code(response):
    return response.json()["error"]["code"]


def publish_problems(exam_id):
    with transaction.atomic():
        return services.publish_errors(Exam.objects.select_for_update().get(pk=exam_id))


# ======================================================================================
# Models & database constraints
# ======================================================================================
class TestDatabase:
    def test_question_once_and_unique_order(self, subject):
        exam = make_exam(subject)
        question = ExamQuestion.objects.filter(exam=exam).first().question
        with pytest.raises(IntegrityError), transaction.atomic():
            ExamQuestion.objects.create(exam=exam, question=question, sort_order=99)
        with pytest.raises(IntegrityError), transaction.atomic():
            ExamQuestion.objects.create(exam=exam, question=make_question(subject), sort_order=0)

    @pytest.mark.parametrize(
        "sql",
        [
            "UPDATE exams_examquestion SET marks = 0",
            "UPDATE exams_examquestion SET sort_order = -1",
            "UPDATE exams_exam SET exam_type = 'live', allow_retake = true",
            "UPDATE exams_exam SET allow_retake = false, max_attempts = 3",
            "UPDATE exams_exam SET max_attempts = 0, allow_retake = true",
            "UPDATE exams_exam SET start_at = now(), end_at = now() - interval '1 hour'",
            "UPDATE exams_exam SET duration_minutes = 0",
            "UPDATE exams_exam SET total_questions = 0",
            "UPDATE exams_exam SET default_marks = 0",
            "UPDATE exams_exam SET negative_marks = -1",
            "UPDATE exams_exam SET status = 'live'",
            "UPDATE exams_exam SET merit_strategy = 'random'",
            "UPDATE exams_exam SET exam_type = 'live', status = 'published', start_at = NULL",
            "UPDATE exams_exam SET title_bn = '', title_en = ''",
            "UPDATE exams_exam SET slug = 'Bad Slug'",
        ],
    )
    def test_raw_invalid_data_rejected(self, subject, sql):
        make_exam(subject)
        with pytest.raises(IntegrityError), transaction.atomic(), connection.cursor() as cur:
            cur.execute(sql)

    def test_deleting_an_exam_keeps_its_questions(self, subject):
        exam = make_exam(subject)
        services.delete_exam(exam.pk, ctx=CTX)
        assert not ExamQuestion.objects.exists() and Question.objects.count() == 3


# ======================================================================================
# Permissions
# ======================================================================================
class TestPermissions:
    def test_anonymous_student_and_csrf(self, admin_user, subject):
        from apps.accounts.tokens import issue_tokens

        exam = make_exam(subject)
        student = User.objects.create_user("01712345678", password=PW, full_name="S")
        jwt = APIClient()
        jwt.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(student)['access']}")
        session = APIClient()
        session.force_login(student)
        csrf = APIClient(enforce_csrf_checks=True)
        csrf.force_login(admin_user)
        detail = f"{EXAMS}{exam.pk}/"
        writes = [
            ("post", EXAMS, api_payload(subject)),
            ("patch", detail, {"duration_minutes": 40}),
            ("delete", detail, None),
            ("patch", f"{detail}questions/", {"questions": []}),
            ("post", f"{detail}publish/", None),
            ("post", f"{detail}unpublish/", None),
            ("post", f"{detail}archive/", None),
            ("post", f"{detail}duplicate/", None),
        ]
        for client, expected in ((APIClient(), 401), (jwt, 401), (session, 403), (csrf, 403)):
            for method, url, body in writes:
                response = getattr(client, method)(url, body, format="json")
                assert response.status_code == expected, (client, method, url)
        for client, expected in ((APIClient(), 401), (jwt, 401), (session, 403)):
            assert client.get(EXAMS).status_code == expected
        assert csrf.get(EXAMS).status_code == 200  # reads need no CSRF token
        exam.refresh_from_db()
        assert exam.status == ExamStatus.DRAFT and exam.duration_minutes == 30
        assert Exam.objects.count() == 1 and ExamQuestion.objects.count() == 3


# ======================================================================================
# Create / update / delete
# ======================================================================================
class TestCrud:
    def test_create_draft_with_generated_slug(self, api, subject, admin_user):
        response = api.post(EXAMS, api_payload(subject), format="json")
        assert response.status_code == 201, response.content
        body = response.json()
        assert body["status"] == "draft" and body["slug"] == "physics-model-test"
        assert body["created_by"] == admin_user.pk and body["question_count"] == 0
        assert body["total_marks"] == "0.00" and body["default_marks"] == "1.00"
        again = api.post(EXAMS, api_payload(subject), format="json").json()
        assert again["slug"] == "physics-model-test-2"

    def test_marks_and_minutes_typed_with_bangla_digits(self, api, subject):
        """docs/LOCALIZATION.md §11: Bangla-digit input is accepted for marks and counts."""
        payload = api_payload(
            subject, duration_minutes="৪৫", default_marks="২", negative_marks="০.২৫"
        )
        response = api.post(EXAMS, payload, format="json")
        assert response.status_code == 201, response.content
        body = response.json()
        assert (body["duration_minutes"], body["default_marks"], body["negative_marks"]) == (
            45,
            "2.00",
            "0.25",
        )

    @pytest.mark.parametrize(
        "extra, expected",
        [
            ({"exam_type": "regular"}, (False, 1, True, "first_attempt")),
            ({"exam_type": "practice"}, (True, None, False, "first_attempt")),
            (
                {
                    "exam_type": "live",
                    "allow_retake": True,
                    "max_attempts": 5,
                    "merit_strategy": "best_attempt",
                },
                (False, 1, True, "first_attempt"),
            ),
            ({"allow_retake": False, "max_attempts": 7}, (False, 1, True, "first_attempt")),
            ({"allow_retake": True, "max_attempts": None}, (True, None, True, "first_attempt")),
            (
                {"allow_retake": True, "max_attempts": 3, "merit_strategy": "best_attempt"},
                (True, 3, True, "best_attempt"),
            ),
            ({"exam_type": "practice", "merit_enabled": True}, (True, None, True, "first_attempt")),
        ],
    )
    def test_type_defaults_and_retake_rules(self, api, subject, extra, expected):
        response = api.post(EXAMS, api_payload(subject, **extra), format="json")
        assert response.status_code == 201, response.content
        body = response.json()
        actual = (
            body["allow_retake"],
            body["max_attempts"],
            body["merit_enabled"],
            body["merit_strategy"],
        )
        assert actual == expected

    @pytest.mark.parametrize(
        "extra, field",
        [
            ({"allow_retake": True, "max_attempts": 1}, "max_attempts"),
            ({"title_bn": "", "title_en": "  "}, "title_en"),
            ({"title_en": "", "slug": ""}, "slug"),
            ({"slug": "Bad slug"}, "slug"),
            ({"duration_minutes": 0}, "duration_minutes"),
            ({"total_questions": 0}, "total_questions"),
            ({"default_marks": "0"}, "default_marks"),
            ({"negative_marks": "-0.25"}, "negative_marks"),
            ({"exam_type": "marathon"}, "exam_type"),
            ({"content_language": "fr"}, "content_language"),
            ({"merit_strategy": "random"}, "merit_strategy"),
            ({"category": 999999}, "category"),
        ],
    )
    def test_validation_errors(self, api, subject, extra, field):
        response = api.post(EXAMS, api_payload(subject, **extra), format="json")
        assert response.status_code == 400 and field in errors(response), response.content
        assert not Exam.objects.exists()

    def test_subject_must_belong_to_category(self, api, subject):
        other = make_subject("algebra", category=make_category("maths"))
        response = api.post(EXAMS, api_payload(subject, subject=other.pk), format="json")
        assert response.status_code == 400 and "subject" in errors(response)
        ok = api.post(EXAMS, api_payload(subject, subject=subject.pk), format="json")
        assert ok.status_code == 201

    def test_schedule_rules(self, api, subject):
        start = timezone.now() + timedelta(days=1)
        bad_order = api_payload(subject, start_at=start.isoformat(), end_at=start.isoformat())
        assert "end_at" in errors(api.post(EXAMS, bad_order, format="json"))
        short = api_payload(
            subject,
            start_at=start.isoformat(),
            end_at=(start + timedelta(minutes=10)).isoformat(),
        )
        assert "end_at" in errors(api.post(EXAMS, short, format="json"))
        ok = api_payload(
            subject, start_at=start.isoformat(), end_at=(start + timedelta(hours=1)).isoformat()
        )
        assert api.post(EXAMS, ok, format="json").status_code == 201

    def test_read_only_fields_ignored(self, api, subject):
        other = User.objects.create_user("01712345678", password=PW, full_name="S")
        body = api.post(
            EXAMS,
            api_payload(
                subject,
                status="published",
                id=999,
                public_id="00000000-0000-0000-0000-000000000000",
                created_by=other.pk,
                question_count=50,
                total_marks="99.00",
            ),
            format="json",
        ).json()
        assert body["status"] == "draft" and body["id"] != 999
        assert body["public_id"] != "00000000-0000-0000-0000-000000000000"
        assert body["created_by"] != other.pk and body["question_count"] == 0
        response = api.patch(f"{EXAMS}{body['id']}/", {"status": "published"}, format="json")
        assert response.status_code == 200 and response.json()["status"] == "draft"

    def test_update_and_no_op(self, api, subject):
        exam = make_exam(subject)
        url = f"{EXAMS}{exam.pk}/"
        response = api.patch(url, {"duration_minutes": 45, "is_featured": True}, format="json")
        assert response.status_code == 200 and response.json()["duration_minutes"] == 45
        log = AuditLog.objects.get(action="exam.update")
        assert log.metadata["changed_fields"] == ["duration_minutes", "is_featured"]
        api.patch(url, {"duration_minutes": 45, "title_en": " Physics  Model Test "}, format="json")
        assert AuditLog.objects.filter(action="exam.update").count() == 1

    def test_published_and_archived_exams_are_locked(self, api, subject):
        exam = make_exam(subject, publish=True)
        url = f"{EXAMS}{exam.pk}/"
        response = api.patch(url, {"duration_minutes": 99}, format="json")
        assert response.status_code == 409 and code(response) == "exam_locked"
        response = api.patch(f"{url}questions/", {"questions": []}, format="json")
        assert response.status_code == 409 and code(response) == "exam_locked"
        api.post(f"{url}unpublish/")
        assert api.patch(url, {"duration_minutes": 99}, format="json").status_code == 200
        api.post(f"{url}archive/")
        assert api.patch(url, {"duration_minutes": 50}, format="json").status_code == 409
        exam.refresh_from_db()
        assert exam.duration_minutes == 99

    def test_delete_rules(self, api, subject):
        draft = make_exam(subject)
        assert api.delete(f"{EXAMS}{draft.pk}/").status_code == 204
        assert Question.objects.count() == 3
        published = make_exam(subject, questions=list(Question.objects.all()), publish=True)
        response = api.delete(f"{EXAMS}{published.pk}/")
        assert response.status_code == 409 and code(response) == "exam_not_deletable"
        api.post(f"{EXAMS}{published.pk}/unpublish/")
        assert api.delete(f"{EXAMS}{published.pk}/").status_code == 409
        assert Exam.objects.filter(pk=published.pk).exists()

    def test_put_not_allowed(self, api, subject):
        exam = make_exam(subject)
        assert api.put(f"{EXAMS}{exam.pk}/", {}, format="json").status_code == 405


class TestAdminListing:
    @pytest.fixture
    def exams(self, subject):
        start = timezone.now() + timedelta(days=2)
        return {
            "draft": make_exam(subject, title_en="Draft Physics", title_bn="খসড়া"),
            "live": make_exam(
                subject,
                title_en="Live Final",
                exam_type="live",
                start_at=start,
                end_at=start + timedelta(hours=2),
                publish=True,
            ),
            "practice": make_exam(
                make_subject("algebra", category=make_category("maths")),
                title_en="Algebra Practice",
                title_bn="বীজগণিত",
                exam_type="practice",
                content_language="bn",
                access_type="paid",
            ),
        }

    def ids(self, api, query=""):
        response = api.get(EXAMS + query)
        assert response.status_code == 200, response.content
        return [row["id"] for row in response.json()["results"]]

    def test_filters_search_ordering(self, api, exams):
        e = {k: v.pk for k, v in exams.items()}
        assert self.ids(api, "?exam_type=live") == [e["live"]]
        assert self.ids(api, "?status=published") == [e["live"]]
        assert self.ids(api, "?content_language=bn") == [e["practice"]]
        assert self.ids(api, "?access_type=paid") == [e["practice"]]
        assert self.ids(api, f"?category={exams['practice'].category_id}") == [e["practice"]]
        assert self.ids(api, "?upcoming=true") == [e["live"]]
        assert self.ids(api, "?search=বীজগণিত") == [e["practice"]]
        assert self.ids(api, "?search=final") == [e["live"]]
        assert self.ids(api, "?ordering=id") == sorted(e.values())
        assert self.ids(api) == sorted(e.values(), reverse=True)

    @pytest.mark.parametrize(
        "query",
        [
            "?exam_type=x",
            "?status=deleted",
            "?content_language=fr",
            "?category=abc",
            "?ordering=title_en",
            "?upcoming=maybe",
        ],
    )
    def test_invalid_parameters(self, api, exams, query):
        assert api.get(EXAMS + query).status_code == 400


# ======================================================================================
# Question list
# ======================================================================================
class TestQuestionList:
    def url(self, exam):
        return f"{EXAMS}{exam.pk}/questions/"

    def test_complete_replacement(self, api, subject):
        exam = make_exam(subject)
        q = [make_question(subject) for _ in range(3)]
        body = {
            "questions": [
                {"question": q[2].pk, "sort_order": 5, "marks": "2.50"},
                {"question": q[0].pk, "sort_order": 1},
            ]
        }
        response = api.patch(self.url(exam), body, format="json")
        assert response.status_code == 200, response.content
        rows = response.json()["questions"]
        assert [
            (r["question"], r["sort_order"], r["marks"], r["effective_marks"]) for r in rows
        ] == [
            (q[0].pk, 1, None, "1.00"),
            (q[2].pk, 5, "2.50", "2.50"),
        ]
        assert api.get(self.url(exam)).json() == response.json()
        exam_body = api.get(f"{EXAMS}{exam.pk}/").json()
        assert exam_body["question_count"] == 2 and exam_body["total_marks"] == "3.50"
        log = (
            AuditLog.objects.filter(action="exam.questions_update", entity_id=str(exam.pk))
            .order_by("id")
            .last()
        )
        assert log.metadata["changes"] == {"question_count": {"from": 3, "to": 2}}

    def test_default_order_and_no_op(self, api, subject):
        exam = make_exam(subject)
        current = list(
            exam.exam_questions.order_by("sort_order").values_list("question_id", flat=True)
        )
        response = api.patch(
            self.url(exam), {"questions": [{"question": i} for i in current]}, format="json"
        )
        assert response.status_code == 200
        assert AuditLog.objects.filter(action="exam.questions_update").count() == 1  # setup only

    @pytest.mark.parametrize(
        "make_items",
        [
            lambda q: [{"question": q[0].pk}, {"question": q[0].pk}],
            lambda q: [
                {"question": q[0].pk, "sort_order": 1},
                {"question": q[1].pk, "sort_order": 1},
            ],
            lambda q: [{"question": 999999}],
            lambda q: [{"question": q[0].pk, "marks": "0"}],
            lambda q: [{"question": q[0].pk, "sort_order": -1}],
            lambda q: [{"question": "abc"}],
        ],
    )
    def test_invalid_lists_change_nothing(self, api, subject, make_items):
        exam = make_exam(subject)
        before = list(exam.exam_questions.values_list("question_id", "sort_order", "marks"))
        q = [make_question(subject) for _ in range(2)]
        response = api.patch(self.url(exam), {"questions": make_items(q)}, format="json")
        assert response.status_code == 400 and "questions" in errors(response)
        assert list(exam.exam_questions.values_list("question_id", "sort_order", "marks")) == before

    def test_failure_rolls_back(self, api, subject):
        exam = make_exam(subject)
        before = list(exam.exam_questions.values_list("question_id", flat=True))
        with mock.patch.object(ExamQuestion.objects, "bulk_create", side_effect=DatabaseError("x")):
            with pytest.raises(DatabaseError):
                api.patch(self.url(exam), {"questions": []}, format="json")
        assert list(exam.exam_questions.values_list("question_id", flat=True)) == before

    def test_max_questions_setting(self, api, subject, settings):
        settings.EXAM_MAX_QUESTIONS = 2
        exam = make_exam(subject, questions=[])
        q = [make_question(subject) for _ in range(3)]
        response = api.patch(
            self.url(exam), {"questions": [{"question": x.pk} for x in q]}, format="json"
        )
        assert response.status_code == 400


class TestQuestionListText:
    """Milestone 7C approved contract repair: assigned exam questions include their
    bilingual text (read-only) so the Admin Panel exam builder needs no per-question
    requests. Nothing else of the question is exposed."""

    def url(self, exam):
        return f"{EXAMS}{exam.pk}/questions/"

    def test_rows_include_bilingual_text_and_keep_metadata(self, api, subject):
        bilingual = make_question(subject, text_bn="আলোর বেগ কত?", text_en="Speed of light?")
        english = make_question(subject, langs=("en",), text_en="Only English")
        exam = make_exam(subject, questions=[bilingual, english])
        rows = api.get(self.url(exam)).json()["questions"]
        assert [(r["question"], r["text_bn"], r["text_en"]) for r in rows] == [
            (bilingual.pk, "আলোর বেগ কত?", "Speed of light?"),
            (english.pk, "", "Only English"),
        ]
        first = rows[0]
        assert first["sort_order"] == 0 and first["marks"] is None
        assert first["effective_marks"] == "1.00" and first["subject"] == subject.pk
        assert first["available_languages"] == "both" and first["is_active"] is True
        assert rows[1]["available_languages"] == "en"

    def test_exposes_exactly_the_documented_fields(self, api, subject):
        exam = make_exam(subject)
        rows = api.get(self.url(exam)).json()["questions"]
        allowed = {
            "question",
            "sort_order",
            "marks",
            "effective_marks",
            "subject",
            "available_languages",
            "is_active",
            "text_bn",
            "text_en",
        }
        assert rows and all(set(row) == allowed for row in rows)
        # No answer data in any form (field names or option text).
        body = json.dumps(rows)
        for leak in ("is_correct", "options", "explanation", "Option 0"):
            assert leak not in body

    def test_text_is_read_only_and_not_required_on_patch(self, api, subject):
        exam = make_exam(subject)
        q = make_question(subject, text_en="Original text")
        before = (q.text_bn, q.text_en)
        body = {"questions": [{"question": q.pk, "text_en": "Changed", "text_bn": "x"}]}
        response = api.patch(self.url(exam), body, format="json")
        assert response.status_code == 200, response.content
        assert response.json()["questions"][0]["text_en"] == "Original text"
        q.refresh_from_db()
        assert (q.text_bn, q.text_en) == before  # extra keys are ignored, never written

    def test_complete_replacement_returns_text_for_the_new_list(self, api, subject):
        exam = make_exam(subject)
        new = [make_question(subject, text_en=f"New {i}") for i in range(3)]
        body = {
            "questions": [
                {"question": new[2].pk, "sort_order": 0, "marks": "2.00"},
                {"question": new[0].pk, "sort_order": 1},
            ]
        }
        response = api.patch(self.url(exam), body, format="json")
        assert response.status_code == 200
        rows = response.json()["questions"]
        assert [(r["question"], r["text_en"], r["marks"]) for r in rows] == [
            (new[2].pk, "New 2", "2.00"),
            (new[0].pk, "New 0", None),
        ]
        assert exam.exam_questions.count() == 2

    def test_query_count_does_not_grow_with_the_list(self, api, subject):
        from django.test.utils import CaptureQueriesContext

        small = make_exam(subject, questions=[make_question(subject) for _ in range(2)])
        large = make_exam(subject, questions=[make_question(subject) for _ in range(12)])
        counts = []
        for exam in (small, large):
            with CaptureQueriesContext(connection) as queries:
                response = api.get(self.url(exam))
            assert response.status_code == 200
            counts.append(len(queries))
        assert len(api.get(self.url(large)).json()["questions"]) == 12
        assert counts[0] == counts[1], counts  # no per-row query (no N+1)

    def test_still_admin_only(self, subject):
        exam = make_exam(subject)
        assert APIClient().get(self.url(exam)).status_code == 401
        student = User.objects.create_user("01698765432", password=PW, full_name="Student")
        client = APIClient()
        client.force_login(student)
        assert client.get(self.url(exam)).status_code == 403


# ======================================================================================
# Publish / unpublish / archive
# ======================================================================================
class TestPublish:
    def publish(self, api, exam):
        return api.post(f"{EXAMS}{exam.pk}/publish/")

    def test_valid_exam_publishes(self, api, subject):
        exam = make_exam(subject)
        response = self.publish(api, exam)
        assert response.status_code == 200 and response.json()["status"] == "published"
        log = AuditLog.objects.get(action="exam.publish")
        assert log.metadata["changes"] == {"status": {"from": "draft", "to": "published"}}
        assert log.metadata["values"]["question_count"] == 3
        again = self.publish(api, exam)
        assert again.status_code == 409 and code(again) == "already_published"
        assert AuditLog.objects.filter(action="exam.publish").count() == 1

    @pytest.mark.parametrize(
        "setup, field",
        [
            (lambda s: make_exam(s, questions=[]), "questions"),
            (lambda s: make_exam(s, total_questions=5), "questions"),
            (
                lambda s: make_exam(
                    s, questions=[make_question(s, is_active=False) for _ in range(3)]
                ),
                "questions",
            ),
            (
                lambda s: make_exam(
                    s, questions=[make_question(s, langs=("en",)) for _ in range(3)]
                ),
                "questions",
            ),
            (
                lambda s: make_exam(
                    s,
                    content_language="bn",
                    questions=[make_question(s, langs=("en",)) for _ in range(3)],
                ),
                "questions",
            ),
            (lambda s: make_exam(s, title_bn=""), "title_bn"),
            (lambda s: make_exam(s, content_language="en", title_en="", slug="x"), "title_en"),
            (lambda s: make_exam(s, exam_type="live"), "start_at"),
            (
                lambda s: make_exam(
                    s,
                    start_at=timezone.now() - timedelta(days=2),
                    end_at=timezone.now() - timedelta(days=1),
                ),
                "end_at",
            ),
            (lambda s: make_exam(s, pass_marks=Decimal("3.01")), "pass_marks"),
        ],
    )
    def test_invalid_exam_is_not_published(self, api, subject, setup, field):
        exam = setup(subject)
        response = self.publish(api, exam)
        assert response.status_code == 400, response.content
        assert code(response) == "validation_error" and field in errors(response)
        exam.refresh_from_db()
        assert exam.status == ExamStatus.DRAFT
        assert not AuditLog.objects.filter(action="exam.publish").exists()

    def test_english_only_exam_accepts_english_and_bilingual_questions(self, api, subject):
        questions = [
            make_question(subject, langs=("en",)),
            make_question(subject),
            make_question(subject, langs=("en",)),
        ]
        exam = make_exam(subject, content_language="en", questions=questions)
        assert self.publish(api, exam).status_code == 200

    def test_inactive_category_blocks_publish(self, api, subject):
        exam = make_exam(subject)
        Category.objects.filter(pk=subject.category_id).update(is_active=False)
        assert "category" in errors(self.publish(api, exam))

    def test_broken_question_integrity_blocks_publish(self, api, subject):
        exam = make_exam(subject)
        question = exam.exam_questions.first().question
        QuestionOption.objects.filter(question=question, is_correct=True).delete()  # ORM misuse
        assert "questions" in errors(self.publish(api, exam))

    def test_live_exam_with_schedule_publishes(self, api, subject):
        start = timezone.now() + timedelta(hours=1)
        exam = make_exam(
            subject, exam_type="live", start_at=start, end_at=start + timedelta(hours=1)
        )
        assert self.publish(api, exam).status_code == 200

    def test_unpublish_republish_archive(self, api, subject):
        exam = make_exam(subject, publish=True)
        url = f"{EXAMS}{exam.pk}/"
        assert api.post(f"{url}unpublish/").json()["status"] == "unpublished"
        assert code(api.post(f"{url}unpublish/")) == "not_published"
        assert self.publish(api, exam).json()["status"] == "published"
        assert code(api.post(f"{url}archive/")) == "not_archivable"
        api.post(f"{url}unpublish/")
        assert api.post(f"{url}archive/").json()["status"] == "archived"
        assert code(self.publish(api, exam)) == "invalid_status"
        actions = list(
            AuditLog.objects.filter(entity_id=str(exam.pk), action__startswith="exam.")
            .exclude(action__in=["exam.create", "exam.questions_update"])
            .order_by("id")
            .values_list("action", flat=True)
        )
        assert actions == [
            "exam.publish",
            "exam.unpublish",
            "exam.publish",
            "exam.unpublish",
            "exam.archive",
        ]

    def test_messages_in_bangla(self, api, subject):
        exam = make_exam(subject, questions=[])
        response = api.post(f"{EXAMS}{exam.pk}/publish/", HTTP_ACCEPT_LANGUAGE="bn")
        assert any("ঀ" <= ch <= "৿" for ch in errors(response)["questions"][0])


# ======================================================================================
# Question lock
# ======================================================================================
class TestQuestionLock:
    QUESTIONS = "/api/v1/admin/questions/"

    def test_draft_exam_questions_stay_editable_but_not_deletable(self, api, subject):
        exam = make_exam(subject)
        question = exam.exam_questions.first().question
        response = api.patch(
            f"{self.QUESTIONS}{question.pk}/", {"text_en": "Edited?"}, format="json"
        )
        assert response.status_code == 200
        response = api.delete(f"{self.QUESTIONS}{question.pk}/")
        assert response.status_code == 409 and code(response) == "in_use"

    @pytest.mark.parametrize("state", ["published", "unpublished", "archived"])
    def test_published_exam_questions_are_locked(self, api, subject, state):
        exam = make_exam(subject, publish=True)
        if state != "published":
            services.unpublish_exam(exam.pk, ctx=CTX)
        if state == "archived":
            services.archive_exam(exam.pk, ctx=CTX)
        question = exam.exam_questions.first().question
        url = f"{self.QUESTIONS}{question.pk}/"
        before = Question.objects.values().get(pk=question.pk)
        options_before = list(question.options.values())
        for change in (
            {"text_en": "Changed?"},
            {"explanation_bn": "নতুন"},
            {"subject": make_subject(f"other-{state}").pk},
            {
                "options": [
                    {"text_bn": f"ক{i}", "text_en": f"A{i}", "is_correct": i == 1} for i in range(4)
                ]
            },
        ):
            response = api.patch(url, change, format="json")
            assert response.status_code == 409 and code(response) == "question_locked", change
        from django.core.files.uploadedfile import SimpleUploadedFile

        from tests.test_questions import png

        image = api.post(f"{url}image/", {"image": SimpleUploadedFile("a.png", png())})
        assert image.status_code == 409
        assert api.delete(url).status_code == 409
        after = Question.objects.values().get(pk=question.pk)
        assert {k: v for k, v in after.items() if k != "updated_at"} == {
            k: v for k, v in before.items() if k != "updated_at"
        }
        assert list(question.options.values()) == options_before
        # difficulty stays editable; deactivating is refused only while published.
        assert api.patch(url, {"difficulty": "hard"}, format="json").status_code == 200
        deactivate = api.patch(url, {"is_active": False}, format="json")
        assert deactivate.status_code == (409 if state == "published" else 200)

    def test_unassigned_question_unaffected(self, api, subject):
        make_exam(subject, publish=True)
        free = make_question(subject)
        assert (
            api.patch(
                f"{self.QUESTIONS}{free.pk}/", {"text_en": "Fine?"}, format="json"
            ).status_code
            == 200
        )
        assert api.delete(f"{self.QUESTIONS}{free.pk}/").status_code == 204

    def test_subject_with_exam_questions_still_protected(self, api, subject):
        make_exam(subject, publish=True)
        assert api.delete(f"/api/v1/admin/subjects/{subject.pk}/").status_code == 409


# ======================================================================================
# Duplicate
# ======================================================================================
class TestDuplicate:
    def test_duplicate_creates_a_draft_copy(self, api, subject, admin_user):
        start = timezone.now() + timedelta(days=1)
        exam = make_exam(
            subject, start_at=start, end_at=start + timedelta(hours=1), is_featured=True
        )
        services.set_exam_questions(
            exam.pk,
            [
                {
                    "question": item.question_id,
                    "sort_order": item.sort_order * 10,
                    "marks": Decimal("2"),
                }
                for item in exam.exam_questions.all()
            ],
            ctx=CTX,
        )
        services.publish_exam(exam.pk, ctx=CTX)
        response = api.post(f"{EXAMS}{exam.pk}/duplicate/")
        assert response.status_code == 201, response.content
        copy = response.json()
        assert copy["id"] != exam.pk and copy["public_id"] != str(exam.public_id)
        assert copy["status"] == "draft" and copy["slug"] == f"{exam.slug}-copy"
        assert copy["start_at"] is None and copy["end_at"] is None
        assert copy["title_en"] == exam.title_en and copy["is_featured"] is False  # reset
        assert copy["created_by"] == admin_user.pk and copy["total_marks"] == "6.00"
        original = list(exam.exam_questions.values_list("question_id", "sort_order", "marks"))
        copied = list(
            ExamQuestion.objects.filter(exam_id=copy["id"]).values_list(
                "question_id", "sort_order", "marks"
            )
        )
        assert copied == original
        assert AuditLog.objects.filter(entity_id=str(copy["id"])).count() == 1
        log = AuditLog.objects.get(action="exam.duplicate")
        assert log.metadata["values"]["source_exam_id"] == exam.pk
        assert api.post(f"{EXAMS}{exam.pk}/duplicate/").json()["slug"] == f"{exam.slug}-copy-2"
        exam.refresh_from_db()
        assert exam.status == ExamStatus.PUBLISHED  # source untouched

    def test_copy_is_independent(self, api, subject):
        exam = make_exam(subject, publish=True)
        copy_id = api.post(f"{EXAMS}{exam.pk}/duplicate/").json()["id"]
        assert (
            api.patch(f"{EXAMS}{copy_id}/questions/", {"questions": []}, format="json").status_code
            == 200
        )
        assert exam.exam_questions.count() == 3


# ======================================================================================
# Public endpoints
# ======================================================================================
class TestPublic:
    PUBLIC_FIELDS = {
        "slug",
        "title",
        "description",
        "instructions",
        "exam_type",
        "access_type",
        "content_language",
        "category",
        "subject",
        "duration_minutes",
        "total_questions",
        "total_marks",
        "negative_marks",
        "pass_marks",
        "start_at",
        "end_at",
        "is_featured",
    }

    @pytest.fixture
    def exams(self, subject):
        published = make_exam(
            subject,
            title_en="Public Physics",
            title_bn="প্রকাশিত পদার্থ",
            description_en="About",
            subject=subject,
            publish=True,
        )
        unpublished = make_exam(subject, title_en="Unpublished", slug="unpublished", publish=True)
        services.unpublish_exam(unpublished.pk, ctx=CTX)
        archived = make_exam(subject, title_en="Archived", slug="archived")
        services.archive_exam(archived.pk, ctx=CTX)
        return {
            "published": published,
            "draft": make_exam(subject, title_en="Draft Exam", slug="draft-exam"),
            "unpublished": unpublished,
            "archived": archived,
        }

    def test_only_published_exams_are_visible(self, exams):
        client = APIClient()
        response = client.get(PUBLIC)
        assert response.status_code == 200
        assert [row["slug"] for row in response.json()["results"]] == [exams["published"].slug]
        for name in ("draft", "unpublished", "archived"):
            assert client.get(f"{PUBLIC}{exams[name].slug}/").status_code == 404, name
        assert client.get(f"{PUBLIC}{exams['published'].slug}/").status_code == 200

    def test_response_has_no_answers_or_internal_fields(self, exams):
        client = APIClient()
        detail = client.get(f"{PUBLIC}{exams['published'].slug}/", HTTP_ACCEPT_LANGUAGE="en").json()
        assert set(detail) == self.PUBLIC_FIELDS
        assert detail["total_questions"] == 3 and detail["total_marks"] == "3.00"
        assert detail["category"] == {"slug": "science", "name": "Science"}
        assert detail["subject"] == {"slug": "physics", "name": "Physics"}
        dumped = json.dumps(client.get(PUBLIC).json()) + json.dumps(detail)
        for secret in (
            "is_correct",
            "explanation",
            "options",
            "created_by",
            "public_id",
            "Option 0",
            "Question text",
            '"id"',
            "status",
        ):
            assert secret not in dumped, secret

    def test_language_resolution_and_fallback(self, exams):
        client = APIClient()
        url = f"{PUBLIC}{exams['published'].slug}/"
        bn = client.get(url, HTTP_ACCEPT_LANGUAGE="bn").json()
        en = client.get(url + "?lang=en").json()
        assert bn["title"] == "প্রকাশিত পদার্থ" and en["title"] == "Public Physics"
        assert bn["description"] == "About"  # no Bangla description → English fallback

    def test_inactive_category_hides_exams(self, exams, subject):
        Category.objects.filter(pk=subject.category_id).update(is_active=False)
        assert APIClient().get(PUBLIC).json()["count"] == 0

    def test_filters_and_ordering(self, subject):
        maths = make_subject("algebra", category=make_category("maths"))
        soon = timezone.now() + timedelta(days=1)
        later = timezone.now() + timedelta(days=5)
        a = make_exam(subject, title_en="Anytime", publish=True)
        b = make_exam(
            maths,
            title_en="Later",
            start_at=later,
            end_at=later + timedelta(hours=1),
            access_type="paid",
            publish=True,
        )
        c = make_exam(
            subject,
            title_en="Soon",
            exam_type="live",
            start_at=soon,
            end_at=soon + timedelta(hours=1),
            publish=True,
        )

        def slugs(query=""):
            response = APIClient().get(PUBLIC + query)
            assert response.status_code == 200, response.content
            return [row["slug"] for row in response.json()["results"]]

        assert slugs() == [c.slug, b.slug, a.slug]  # by start time, unscheduled last
        assert slugs("?type=live") == [c.slug]
        assert slugs("?access=paid") == [b.slug]
        assert slugs("?category=maths") == [b.slug]
        assert slugs("?upcoming=true") == [c.slug, b.slug]
        assert slugs("?when=upcoming") == [c.slug, b.slug]
        assert slugs("?when=open") == [a.slug]
        assert slugs("?when=ended") == []
        assert APIClient().get(PUBLIC + "?when=soon").status_code == 400

    def test_when_open_and_ended(self, subject):
        now = timezone.now()
        open_now = make_exam(subject, title_en="Open", publish=True)
        Exam.objects.filter(pk=open_now.pk).update(
            start_at=now - timedelta(hours=1), end_at=now + timedelta(hours=1)
        )
        old = make_exam(subject, title_en="Old", publish=True)
        Exam.objects.filter(pk=old.pk).update(
            start_at=now - timedelta(days=3), end_at=now - timedelta(days=2)
        )
        recent = make_exam(subject, title_en="Recent", publish=True)
        Exam.objects.filter(pk=recent.pk).update(
            start_at=now - timedelta(hours=3), end_at=now - timedelta(hours=2)
        )

        def slugs(query):
            return [row["slug"] for row in APIClient().get(PUBLIC + query).json()["results"]]

        assert slugs("?when=open") == [open_now.slug]
        assert slugs("?when=ended") == [recent.slug, old.slug]  # most recently ended first
        assert APIClient().get(PUBLIC + "?type=marathon").status_code == 400

    def test_public_ignores_credentials(self, exams):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION="Bearer not-a-token")
        assert client.get(PUBLIC).status_code == 200

    def test_public_categories(self):
        science = make_category("science", name_bn="বিজ্ঞান", sort_order=2)
        maths = make_category("maths", sort_order=1)
        make_category("hidden", is_active=False)
        make_subject("physics", category=science, sort_order=2)
        make_subject("chemistry", category=science, sort_order=1)
        make_subject("biology", category=science, is_active=False)
        make_subject("algebra", category=maths)
        chemistry = science.subjects.get(slug="chemistry")
        physics = science.subjects.get(slug="physics")
        make_exam(chemistry, title_en="Counted", publish=True)
        make_exam(chemistry, title_en="Draft, not counted")
        physics.__class__.objects.filter(pk=physics.pk).update(is_active=False)
        response = APIClient().get("/api/v1/public/categories/", HTTP_ACCEPT_LANGUAGE="bn")
        assert response.status_code == 200
        rows = response.json()["results"]
        assert [r["slug"] for r in rows] == ["maths", "science"]
        assert set(rows[1]) == {"slug", "name", "description", "subjects", "exam_count"}
        # The same visibility rule as the public exam list.
        assert [r["exam_count"] for r in rows] == [0, 1]
        listed = APIClient().get(PUBLIC + "?category=science").json()["count"]
        assert listed == 1
        assert rows[1]["name"] == "বিজ্ঞান"
        assert [s["slug"] for s in rows[1]["subjects"]] == ["chemistry"]
        assert set(rows[1]["subjects"][0]) == {"slug", "name", "description"}
        assert "is_active" not in json.dumps(rows) and '"id"' not in json.dumps(rows)


# ======================================================================================
# Audit safety
# ======================================================================================
class TestAudit:
    def test_no_content_in_audit(self, api, subject):
        body = api_payload(
            subject,
            title_en="Secret Title Words",
            description_en="Confidential description",
            instructions_bn="গোপন নির্দেশনা",
        )
        exam_id = api.post(EXAMS, body, format="json").json()["id"]
        q = [make_question(subject) for _ in range(3)]
        api.patch(
            f"{EXAMS}{exam_id}/questions/",
            {"questions": [{"question": x.pk} for x in q]},
            format="json",
        )
        api.patch(f"{EXAMS}{exam_id}/", {"description_en": "Changed confidential"}, format="json")
        api.post(f"{EXAMS}{exam_id}/publish/")
        api.post(f"{EXAMS}{exam_id}/duplicate/")
        dumped = json.dumps(
            list(AuditLog.objects.filter(action__startswith="exam.").values("summary", "metadata")),
            ensure_ascii=False,
        )
        for secret in ("Secret Title", "Confidential", "গোপন", "Question text", "Option 0"):
            assert secret not in dumped
        assert AuditLog.objects.filter(action="exam.update").get().metadata["changed_fields"] == [
            "description_en"
        ]

    def test_audit_failure_rolls_back(self, subject, monkeypatch):
        exam = make_exam(subject)

        def broken(*args, **kwargs):
            raise DatabaseError("audit down")

        monkeypatch.setattr(services.audit, "record", broken)
        with pytest.raises(DatabaseError), transaction.atomic():
            services.publish_exam(exam.pk, ctx=CTX)
        exam.refresh_from_db()
        assert exam.status == ExamStatus.DRAFT
        with pytest.raises(DatabaseError), transaction.atomic():
            services.set_exam_questions(exam.pk, [], ctx=CTX)
        assert exam.exam_questions.count() == 3


# ======================================================================================
# Concurrency
# ======================================================================================
def _run_concurrently(*funcs):
    barrier = threading.Barrier(len(funcs))
    results = [None] * len(funcs)

    def runner(index, func):
        try:
            barrier.wait()
            results[index] = func()
        except Exception as exc:  # noqa: BLE001 — asserted by the tests
            results[index] = exc
        finally:
            connection.close()

    threads = [threading.Thread(target=runner, args=(i, f)) for i, f in enumerate(funcs)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    return results


def _fresh_subject(tag):
    return make_subject(f"s-{tag}", category=make_category(f"c-{tag}"))


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_concurrent_publish_publishes_once(run):
    exam = make_exam(_fresh_subject(f"p{run}"))
    results = _run_concurrently(*[lambda: services.publish_exam(exam.pk, ctx=CTX)] * 3)
    assert sum(isinstance(r, Exam) for r in results) == 1
    assert all(isinstance(r, ExamStateError) for r in results if not isinstance(r, Exam))
    assert AuditLog.objects.filter(action="exam.publish").count() == 1


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_publish_racing_question_list_change_stays_valid(run):
    subject = _fresh_subject(f"l{run}")
    exam = make_exam(subject)
    publish, replace = _run_concurrently(
        lambda: services.publish_exam(exam.pk, ctx=CTX),
        lambda: services.set_exam_questions(exam.pk, [], ctx=CTX),
    )
    exam.refresh_from_db()
    if exam.status == ExamStatus.PUBLISHED:
        assert isinstance(replace, ExamStateError) and exam.exam_questions.count() == 3
    else:
        assert isinstance(publish, ValidationError) and exam.exam_questions.count() == 0
    if exam.status == ExamStatus.PUBLISHED:
        assert publish_problems(exam.pk) == {}


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_publish_racing_exam_update_stays_valid(run):
    exam = make_exam(_fresh_subject(f"u{run}"))
    publish, update = _run_concurrently(
        lambda: services.publish_exam(exam.pk, ctx=CTX),
        lambda: services.update_exam(exam.pk, {"total_questions": 7}, ctx=CTX),
    )
    exam.refresh_from_db()
    if exam.status == ExamStatus.PUBLISHED:
        assert isinstance(update, ExamStateError) and exam.total_questions == 3
        assert publish_problems(exam.pk) == {}
    else:
        assert isinstance(publish, ValidationError) and exam.total_questions == 7


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_publish_racing_question_edit_stays_valid(run):
    subject = _fresh_subject(f"q{run}")
    exam = make_exam(subject)
    question = exam.exam_questions.first().question
    english_only = [{"text_en": f"E{i}", "is_correct": i == 0} for i in range(4)]
    publish, edit = _run_concurrently(
        lambda: services.publish_exam(exam.pk, ctx=CTX),
        lambda: question_services.update_question(
            question.pk, {"text_bn": ""}, english_only, ctx=CTX
        ),
    )
    exam.refresh_from_db()
    question.refresh_from_db()
    if exam.status == ExamStatus.PUBLISHED:
        assert isinstance(edit, QuestionLocked) and question.available_languages == "both"
        assert publish_problems(exam.pk) == {}
    else:
        assert isinstance(edit, Question) and isinstance(publish, ValidationError)


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_concurrent_question_list_replacements(run):
    subject = _fresh_subject(f"r{run}")
    exam = make_exam(subject, questions=[])
    sets = [[make_question(subject) for _ in range(2)] for _ in range(3)]
    results = _run_concurrently(
        *[
            (
                lambda s=s: services.set_exam_questions(
                    exam.pk, [{"question": q.pk} for q in s], ctx=CTX
                )
            )
            for s in sets
        ]
    )
    assert all(isinstance(r, Exam) for r in results), results
    final = set(exam.exam_questions.values_list("question_id", flat=True))
    assert final in [{q.pk for q in s} for s in sets]


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_delete_racing_publish(run):
    exam = make_exam(_fresh_subject(f"d{run}"))
    deleted, published = _run_concurrently(
        lambda: services.delete_exam(exam.pk, ctx=CTX),
        lambda: services.publish_exam(exam.pk, ctx=CTX),
    )
    if Exam.objects.filter(pk=exam.pk).exists():
        assert isinstance(deleted, ExamStateError) and isinstance(published, Exam)
    else:
        assert deleted is None and published.__class__.__name__ == "Http404"


@pytest.mark.django_db(transaction=True)
def test_concurrent_duplicates_get_distinct_slugs():
    exam = make_exam(_fresh_subject("dup"), publish=True)
    results = _run_concurrently(*[lambda: services.duplicate_exam(exam.pk, ctx=CTX)] * 3)
    assert all(isinstance(r, Exam) for r in results), results
    slugs = sorted(r.slug for r in results)
    assert slugs == sorted({f"{exam.slug}-copy", f"{exam.slug}-copy-2", f"{exam.slug}-copy-3"})
    assert all(ExamQuestion.objects.filter(exam=r).count() == 3 for r in results)


@pytest.mark.django_db(transaction=True)
def test_question_delete_racing_assignment():
    subject = _fresh_subject("qa")
    exam = make_exam(subject, questions=[])
    question = make_question(subject)
    assigned, deleted = _run_concurrently(
        lambda: services.set_exam_questions(exam.pk, [{"question": question.pk}], ctx=CTX),
        lambda: question_services.delete_question(question.pk, ctx=CTX),
    )
    if Question.objects.filter(pk=question.pk).exists():
        assert isinstance(deleted, QuestionInUse) and exam.exam_questions.count() == 1
    else:
        assert isinstance(assigned, ValidationError) and exam.exam_questions.count() == 0


# ======================================================================================
# Internal Django admin
# ======================================================================================
class TestDjangoAdmin:
    @pytest.fixture
    def ops(self, client):
        client.force_login(User.objects.create_superuser("01512345678", PW, full_name="Root"))
        return client

    def test_read_only_pages_and_service_actions(self, ops, subject):
        exam = make_exam(subject)
        for url in ("/django-admin/exams/exam/", f"/django-admin/exams/exam/{exam.pk}/change/"):
            assert ops.get(url).status_code == 200
        assert ops.get("/django-admin/exams/exam/add/").status_code == 403
        ops.post(f"/django-admin/exams/exam/{exam.pk}/change/", {"duration_minutes": "99"})
        exam.refresh_from_db()
        assert exam.duration_minutes == 30
        changelist = "/django-admin/exams/exam/"
        ops.post(changelist, {"action": "publish", "_selected_action": [exam.pk]})
        exam.refresh_from_db()
        assert exam.status == ExamStatus.PUBLISHED
        assert AuditLog.objects.filter(action="exam.publish").count() == 1
        ops.post(
            changelist, {"action": "delete_selected", "_selected_action": [exam.pk], "post": "yes"}
        )
        assert Exam.objects.filter(pk=exam.pk).exists()  # published: not deletable

    def test_invalid_publish_via_admin_changes_nothing(self, ops, subject):
        exam = make_exam(subject, questions=[])
        ops.post("/django-admin/exams/exam/", {"action": "publish", "_selected_action": [exam.pk]})
        exam.refresh_from_db()
        assert exam.status == ExamStatus.DRAFT
        assert not AuditLog.objects.filter(action="exam.publish").exists()

    def test_view_only_staff_cannot_act(self, client, subject):
        from django.contrib.auth.models import Permission

        exam = make_exam(subject)
        staff = User.objects.create_user("01912345678", password=PW, full_name="V", is_staff=True)
        staff.user_permissions.add(Permission.objects.get(codename="view_exam"))
        client.force_login(staff)
        client.post(
            "/django-admin/exams/exam/", {"action": "publish", "_selected_action": [exam.pk]}
        )
        exam.refresh_from_db()
        assert exam.status == ExamStatus.DRAFT


# ======================================================================================
# Final review: state machine, deactivation, schedule edges, marks, normalization,
# public leak surface, lock hook, ExamQuestion integrity, audit, Django admin
# ======================================================================================
class TestStateMachine:
    @pytest.mark.parametrize(
        "steps, action, expected_code",
        [
            (["publish"], "publish", "already_published"),
            (["publish", "unpublish"], "unpublish", "not_published"),
            ([], "unpublish", "not_published"),
            (["archive"], "archive", "not_archivable"),
            (["archive"], "publish", "invalid_status"),
            (["publish"], "archive", "not_archivable"),
            (["archive"], "unpublish", "not_published"),
        ],
    )
    def test_invalid_transitions_are_409_and_not_audited(
        self, api, subject, steps, action, expected_code
    ):
        exam = make_exam(subject)
        for step in steps:
            assert api.post(f"{EXAMS}{exam.pk}/{step}/").status_code == 200
        audit_before = AuditLog.objects.count()
        status_before = Exam.objects.get(pk=exam.pk).status
        response = api.post(f"{EXAMS}{exam.pk}/{action}/")
        assert response.status_code == 409 and code(response) == expected_code
        assert AuditLog.objects.count() == audit_before
        assert Exam.objects.get(pk=exam.pk).status == status_before

    def test_publish_after_unpublish(self, api, subject):
        exam = make_exam(subject, publish=True)
        api.post(f"{EXAMS}{exam.pk}/unpublish/")
        assert api.post(f"{EXAMS}{exam.pk}/publish/").json()["status"] == "published"

    def test_status_cannot_be_set_by_patch_or_create(self, api, subject):
        exam = make_exam(subject)
        for value in ("published", "archived", "unpublished"):
            api.patch(f"{EXAMS}{exam.pk}/", {"status": value}, format="json")
            assert Exam.objects.get(pk=exam.pk).status == "draft"
        services.update_exam(exam.pk, {"status": "published"}, ctx=CTX)  # not an editable field
        assert Exam.objects.get(pk=exam.pk).status == "draft"
        assert not AuditLog.objects.filter(action="exam.update").exists()


class TestQuestionDeactivation:
    QUESTIONS = "/api/v1/admin/questions/"

    def test_cannot_deactivate_while_published_but_can_when_unpublished(self, api, subject):
        exam = make_exam(subject, publish=True)
        question = exam.exam_questions.first().question
        response = api.patch(f"{self.QUESTIONS}{question.pk}/", {"is_active": False}, format="json")
        assert response.status_code == 409 and code(response) == "question_locked"
        assert Question.objects.get(pk=question.pk).is_active
        services.unpublish_exam(exam.pk, ctx=CTX)
        ok = api.patch(f"{self.QUESTIONS}{question.pk}/", {"is_active": False}, format="json")
        assert ok.status_code == 200
        # A deactivated question then blocks re-publishing until it is reactivated.
        assert "questions" in errors(api.post(f"{EXAMS}{exam.pk}/publish/"))
        api.patch(f"{self.QUESTIONS}{question.pk}/", {"is_active": True}, format="json")
        assert api.post(f"{EXAMS}{exam.pk}/publish/").status_code == 200

    def test_draft_exam_does_not_block_deactivation(self, api, subject):
        exam = make_exam(subject)
        question = exam.exam_questions.first().question
        assert (
            api.patch(
                f"{self.QUESTIONS}{question.pk}/", {"is_active": False}, format="json"
            ).status_code
            == 200
        )

    def test_django_admin_deactivate_reports_the_lock(self, client, subject):
        exam = make_exam(subject, publish=True)
        question = exam.exam_questions.first().question
        client.force_login(User.objects.create_superuser("01512345678", PW, full_name="Root"))
        response = client.post(
            "/django-admin/questions/question/",
            {"action": "deactivate", "_selected_action": [question.pk]},
            follow=True,
        )
        assert response.status_code == 200
        assert Question.objects.get(pk=question.pk).is_active

    @pytest.mark.django_db(transaction=True)
    def test_publish_racing_deactivation_never_leaves_inactive_question(self):
        subject = _fresh_subject("deact")
        exam = make_exam(subject)
        question = exam.exam_questions.first().question
        published, deactivated = _run_concurrently(
            lambda: services.publish_exam(exam.pk, ctx=CTX),
            lambda: question_services.update_question(
                question.pk, {"is_active": False}, None, ctx=CTX
            ),
        )
        exam.refresh_from_db()
        question.refresh_from_db()
        if exam.status == ExamStatus.PUBLISHED:
            assert question.is_active and isinstance(deactivated, QuestionLocked)
        else:
            assert not question.is_active and isinstance(published, ValidationError)


class TestTotalQuestionsTarget:
    def test_target_may_differ_while_editable_but_not_at_publish(self, api, subject):
        exam = make_exam(subject, total_questions=4)  # 3 assigned
        assert "questions" in errors(api.post(f"{EXAMS}{exam.pk}/publish/"))
        api.patch(f"{EXAMS}{exam.pk}/", {"total_questions": 3}, format="json")
        assert api.post(f"{EXAMS}{exam.pk}/publish/").status_code == 200
        locked = api.patch(f"{EXAMS}{exam.pk}/", {"total_questions": 4}, format="json")
        assert locked.status_code == 409 and Exam.objects.get(pk=exam.pk).total_questions == 3

    def test_duplicate_keeps_target(self, api, subject):
        exam = make_exam(subject, total_questions=5)
        copy = api.post(f"{EXAMS}{exam.pk}/duplicate/").json()
        assert copy["total_questions"] == 5 and copy["question_count"] == 3


class TestScheduleEdges:
    def post(self, api, subject, **extra):
        return api.post(EXAMS, api_payload(subject, **extra), format="json")

    def test_naive_datetimes_are_rejected(self, api, subject):
        response = self.post(
            api, subject, start_at="2030-01-01T10:00:00", end_at="2030-01-01T12:00:00Z"
        )
        assert response.status_code == 400 and "start_at" in errors(response)
        ok = self.post(
            api, subject, start_at="2030-01-01T10:00:00+06:00", end_at="2030-01-01T12:00:00+06:00"
        )
        assert (
            ok.status_code == 201 and ok.json()["start_at"] == "2030-01-01T04:00:00Z"
        )  # stored UTC

    def test_end_equal_to_start_rejected(self, api, subject):
        when = "2030-01-01T10:00:00Z"
        assert "end_at" in errors(self.post(api, subject, start_at=when, end_at=when))

    def test_duration_exactly_equal_to_window_is_allowed(self, api, subject):
        response = self.post(
            api,
            subject,
            duration_minutes=30,
            start_at="2030-01-01T10:00:00Z",
            end_at="2030-01-01T10:30:00Z",
        )
        assert response.status_code == 201
        short = self.post(
            api,
            subject,
            duration_minutes=30,
            start_at="2030-01-01T10:00:00Z",
            end_at="2030-01-01T10:29:59.999999Z",
        )
        assert "end_at" in errors(short)

    def test_partial_schedules_for_regular_and_practice(self, api, subject):
        assert self.post(api, subject, start_at="2030-01-01T10:00:00Z").status_code == 201
        assert (
            self.post(api, subject, exam_type="practice", end_at="2030-01-01T10:00:00Z").status_code
            == 201
        )

    def test_live_needs_both_times_at_publish(self, subject, api):
        exam = make_exam(subject, exam_type="live", start_at=timezone.now() + timedelta(hours=1))
        assert "start_at" in errors(api.post(f"{EXAMS}{exam.pk}/publish/"))

    def test_end_exactly_now_cannot_publish(self, api, subject):
        start = timezone.now() - timedelta(hours=2)
        end = timezone.now() + timedelta(hours=1)
        exam = make_exam(subject, start_at=start, end_at=end)
        with mock.patch("apps.exams.services.timezone.now", return_value=end):
            assert "end_at" in errors(api.post(f"{EXAMS}{exam.pk}/publish/"))
        with mock.patch(
            "apps.exams.services.timezone.now", return_value=end - timedelta(microseconds=1)
        ):
            assert api.post(f"{EXAMS}{exam.pk}/publish/").status_code == 200

    def test_published_schedule_cannot_be_edited(self, api, subject):
        exam = make_exam(subject, publish=True)
        response = api.patch(
            f"{EXAMS}{exam.pk}/", {"end_at": "2031-01-01T00:00:00Z"}, format="json"
        )
        assert response.status_code == 409


class TestMarks:
    def test_total_marks_mix_overrides_and_default(self, api, subject):
        exam = make_exam(subject, default_marks=Decimal("1.25"))
        items = list(exam.exam_questions.order_by("sort_order"))
        services.set_exam_questions(
            exam.pk,
            [
                {"question": items[0].question_id, "sort_order": 0, "marks": Decimal("2.50")},
                {"question": items[1].question_id, "sort_order": 1},
                {"question": items[2].question_id, "sort_order": 2, "marks": Decimal("0.75")},
            ],
            ctx=CTX,
        )
        body = api.get(f"{EXAMS}{exam.pk}/").json()
        assert body["total_marks"] == "4.50"  # 2.50 + 1.25 + 0.75
        api.patch(f"{EXAMS}{exam.pk}/", {"pass_marks": "4.51"}, format="json")
        assert "pass_marks" in errors(api.post(f"{EXAMS}{exam.pk}/publish/"))
        api.patch(f"{EXAMS}{exam.pk}/", {"pass_marks": "4.50"}, format="json")
        assert api.post(f"{EXAMS}{exam.pk}/publish/").status_code == 200
        public = APIClient().get(f"{PUBLIC}{exam.slug}/").json()
        assert public["total_marks"] == "4.50" and public["pass_marks"] == "4.50"

    @pytest.mark.parametrize(
        "field, value",
        [
            ("default_marks", "0"),
            ("default_marks", "1.234"),
            ("negative_marks", "-0.01"),
            ("pass_marks", "-1"),
            ("default_marks", "100000.00"),
        ],
    )
    def test_invalid_marks(self, api, subject, field, value):
        response = api.post(EXAMS, api_payload(subject, **{field: value}), format="json")
        assert response.status_code == 400 and field in errors(response)

    def test_zero_negative_and_pass_marks_allowed(self, api, subject):
        response = api.post(
            EXAMS, api_payload(subject, negative_marks="0", pass_marks="0"), format="json"
        )
        assert response.status_code == 201


class TestNormalizationOnTypeChange:
    def test_regular_to_live_resets_retake_and_merit(self, api, subject):
        exam_id = api.post(
            EXAMS,
            api_payload(subject, allow_retake=True, max_attempts=3, merit_strategy="best_attempt"),
            format="json",
        ).json()["id"]
        body = api.patch(f"{EXAMS}{exam_id}/", {"exam_type": "live"}, format="json").json()
        assert (body["allow_retake"], body["max_attempts"], body["merit_strategy"]) == (
            False,
            1,
            "first_attempt",
        )
        log = AuditLog.objects.get(action="exam.update")
        assert log.metadata["changes"]["max_attempts"] == {"from": 3, "to": 1}

    def test_live_cannot_be_given_retakes(self, api, subject):
        exam_id = api.post(EXAMS, api_payload(subject, exam_type="live"), format="json").json()[
            "id"
        ]
        body = api.patch(
            f"{EXAMS}{exam_id}/", {"allow_retake": True, "max_attempts": 5}, format="json"
        ).json()
        assert (body["allow_retake"], body["max_attempts"]) == (False, 1)

    def test_practice_unlimited_is_null(self, api, subject):
        body = api.post(EXAMS, api_payload(subject, exam_type="practice"), format="json").json()
        assert body["max_attempts"] is None and body["allow_retake"] is True


class TestPublicLeakSurface:
    FORBIDDEN_KEYS = {
        "id",
        "public_id",
        "question",
        "questions",
        "options",
        "is_correct",
        "explanation_bn",
        "explanation_en",
        "created_by",
        "created_at",
        "updated_at",
        "status",
        "allow_retake",
        "max_attempts",
        "merit_strategy",
        "merit_enabled",
        "result_visibility",
        "allow_answer_review",
        "shuffle_questions",
        "shuffle_options",
        "title_bn",
        "title_en",
    }

    def keys(self, value):
        if isinstance(value, dict):
            return set(value) | set().union(*(self.keys(v) for v in value.values()))
        if isinstance(value, list):
            return set().union(set(), *(self.keys(v) for v in value))
        return set()

    def test_no_internal_keys_anywhere(self, subject):
        exam = make_exam(subject, publish=True, subject=subject)
        for url in (PUBLIC, f"{PUBLIC}{exam.slug}/", "/api/v1/public/categories/"):
            assert not self.keys(APIClient().get(url).json()) & self.FORBIDDEN_KEYS, url
        dumped = json.dumps(APIClient().get(f"{PUBLIC}{exam.slug}/").json())
        for item in exam.exam_questions.all():
            assert f'"{item.question_id}"' not in dumped

    def test_drafts_cannot_be_enumerated(self, subject):
        draft = make_exam(subject, title_en="Hidden Draft", slug="hidden-draft")
        client = APIClient()
        assert client.get(f"{PUBLIC}hidden-draft/").status_code == 404
        assert client.get(f"{PUBLIC}{draft.pk}/").status_code == 404
        assert client.get(f"{PUBLIC}{draft.public_id}/").status_code == 404
        assert client.get(PUBLIC + "?category=science").json()["count"] == 0

    def test_malformed_credentials_do_not_change_public_behaviour(self, subject):
        exam = make_exam(subject, publish=True)
        baseline = APIClient().get(f"{PUBLIC}{exam.slug}/").json()
        client = APIClient()
        client.cookies["sessionid"] = "garbage"
        client.cookies["csrftoken"] = "x"
        for header in ("Bearer ", "Bearer a.b.c", "Basic Zm9vOmJhcg==", "garbage"):
            response = client.get(f"{PUBLIC}{exam.slug}/", HTTP_AUTHORIZATION=header)
            assert response.status_code == 200 and response.json() == baseline

    @pytest.mark.parametrize(
        "query", ["?type=x", "?access=vip", "?upcoming=maybe", "?category=" + "a" * 141]
    )
    def test_invalid_public_filters(self, query):
        assert APIClient().get(PUBLIC + query).status_code == 400

    def test_page_size_is_capped(self, subject):
        for i in range(3):
            make_exam(
                subject,
                title_en=f"E{i}",
                publish=True,
                questions=[make_question(subject) for _ in range(3)],
            )
        response = APIClient().get(PUBLIC + "?page_size=100000")
        assert response.status_code == 200 and len(response.json()["results"]) <= 100

    def test_public_categories_fallback_and_hidden_subjects(self):
        bn_only = make_category("bn-only", name_en="", name_bn="শুধু বাংলা")
        make_subject("hidden", category=bn_only, is_active=False)
        rows = (
            APIClient()
            .get("/api/v1/public/categories/", HTTP_ACCEPT_LANGUAGE="en")
            .json()["results"]
        )
        assert rows[0]["name"] == "শুধু বাংলা" and rows[0]["subjects"] == []


class TestLockHook:
    def test_questions_module_does_not_import_exams(self):
        import ast
        import pathlib

        root = pathlib.Path(__file__).resolve().parent.parent / "apps" / "questions"
        for path in root.rglob("*.py"):
            tree = ast.parse(path.read_text())
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom) and node.module:
                    assert "exams" not in node.module, path
                if isinstance(node, ast.Import):
                    assert all("exams" not in alias.name for alias in node.names), path

    def test_locks_are_registered_at_startup(self):
        from apps.questions.locks import CONTENT, DEACTIVATE, has_checks

        assert has_checks(CONTENT) and has_checks(DEACTIVATE)

    def test_system_check_fails_if_lock_is_missing(self):
        from apps.questions import locks
        from apps.questions.checks import question_locks_registered

        assert question_locks_registered() == []
        with mock.patch.dict(locks._checks, {locks.CONTENT: []}):
            errors_found = question_locks_registered()
        assert [e.id for e in errors_found] == ["questions.E001"]
        assert "exams.ExamQuestion.question" in errors_found[0].hint


class TestExamQuestionIntegrity:
    def test_question_delete_is_protected_at_orm_level(self, subject):
        from django.db.models import ProtectedError

        exam = make_exam(subject)
        question = exam.exam_questions.first().question
        with pytest.raises(ProtectedError):
            question.delete()
        assert ExamQuestion.objects.filter(question=question).exists()

    def test_exam_delete_never_deletes_questions(self, subject):
        exam = make_exam(subject)
        ids = set(exam.exam_questions.values_list("question_id", flat=True))
        services.delete_exam(exam.pk, ctx=CTX)
        assert set(Question.objects.filter(pk__in=ids).values_list("pk", flat=True)) == ids
        assert not ExamQuestion.objects.exists()


class TestAuditCompleteness:
    def test_each_action_writes_exactly_one_event(self, api, subject):
        q = [make_question(subject) for _ in range(3)]
        start_count = AuditLog.objects.count()

        def delta(action):
            return AuditLog.objects.filter(action=action).count()

        exam_id = api.post(EXAMS, api_payload(subject), format="json").json()["id"]
        api.patch(f"{EXAMS}{exam_id}/", {"duration_minutes": 40}, format="json")
        api.patch(
            f"{EXAMS}{exam_id}/questions/",
            {"questions": [{"question": x.pk} for x in q]},
            format="json",
        )
        api.post(f"{EXAMS}{exam_id}/publish/")
        copy_id = api.post(f"{EXAMS}{exam_id}/duplicate/").json()["id"]
        api.post(f"{EXAMS}{exam_id}/unpublish/")
        api.post(f"{EXAMS}{exam_id}/archive/")
        api.delete(f"{EXAMS}{copy_id}/")
        for action in (
            "exam.create",
            "exam.update",
            "exam.questions_update",
            "exam.publish",
            "exam.duplicate",
            "exam.unpublish",
            "exam.archive",
            "exam.delete",
        ):
            assert delta(action) == 1, action
        assert AuditLog.objects.count() - start_count == 8
        dumped = json.dumps(list(AuditLog.objects.values("metadata", "summary")), default=str)
        assert "2030" not in dumped and "T0" not in dumped  # no timestamps in metadata

    def test_failed_publish_validation_writes_nothing(self, api, subject):
        exam = make_exam(subject, questions=[])
        before = AuditLog.objects.count()
        api.post(f"{EXAMS}{exam.pk}/publish/")
        api.patch(f"{EXAMS}{exam.pk}/", {"duration_minutes": 0}, format="json")
        api.patch(
            f"{EXAMS}{exam.pk}/questions/", {"questions": [{"question": 999999}]}, format="json"
        )
        assert AuditLog.objects.count() == before


class TestDjangoAdminActions:
    def test_unpublish_and_archive_actions(self, client, subject):
        exam = make_exam(subject, publish=True)
        client.force_login(User.objects.create_superuser("01512345678", PW, full_name="Root"))
        changelist = "/django-admin/exams/exam/"
        client.post(changelist, {"action": "unpublish", "_selected_action": [exam.pk]})
        client.post(changelist, {"action": "archive", "_selected_action": [exam.pk]})
        client.post(changelist, {"action": "archive", "_selected_action": [exam.pk]})  # invalid now
        exam.refresh_from_db()
        assert exam.status == ExamStatus.ARCHIVED
        assert AuditLog.objects.filter(action="exam.unpublish").count() == 1
        assert AuditLog.objects.filter(action="exam.archive").count() == 1
