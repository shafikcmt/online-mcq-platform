"""Milestone 3B: question bank (Question + options), admin API, audit, images."""

import io
import json
import threading
import unicodedata
from unittest import mock

import pytest
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import DatabaseError, IntegrityError, connection, transaction
from django.db.models import ProtectedError
from django.utils import translation
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.audit.models import AuditLog
from apps.audit.services import AuditContext
from apps.catalog import services as catalog
from apps.catalog.exceptions import CatalogInUse
from apps.catalog.models import Category, Subject
from apps.questions import services
from apps.questions.models import Question, QuestionOption

pytestmark = pytest.mark.django_db

PW = "Strong-Pass-2026"  # test-only value
QUESTIONS = "/api/v1/admin/questions/"
CTX = AuditContext()


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
    client = APIClient(REMOTE_ADDR="203.0.113.5")
    client.force_login(admin_user)
    return client


def make_subject(slug="physics", category_slug="science"):
    cat = Category.objects.filter(slug=category_slug).first() or catalog.create_category(
        Category(name_en=category_slug.title(), slug=category_slug), ctx=CTX
    )
    return catalog.create_subject(Subject(category=cat, name_en=slug.title(), slug=slug), ctx=CTX)


@pytest.fixture
def subject():
    return make_subject()


def opts(correct=0, n=4, langs=("bn", "en")):
    items = []
    for i in range(n):
        item = {"is_correct": i == correct, "sort_order": i}
        if "bn" in langs:
            item["text_bn"] = f"বিকল্প {i}"
        if "en" in langs:
            item["text_en"] = f"Option {i}"
        items.append(item)
    return items


def payload(subject, /, **extra):
    body = {
        "subject": subject.pk,
        "text_bn": "নিউটনের প্রথম সূত্র কী?",
        "text_en": "What is Newton's first law?",
        "explanation_bn": "জড়তার সূত্র",
        "explanation_en": "The law of inertia",
        "difficulty": "medium",
        "options": opts(),
    }
    body.update(extra)
    return body


def make_question(subject, options=None, **fields):
    fields.setdefault("text_en", "What is 2 + 2?")
    question = Question(subject=subject, **fields)
    options = opts(langs=("en",)) if options is None else options
    return services.create_question(question, options, ctx=CTX)


def errors(response):
    return response.json()["error"]["field_errors"]


def correct_count(question_id):
    return QuestionOption.objects.filter(question_id=question_id, is_correct=True).count()


def png(size=(20, 10), color=(255, 0, 0), fmt="PNG", **save):
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, format=fmt, **save)
    return buffer.getvalue()


# ======================================================================================
# Models & database constraints
# ======================================================================================
class TestModels:
    def test_subject_has_many_questions_with_many_options(self, subject):
        q1, q2 = make_question(subject), make_question(subject, text_en="Another?")
        assert subject.questions.count() == 2
        assert q1.options.count() == q2.options.count() == 4
        assert list(q1.options.values_list("sort_order", flat=True)) == [0, 1, 2, 3]

    def test_subject_is_protected(self, subject):
        make_question(subject)
        with pytest.raises(ProtectedError):
            subject.delete()

    def test_deleting_a_question_deletes_its_options(self, subject):
        question = make_question(subject)
        services.delete_question(question.pk, ctx=CTX)
        assert not QuestionOption.objects.exists()

    def test_at_most_one_correct_option_in_database(self, subject):
        question = make_question(subject)
        wrong = question.options.filter(is_correct=False).first()
        with pytest.raises(IntegrityError), transaction.atomic():
            QuestionOption.objects.filter(pk=wrong.pk).update(is_correct=True)
        assert correct_count(question.pk) == 1

    @pytest.mark.parametrize(
        "sql",
        [
            "UPDATE questions_question SET difficulty = 'impossible'",
            "UPDATE questions_question SET text_bn = '', text_en = ''",
            "UPDATE questions_question SET available_languages = 'fr'",
            "UPDATE questions_questionoption SET sort_order = -1",
            "UPDATE questions_questionoption SET text_bn = '', text_en = ''",
            "UPDATE questions_questionoption SET sort_order = 0",  # duplicate order
        ],
    )
    def test_raw_invalid_data_is_rejected(self, subject, sql):
        make_question(subject)
        with pytest.raises(IntegrityError), transaction.atomic(), connection.cursor() as cur:
            cur.execute(sql)

    def test_available_languages_is_computed(self, subject):
        assert make_question(subject).available_languages == "en"
        both = make_question(subject, text_bn="প্রশ্ন", options=opts())
        assert both.available_languages == "both"
        bn = make_question(subject, text_en="", text_bn="প্রশ্ন", options=opts(langs=("bn",)))
        assert bn.available_languages == "bn"

    def test_text_normalization(self, subject):
        decomposed = "প্রশ্ন য়"
        question = make_question(
            subject,
            text_en="  What\x00 is  this?\r\nSecond line  ",
            text_bn=decomposed,
            explanation_en="...",  # punctuation only → treated as empty
            options=opts(),
        )
        question.refresh_from_db()
        assert question.text_en == "What is  this?\nSecond line"
        assert question.text_bn == unicodedata.normalize("NFC", decomposed)
        assert question.explanation_en == ""

    def test_html_is_stored_as_plain_text(self, subject):
        html = "<script>alert(1)</script> What is H<sub>2</sub>O?"
        assert make_question(subject, text_en=html).text_en == html  # rendered escaped


# ======================================================================================
# Validation (service layer)
# ======================================================================================
class TestValidation:
    @pytest.mark.parametrize(
        "text_bn, text_en",
        [("", ""), ("   ", "\t\n"), ("​", "‌"), ("...", "?!"), ("\x00", "—")],
    )
    def test_meaningful_question_text_required(self, subject, text_bn, text_en):
        with pytest.raises(ValidationError) as exc:
            make_question(subject, text_bn=text_bn, text_en=text_en)
        assert {"text_bn", "text_en"} <= set(exc.value.message_dict)
        assert not Question.objects.exists()

    def test_symbols_count_as_meaningful(self, subject):
        options = [
            {"text_en": "∞", "is_correct": True},
            {"text_en": "√2"},
            {"text_en": "π"},
        ]
        assert make_question(subject, text_en="∑ = ?", options=options).options.count() == 3

    @pytest.mark.parametrize("n", [0, 1, 11])
    def test_option_count_limits(self, subject, n):
        with pytest.raises(ValidationError) as exc:
            make_question(subject, options=opts(n=n, langs=("en",)) if n else [])
        assert "options" in exc.value.message_dict
        assert not Question.objects.exists()

    def test_option_count_limits_are_configurable(self, subject, settings):
        settings.QUESTION_MIN_OPTIONS = 4
        with pytest.raises(ValidationError):
            make_question(subject, options=opts(n=3, langs=("en",)))
        assert make_question(subject, options=opts(n=4, langs=("en",)))

    @pytest.mark.parametrize("correct", [None, "two"])
    def test_exactly_one_correct(self, subject, correct):
        options = opts(langs=("en",))
        options[0]["is_correct"] = False
        if correct == "two":
            options[1]["is_correct"] = options[2]["is_correct"] = True
        with pytest.raises(ValidationError) as exc:
            make_question(subject, options=options)
        with translation.override("en"):
            assert exc.value.message_dict["options"] == ["Mark exactly one option as correct."]
        assert not Question.objects.exists() and not QuestionOption.objects.exists()

    def test_options_must_cover_question_languages(self, subject):
        with pytest.raises(ValidationError) as exc, translation.override("en"):
            make_question(subject, text_bn="প্রশ্ন", options=opts(langs=("en",)))
        with translation.override("en"):
            assert "Bangla" in exc.value.message_dict["options"][0]

    @pytest.mark.parametrize(
        "mutate",
        [
            lambda o: o[1].update(text_en="", text_bn=""),
            lambda o: o[1].update(text_en="   ​"),
            lambda o: o[1].update(sort_order=0),  # duplicate sort order
            lambda o: o[1].update(text_en="option 0"),  # duplicate text (case-insensitive)
            lambda o: o[1].update(text_en="x" * 1001),
        ],
    )
    def test_invalid_options(self, subject, mutate):
        options = opts(langs=("en",))
        mutate(options)
        with pytest.raises(ValidationError):
            make_question(subject, options=options)
        assert not Question.objects.exists()

    def test_default_sort_order_follows_list_position(self, subject):
        options = [{"text_en": t, "is_correct": t == "B"} for t in ("A", "B", "C")]
        question = make_question(subject, options=options)
        assert list(question.options.values_list("text_en", "sort_order")) == [
            ("A", 0),
            ("B", 1),
            ("C", 2),
        ]


# ======================================================================================
# Permissions
# ======================================================================================
class TestPermissions:
    def test_anonymous(self, subject):
        client = APIClient()
        assert client.get(QUESTIONS).status_code == 401
        assert client.post(QUESTIONS, payload(subject), format="json").status_code == 401

    def test_student_jwt_and_session(self, subject):
        from apps.accounts.tokens import issue_tokens

        question = make_question(subject)
        student = User.objects.create_user("01712345678", password=PW, full_name="S")
        jwt_client = APIClient()
        jwt_client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(student)['access']}")
        session_client = APIClient()
        session_client.force_login(student)
        detail = f"{QUESTIONS}{question.pk}/"
        for client, expected in ((jwt_client, 401), (session_client, 403)):
            assert client.get(QUESTIONS).status_code == expected
            assert client.get(detail).status_code == expected
            assert client.post(QUESTIONS, payload(subject), format="json").status_code == expected
            assert client.patch(detail, {"is_active": False}, format="json").status_code == expected
            assert client.delete(detail).status_code == expected
        assert Question.objects.get().is_active and Question.objects.count() == 1

    def test_inactive_admin(self, admin_user):
        client = APIClient()
        client.force_login(admin_user)
        User.objects.filter(pk=admin_user.pk).update(is_active=False)
        assert client.get(QUESTIONS).status_code == 401

    def test_csrf_required_for_writes(self, admin_user, subject):
        question = make_question(subject)
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(admin_user)
        assert client.get(QUESTIONS).status_code == 200
        detail = f"{QUESTIONS}{question.pk}/"
        assert client.post(QUESTIONS, payload(subject), format="json").status_code == 403
        assert client.patch(detail, {"is_active": False}, format="json").status_code == 403
        assert client.delete(detail).status_code == 403
        image = SimpleUploadedFile("a.png", png(), content_type="image/png")
        assert client.post(f"{detail}image/", {"image": image}).status_code == 403
        assert Question.objects.count() == 1 and Question.objects.get().is_active

    def test_valid_admin(self, api):
        assert api.get(QUESTIONS).status_code == 200


# ======================================================================================
# Create / update via API
# ======================================================================================
class TestCreateApi:
    def test_create_bilingual(self, api, subject, admin_user):
        response = api.post(QUESTIONS, payload(subject), format="json")
        assert response.status_code == 201, response.content
        body = response.json()
        assert body["subject"] == subject.pk and body["category"] == subject.category_id
        assert body["available_languages"] == "both" and body["difficulty"] == "medium"
        assert body["created_by"] == admin_user.pk and body["image"] is None
        assert [o["is_correct"] for o in body["options"]] == [True, False, False, False]
        assert set(body["options"][0]) == {"id", "text_bn", "text_en", "is_correct", "sort_order"}

    @pytest.mark.parametrize("lang", ["bn", "en"])
    def test_single_language(self, api, subject, lang):
        other = "en" if lang == "bn" else "bn"
        body = payload(subject, options=opts(langs=(lang,)))
        body[f"text_{other}"] = ""
        body[f"explanation_{other}"] = ""
        response = api.post(QUESTIONS, body, format="json")
        assert response.status_code == 201 and response.json()["available_languages"] == lang

    @pytest.mark.parametrize(
        "change, field",
        [
            ({"text_bn": "", "text_en": " "}, "text_en"),
            ({"options": []}, "options"),
            ({"options": opts(correct=9)}, "options"),
            ({"difficulty": "impossible"}, "difficulty"),
            ({"subject": 999999}, "subject"),
            ({"subject": None}, "subject"),
            ({"text_en": "x" * 5001}, "text_en"),
            ({"options": [{"text_en": "A", "sort_order": -1}]}, "options"),
            ({"options": "not-a-list"}, "options"),
        ],
    )
    def test_validation_errors(self, api, subject, change, field):
        response = api.post(QUESTIONS, payload(subject, **change), format="json")
        assert response.status_code == 400
        assert field in errors(response)
        assert (
            not Question.objects.exists()
            and not AuditLog.objects.filter(action__startswith="question.").exists()
        )

    def test_options_are_required_on_create(self, api, subject):
        body = payload(subject)
        del body["options"]
        response = api.post(QUESTIONS, body, format="json")
        assert response.status_code == 400 and "options" in errors(response)

    def test_read_only_fields_are_ignored(self, api, subject):
        body = payload(
            subject,
            id=999,
            available_languages="bn",
            created_by=12345,
            image="/etc/passwd",
            created_at="2000-01-01T00:00:00Z",
        )
        data = api.post(QUESTIONS, body, format="json").json()
        assert data["id"] != 999 and data["available_languages"] == "both"
        assert data["image"] is None and data["created_by"] != 12345

    def test_null_difficulty_means_not_set(self, api, subject):
        response = api.post(QUESTIONS, payload(subject, difficulty=None), format="json")
        assert response.status_code == 201 and response.json()["difficulty"] == ""

    def test_messages_in_bangla(self, api, subject):
        response = api.post(
            QUESTIONS,
            payload(subject, options=opts(correct=9)),
            format="json",
            HTTP_ACCEPT_LANGUAGE="bn",
        )
        assert any("ঀ" <= ch <= "৿" for ch in errors(response)["options"][0])

    def test_put_not_allowed(self, api, subject):
        question = make_question(subject)
        assert api.put(f"{QUESTIONS}{question.pk}/", {}, format="json").status_code == 405


class TestUpdateApi:
    @pytest.fixture
    def question(self, api, subject):
        return Question.objects.get(
            pk=api.post(QUESTIONS, payload(subject), format="json").json()["id"]
        )

    def url(self, question):
        return f"{QUESTIONS}{question.pk}/"

    def test_update_question_fields(self, api, question):
        response = api.patch(
            self.url(question), {"difficulty": "hard", "is_active": False}, format="json"
        )
        assert response.status_code == 200
        assert response.json()["difficulty"] == "hard" and response.json()["is_active"] is False
        assert question.options.count() == 4  # options untouched

    def test_change_subject(self, api, question):
        other = make_subject("chemistry")
        response = api.patch(self.url(question), {"subject": other.pk}, format="json")
        assert response.status_code == 200 and response.json()["subject"] == other.pk

    def test_replace_options_and_change_correct_answer(self, api, question):
        old_ids = set(question.options.values_list("id", flat=True))
        new = opts(correct=2, n=3)
        response = api.patch(self.url(question), {"options": new}, format="json")
        assert response.status_code == 200
        body = response.json()
        assert [o["is_correct"] for o in body["options"]] == [False, False, True]
        assert not old_ids & {o["id"] for o in body["options"]}  # complete replacement
        assert QuestionOption.objects.count() == 3 and correct_count(question.pk) == 1

    @pytest.mark.parametrize(
        "change",
        [
            {"options": opts(correct=9)},
            {"options": opts(n=1)},
            {"text_bn": "", "text_en": ""},
            {"text_en": "Updated?", "options": opts(langs=("bn",))},  # en missing on options
            {"subject": 999999},
        ],
    )
    def test_invalid_update_changes_nothing(self, api, question, change):
        before_question = Question.objects.values().get(pk=question.pk)
        before_options = list(question.options.values())
        response = api.patch(self.url(question), change, format="json")
        assert response.status_code == 400
        assert Question.objects.values().get(pk=question.pk) == before_question
        assert list(question.options.values()) == before_options
        assert not AuditLog.objects.filter(action="question.update").exists()

    def test_adding_a_language_requires_options_in_it(self, api, subject):
        body = payload(subject, text_bn="", explanation_bn="", options=opts(langs=("en",)))
        question_id = api.post(QUESTIONS, body, format="json").json()["id"]
        response = api.patch(f"{QUESTIONS}{question_id}/", {"text_bn": "প্রশ্ন"}, format="json")
        assert response.status_code == 400 and "options" in errors(response)
        ok = api.patch(
            f"{QUESTIONS}{question_id}/", {"text_bn": "প্রশ্ন", "options": opts()}, format="json"
        )
        assert ok.status_code == 200 and ok.json()["available_languages"] == "both"

    def test_option_failure_rolls_back_question_change(self, api, question):
        with mock.patch.object(
            QuestionOption.objects, "bulk_create", side_effect=DatabaseError("disk full")
        ):
            with pytest.raises(DatabaseError):
                api.patch(
                    self.url(question),
                    {"text_en": "Changed?", "options": opts(correct=1)},
                    format="json",
                )
        question.refresh_from_db()
        assert question.text_en == "What is Newton's first law?"
        assert (
            question.options.count() == 4 and question.options.get(is_correct=True).sort_order == 0
        )


# ======================================================================================
# Listing
# ======================================================================================
class TestListing:
    @pytest.fixture
    def bank(self, subject):
        other_category_subject = make_subject("algebra", category_slug="maths")
        return {
            "easy_en": make_question(subject, text_en="Speed of light?", difficulty="easy"),
            "hard_bn": make_question(
                subject,
                text_en="",
                text_bn="আলোর বেগ কত?",
                difficulty="hard",
                options=opts(langs=("bn",)),
            ),
            "both_inactive": make_question(
                subject, text_bn="ভর কী?", text_en="What is mass?", options=opts(), is_active=False
            ),
            "maths": make_question(other_category_subject, text_en="Solve x + 1 = 2"),
        }

    def ids(self, api, query=""):
        response = api.get(QUESTIONS + query)
        assert response.status_code == 200, response.content
        return [row["id"] for row in response.json()["results"]]

    def test_filters(self, api, bank, subject):
        b = {k: v.pk for k, v in bank.items()}
        assert set(self.ids(api, f"?subject={subject.pk}")) == {
            b["easy_en"],
            b["hard_bn"],
            b["both_inactive"],
        }
        assert self.ids(api, f"?category={bank['maths'].subject.category_id}") == [b["maths"]]
        assert self.ids(api, "?difficulty=hard") == [b["hard_bn"]]
        assert set(self.ids(api, "?is_active=false")) == {b["both_inactive"]}
        assert set(self.ids(api, "?language=bn")) == {b["hard_bn"], b["both_inactive"]}
        assert set(self.ids(api, "?language=en")) == {b["easy_en"], b["both_inactive"], b["maths"]}
        assert self.ids(api, "?language=both") == [b["both_inactive"]]

    def test_search(self, api, bank):
        assert self.ids(api, "?search=light") == [bank["easy_en"].pk]
        assert self.ids(api, "?search=আলোর") == [bank["hard_bn"].pk]
        assert self.ids(api, "?search=MASS") == [bank["both_inactive"].pk]

    def test_ordering_is_deterministic(self, api, bank):
        all_ids = sorted(q.pk for q in bank.values())
        assert self.ids(api, "?ordering=id") == all_ids
        assert self.ids(api, "?ordering=-id") == all_ids[::-1]
        assert self.ids(api) == all_ids[::-1]  # default: newest first, id tie-break
        Question.objects.update(difficulty="easy")
        assert self.ids(api, "?ordering=difficulty") == all_ids  # ties broken by id

    @pytest.mark.parametrize(
        "query, field",
        [
            ("?subject=abc", "subject"),
            ("?category=0", "category"),
            ("?difficulty=impossible", "difficulty"),
            ("?is_active=maybe", "is_active"),
            ("?language=fr", "language"),
            ("?ordering=text_en", "ordering"),
            ("?ordering=options__is_correct", "ordering"),
            ("?search=" + "x" * 101, "search"),
        ],
    )
    def test_invalid_parameters(self, api, bank, query, field):
        response = api.get(QUESTIONS + query)
        assert response.status_code == 400 and field in errors(response)


# ======================================================================================
# Delete protection
# ======================================================================================
class TestDelete:
    def test_delete_question(self, api, subject):
        question = make_question(subject)
        assert api.delete(f"{QUESTIONS}{question.pk}/").status_code == 204
        assert not Question.objects.exists() and not QuestionOption.objects.exists()
        assert api.get(f"{QUESTIONS}{question.pk}/").status_code == 404

    def test_subject_with_questions_cannot_be_deleted(self, api, subject):
        make_question(subject)
        response = api.delete(f"/api/v1/admin/subjects/{subject.pk}/")
        assert response.status_code == 409 and response.json()["error"]["code"] == "in_use"
        assert Subject.objects.filter(pk=subject.pk).exists() and Question.objects.count() == 1

    def test_used_question_returns_409(self, api, subject):
        """3C/4: an exam reference (PROTECT) must block deletion instead of cascading."""
        question = make_question(subject)
        with mock.patch.object(Question, "delete", side_effect=ProtectedError("used", set())):
            response = api.delete(f"{QUESTIONS}{question.pk}/")
        assert response.status_code == 409 and response.json()["error"]["code"] == "in_use"
        assert Question.objects.filter(pk=question.pk).exists()
        assert not AuditLog.objects.filter(action="question.delete").exists()


# ======================================================================================
# Audit
# ======================================================================================
class TestAudit:
    def entries(self, action):
        return AuditLog.objects.filter(action=action)

    def test_create_update_delete_each_logged_once(self, api, subject, admin_user):
        question_id = api.post(QUESTIONS, payload(subject), format="json").json()["id"]
        url = f"{QUESTIONS}{question_id}/"
        api.patch(url, {"options": opts(correct=1)}, format="json")
        api.delete(url)
        create, update, delete = (
            self.entries("question.create").get(),
            self.entries("question.update").get(),
            self.entries("question.delete").get(),
        )
        assert create.actor == admin_user and create.ip_address == "203.0.113.5"
        assert create.entity_type == "questions.question" and create.entity_id == str(question_id)
        assert create.metadata["values"] == {
            "subject_id": subject.pk,
            "difficulty": "medium",
            "is_active": True,
            "available_languages": "both",
            "option_count": 4,
        }
        assert update.metadata == {"changed_fields": ["options", "correct_option"], "changes": {}}
        assert delete.metadata["snapshot"]["option_count"] == 4
        assert create.summary == update.summary == f"question #{question_id}"

    def test_changes_record_names_and_identity_values_only(self, api, subject):
        question_id = api.post(QUESTIONS, payload(subject), format="json").json()["id"]
        other = make_subject("chemistry")
        api.patch(
            f"{QUESTIONS}{question_id}/",
            {
                "subject": other.pk,
                "text_en": "Rewritten secret wording?",
                "explanation_bn": "নতুন ব্যাখ্যা",
                "options": opts(n=3),  # same correct answer text, fewer options
            },
            format="json",
        )
        metadata = self.entries("question.update").get().metadata
        assert metadata["changed_fields"] == ["subject_id", "text_en", "explanation_bn", "options"]
        assert metadata["changes"] == {
            "subject_id": {"from": subject.pk, "to": other.pk},
            "option_count": {"from": 4, "to": 3},
        }

    def test_no_op_patch_writes_nothing(self, api, subject):
        body = payload(subject)
        question_id = api.post(QUESTIONS, body, format="json").json()["id"]
        same = {k: v for k, v in body.items() if k != "subject"}
        response = api.patch(f"{QUESTIONS}{question_id}/", same, format="json")
        assert response.status_code == 200
        assert not self.entries("question.update").exists()

    def test_no_content_or_secrets_in_audit(self, api, subject, admin_user, settings):
        from apps.accounts.tokens import issue_tokens

        jwt_pair = issue_tokens(User.objects.create_user("01712345678", password=PW, full_name="S"))
        body = payload(subject, password=PW, token=jwt_pair["access"])
        question_id = api.post(
            QUESTIONS, body, format="json", HTTP_AUTHORIZATION=f"Bearer {jwt_pair['access']}"
        ).json()["id"]
        api.patch(
            f"{QUESTIONS}{question_id}/",
            {"options": opts(correct=3), "explanation_en": "Because of inertia"},
            format="json",
        )
        api.delete(f"{QUESTIONS}{question_id}/")
        stored = AuditLog.objects.values(
            "action", "entity_type", "entity_id", "summary", "metadata", "user_agent"
        )
        dumped = json.dumps(list(stored), default=str, ensure_ascii=False)
        for secret in (
            "Newton",
            "নিউটনের",
            "inertia",
            "জড়তার",
            "Option 0",
            "Option 3",
            "বিকল্প",
            PW,
            admin_user.password,
            jwt_pair["access"],
            api.cookies["sessionid"].value,
            settings.SECRET_KEY,
        ):
            assert secret not in dumped, secret

    def test_audit_failure_rolls_back(self, subject, monkeypatch):
        def broken(*args, **kwargs):
            raise DatabaseError("audit storage unavailable")

        monkeypatch.setattr(services.audit, "record", broken)
        with pytest.raises(DatabaseError), transaction.atomic():
            make_question(subject)
        assert not Question.objects.exists() and not QuestionOption.objects.exists()


# ======================================================================================
# Images
# ======================================================================================
class TestImages:
    @pytest.fixture
    def question(self, subject):
        return make_question(subject)

    def upload(self, api, question, content, name="photo.png", content_type="image/png"):
        url = f"{QUESTIONS}{question.pk}/image/"
        return api.post(url, {"image": SimpleUploadedFile(name, content, content_type)})

    @pytest.mark.parametrize("fmt, ext", [("PNG", "png"), ("JPEG", "jpg"), ("WEBP", "webp")])
    def test_valid_upload_is_stored_under_a_random_name(self, api, question, fmt, ext, settings):
        response = self.upload(api, question, png(fmt=fmt), name="../../evil name.php")
        assert response.status_code == 200, response.content
        question.refresh_from_db()
        assert question.image.name.startswith("questions/") and question.image.name.endswith(
            f".{ext}"
        )
        assert "evil" not in question.image.name and ".php" not in question.image.name
        assert response.json()["image"].endswith(question.image.name)
        with Image.open(question.image.path) as stored:
            assert stored.format == fmt

    def test_metadata_is_stripped(self, api, question):
        exif = Image.Exif()
        exif[0x010E] = "GPS secret location"
        self.upload(api, question, png(fmt="JPEG", exif=exif), name="a.jpg")
        question.refresh_from_db()
        with Image.open(question.image.path) as stored:
            assert not stored.getexif()

    @pytest.mark.parametrize(
        "content, name",
        [
            (b"<?php system($_GET['c']); ?>", "shell.png"),
            (b"<svg onload=alert(1)></svg>", "image.svg"),
            (b"GIF89a" + b"\x00" * 50, "anim.gif"),
            (b"", "empty.png"),
            (png()[:30], "truncated.png"),
        ],
    )
    def test_invalid_content_rejected(self, api, question, content, name):
        response = self.upload(api, question, content, name=name)
        assert response.status_code == 400 and "image" in errors(response)
        question.refresh_from_db()
        assert not question.image

    def test_real_gif_rejected(self, api, question):
        response = self.upload(api, question, png(fmt="GIF"), name="x.gif")
        assert response.status_code == 400

    def test_size_and_pixel_limits(self, api, question, settings):
        settings.QUESTION_IMAGE_MAX_BYTES = 1000
        big = png(size=(400, 400), color=(1, 2, 3))
        noisy = Image.effect_noise((400, 400), 100).convert("RGB")
        buffer = io.BytesIO()
        noisy.save(buffer, format="PNG")
        assert self.upload(api, question, buffer.getvalue()).status_code == 400
        settings.QUESTION_IMAGE_MAX_BYTES = 2 * 1024 * 1024
        settings.QUESTION_IMAGE_MAX_PIXELS = 100
        assert self.upload(api, question, big).status_code == 400
        question.refresh_from_db()
        assert not question.image

    def test_missing_file(self, api, question):
        response = api.post(f"{QUESTIONS}{question.pk}/image/", {})
        assert response.status_code == 400 and "image" in errors(response)

    def test_replace_and_remove_delete_old_files(
        self, api, question, django_capture_on_commit_callbacks
    ):
        storage = Question._meta.get_field("image").storage
        with django_capture_on_commit_callbacks(execute=True):
            self.upload(api, question, png())
        question.refresh_from_db()
        first = question.image.name
        with django_capture_on_commit_callbacks(execute=True):
            self.upload(api, question, png(color=(0, 255, 0)))
        question.refresh_from_db()
        assert question.image.name != first and not storage.exists(first)
        second = question.image.name
        with django_capture_on_commit_callbacks(execute=True):
            response = api.delete(f"{QUESTIONS}{question.pk}/image/")
        assert response.status_code == 200 and response.json()["image"] is None
        assert not storage.exists(second)
        actions = list(
            AuditLog.objects.filter(action="question.update").values_list("metadata", flat=True)
        )
        assert actions == [{"changed_fields": ["image"]}] * 3
        assert "questions/" not in json.dumps(actions)

    def test_failed_save_leaves_no_orphan_file(self, api, question, monkeypatch, settings):
        import os

        def broken(*args, **kwargs):
            raise DatabaseError("audit down")

        monkeypatch.setattr(services.audit, "record", broken)
        with pytest.raises(DatabaseError):
            self.upload(api, question, png())
        media = os.path.join(settings.MEDIA_ROOT, "questions")
        assert not os.path.isdir(media) or os.listdir(media) == []
        question.refresh_from_db()
        assert not question.image

    def test_unknown_question(self, api):
        response = api.post(
            f"{QUESTIONS}999999/image/", {"image": SimpleUploadedFile("a.png", png())}
        )
        assert response.status_code == 404


# ======================================================================================
# Answer confidentiality
# ======================================================================================
class TestConfidentiality:
    def test_no_public_or_student_question_endpoints(self, subject):
        question = make_question(subject)
        client = APIClient()
        for path in (
            "/api/v1/public/questions/",
            "/api/v1/questions/",
            f"/api/v1/questions/{question.pk}/",
            f"/api/v1/public/questions/{question.pk}/",
        ):
            assert client.get(path).status_code == 404, path

    def test_schema_exposes_no_answer_fields_outside_admin(self, api):
        from drf_spectacular.generators import SchemaGenerator

        schema = SchemaGenerator().get_schema(request=None, public=True)
        # Question management stays admin-only; the only other question URL is the exam
        # room's autosave (Milestone 4B), which takes a question id but returns no content.
        exam_room_answer = "/api/v1/attempts/{public_id}/answers/{question_id}/"
        for path in schema["paths"]:
            if "question" in path and path != exam_room_answer:
                assert path.startswith("/api/v1/admin/"), path
        # No non-admin operation can return an answer key or explanation.
        components = schema["components"]["schemas"]

        def fields(ref, seen):
            name = ref.rsplit("/", 1)[-1]
            if name in seen:
                return set()
            seen.add(name)
            component = components[name]
            found = set(component.get("properties", {}))
            for prop in component.get("properties", {}).values():
                for nested in (prop, prop.get("items", {})):
                    for key in ("$ref",):
                        if key in nested:
                            found |= fields(nested[key], seen)
                    for option in nested.get("allOf", []):
                        if "$ref" in option:
                            found |= fields(option["$ref"], seen)
            return found

        for path, operations in schema["paths"].items():
            if path.startswith("/api/v1/admin/"):
                continue
            for operation in operations.values():
                for response in operation.get("responses", {}).values():
                    for media in response.get("content", {}).values():
                        ref = media.get("schema", {}).get("$ref") or media.get("schema", {}).get(
                            "items", {}
                        ).get("$ref")
                        if ref:
                            exposed = fields(ref, set())
                            assert not exposed & {
                                "is_correct",
                                "explanation_bn",
                                "explanation_en",
                                "explanation",
                                "awarded_marks",
                            }, path


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
        except Exception as exc:  # noqa: BLE001 — asserted by the test
            results[index] = exc
        finally:
            connection.close()

    threads = [threading.Thread(target=runner, args=(i, f)) for i, f in enumerate(funcs)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    return results


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_concurrent_option_replacements_leave_exactly_one_correct(run):
    question = make_question(make_subject(f"s{run}"))
    results = _run_concurrently(
        *[
            (
                lambda c=c: services.update_question(
                    question.pk, {}, opts(correct=c, langs=("en",)), ctx=CTX
                )
            )
            for c in range(4)
        ]
    )
    assert all(isinstance(r, Question) for r in results), results
    assert correct_count(question.pk) == 1
    assert QuestionOption.objects.filter(question=question).count() == 4


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_concurrent_creates_each_have_exactly_one_correct(run):
    subject = make_subject(f"c{run}")
    results = _run_concurrently(
        *[
            (lambda c=c: make_question(subject, options=opts(correct=c, langs=("en",))))
            for c in range(4)
        ]
    )
    assert all(isinstance(r, Question) for r in results), results
    for question in results:
        assert correct_count(question.pk) == 1


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("run", range(3))
def test_subject_delete_racing_question_create(run):
    subject = make_subject(f"race-{run}")
    deleted, created = _run_concurrently(
        lambda: catalog.delete_subject(subject.pk, ctx=CTX),
        lambda: make_question(subject),
    )
    if isinstance(deleted, CatalogInUse):  # create won
        assert isinstance(created, Question)
        assert Subject.objects.filter(pk=subject.pk).exists()
    else:  # delete won: the question was refused cleanly
        assert deleted is None
        assert isinstance(created, ValidationError) and "subject" in created.message_dict
        assert not Subject.objects.filter(pk=subject.pk).exists()
        assert not Question.objects.exists()
    assert not QuestionOption.objects.exclude(question__in=Question.objects.all()).exists()


# ======================================================================================
# Internal Django admin
# ======================================================================================
class TestDjangoAdmin:
    @pytest.fixture
    def ops(self, client):
        client.force_login(User.objects.create_superuser("01512345678", PW, full_name="Root"))
        return client

    def test_pages_load_and_are_read_only(self, ops, subject):
        question = make_question(subject)
        for url in (
            "/django-admin/questions/question/",
            "/django-admin/questions/question/?difficulty__exact=easy&q=what",
            f"/django-admin/questions/question/{question.pk}/change/",
        ):
            assert ops.get(url).status_code == 200, url
        assert ops.get("/django-admin/questions/question/add/").status_code == 403
        ops.post(f"/django-admin/questions/question/{question.pk}/change/", {"text_en": "Hacked?"})
        question.refresh_from_db()
        assert question.text_en == "What is 2 + 2?"
        assert ops.get("/django-admin/questions/questionoption/").status_code == 404  # no page

    def test_actions_go_through_services_and_are_audited(self, ops, subject):
        ids = [make_question(subject, text_en=f"Q{i}?").pk for i in range(2)]
        changelist = "/django-admin/questions/question/"
        ops.post(changelist, {"action": "deactivate", "_selected_action": ids})
        assert not Question.objects.filter(is_active=True).exists()
        assert AuditLog.objects.filter(action="question.update").count() == 2
        ops.post(changelist, {"action": "deactivate", "_selected_action": ids})  # no-op
        assert AuditLog.objects.filter(action="question.update").count() == 2
        response = ops.post(
            changelist, {"action": "delete_selected", "_selected_action": ids, "post": "yes"}
        )
        assert response.status_code == 302
        assert not Question.objects.exists() and not QuestionOption.objects.exists()
        assert AuditLog.objects.filter(action="question.delete").count() == 2


def test_view_only_staff_cannot_use_status_actions(client):
    from django.contrib.auth.models import Permission

    subject = make_subject()
    question = make_question(subject)
    staff = User.objects.create_user("01912345678", password=PW, full_name="Viewer", is_staff=True)
    staff.user_permissions.add(Permission.objects.get(codename="view_question"))
    client.force_login(staff)
    assert client.get("/django-admin/questions/question/").status_code == 200
    client.post(
        "/django-admin/questions/question/",
        {"action": "deactivate", "_selected_action": [question.pk]},
    )
    question.refresh_from_db()
    assert question.is_active and not AuditLog.objects.filter(action="question.update").exists()


# ======================================================================================
# Final review: integrity, duplicates, image lifecycle and security, mass assignment
# ======================================================================================
class TestCorrectOptionIntegrity:
    def test_every_service_path_leaves_exactly_one_correct(self, api, subject, admin_user):
        question_id = api.post(QUESTIONS, payload(subject), format="json").json()["id"]
        assert correct_count(question_id) == 1
        url = f"{QUESTIONS}{question_id}/"
        api.patch(url, {"difficulty": "easy"}, format="json")  # no options sent
        assert correct_count(question_id) == 1
        api.patch(url, {"options": opts(correct=3)}, format="json")  # replace + change answer
        assert correct_count(question_id) == 1
        assert QuestionOption.objects.get(question_id=question_id, is_correct=True).sort_order == 3
        services.update_question(question_id, {"is_active": False}, None, ctx=CTX)  # admin action
        assert correct_count(question_id) == 1
        api.delete(url)
        assert not QuestionOption.objects.filter(question_id=question_id).exists()

    @pytest.mark.parametrize(
        "misuse",
        [
            lambda q: QuestionOption.objects.create(
                question=q, text_en="Extra", sort_order=50, is_correct=True
            ),
            lambda q: QuestionOption.objects.bulk_create(
                [
                    QuestionOption(question=q, text_en="X", sort_order=60, is_correct=True),
                    QuestionOption(question=q, text_en="Y", sort_order=61, is_correct=True),
                ]
            ),
            lambda q: QuestionOption.objects.filter(question=q).update(is_correct=True),
        ],
        ids=["create", "bulk_create", "queryset-update"],
    )
    def test_database_blocks_second_correct_option_from_direct_orm(self, subject, misuse):
        question = make_question(subject)
        with pytest.raises(IntegrityError), transaction.atomic():
            misuse(question)
        assert correct_count(question.pk) == 1


@pytest.mark.django_db(transaction=True)
def test_readers_never_see_a_partial_option_set():
    question = make_question(make_subject("visible"))
    seen = set()
    stop = threading.Event()

    def reader():
        try:
            while not stop.is_set():
                options = list(
                    QuestionOption.objects.filter(question=question).values_list(
                        "is_correct", flat=True
                    )
                )
                seen.add((len(options), sum(options)))
        finally:
            connection.close()

    thread = threading.Thread(target=reader)
    thread.start()
    try:
        for i in range(15):
            services.update_question(question.pk, {}, opts(correct=i % 4, langs=("en",)), ctx=CTX)
    finally:
        stop.set()
        thread.join()
        connection.close()
    assert seen == {(4, 1)}


class TestDuplicateOptions:
    @pytest.mark.parametrize(
        "texts",
        [
            [("", "Paris"), ("", "  PARIS ")],  # case / whitespace only
            [("প্যারিস", "Paris"), ("প্যারিস", "paris")],  # same in every language
            [("", "New  York"), ("", "new york")],
        ],
    )
    def test_obvious_duplicates_rejected(self, subject, texts):
        langs = {"bn" if bn else None for bn, _ in texts} - {None}
        options = [
            {"text_bn": bn, "text_en": en, "is_correct": i == 0} for i, (bn, en) in enumerate(texts)
        ]
        with pytest.raises(ValidationError) as exc, translation.override("en"):
            make_question(subject, text_bn="প্রশ্ন" if langs else "", options=options)
        with translation.override("en"):
            assert exc.value.message_dict["options"] == ["Two options have the same text."]

    def test_options_differing_in_one_language_are_allowed(self, subject):
        options = [
            {"text_bn": "পাঁচ মিটার", "text_en": "5 m", "is_correct": True},
            {"text_bn": "পাঁচ কিলোমিটার", "text_en": "5 m (approx.)"},
            {"text_bn": "দশ মিটার", "text_en": "5 m!"},  # punctuation differs in English
        ]
        question = make_question(subject, text_bn="দূরত্ব কত?", options=options)
        assert question.options.count() == 3

    def test_shared_text_in_one_language_is_allowed_if_the_other_differs(self, subject):
        options = [
            {"text_bn": "ক", "text_en": "Same", "is_correct": True},
            {"text_bn": "খ", "text_en": "Same"},
        ]
        assert make_question(subject, text_bn="প্রশ্ন", options=options).options.count() == 2

    def test_extra_language_on_one_option_makes_it_different(self, subject):
        options = [{"text_en": "A", "is_correct": True}, {"text_en": "A", "text_bn": "ক"}]
        assert make_question(subject, options=options).options.count() == 2


class TestImageLifecycle:
    @pytest.fixture
    def question(self, subject):
        return make_question(subject)

    def upload(self, api, question, content=None, name="photo.png"):
        return api.post(
            f"{QUESTIONS}{question.pk}/image/",
            {"image": SimpleUploadedFile(name, content or png(), "image/png")},
        )

    def files(self, settings):
        import os

        folder = os.path.join(settings.MEDIA_ROOT, "questions")
        return sorted(os.listdir(folder)) if os.path.isdir(folder) else []

    @pytest.mark.parametrize("failure", ["audit", "save"])
    def test_failed_replacement_keeps_the_old_image(
        self, api, question, settings, monkeypatch, django_capture_on_commit_callbacks, failure
    ):
        with django_capture_on_commit_callbacks(execute=True):
            assert self.upload(api, question).status_code == 200
        question.refresh_from_db()
        original = question.image.name
        assert self.files(settings) == [original.split("/")[-1]]

        def broken(*args, **kwargs):
            raise DatabaseError("boom")

        if failure == "audit":
            monkeypatch.setattr(services.audit, "record", broken)
        else:
            monkeypatch.setattr(Question, "save", broken)
        with django_capture_on_commit_callbacks(execute=True), pytest.raises(DatabaseError):
            self.upload(api, question, png(color=(0, 0, 255)))
        question.refresh_from_db()
        assert question.image.name == original  # still referenced …
        assert self.files(settings) == [original.split("/")[-1]]  # … still on disk, no orphan

    def test_invalid_upload_writes_no_file(self, api, question, settings):
        assert self.upload(api, question, b"not an image").status_code == 400
        assert self.files(settings) == []

    def test_refuses_to_run_inside_an_outer_transaction(self, question, settings):
        with pytest.raises(RuntimeError), transaction.atomic():
            services.set_question_image(question.pk, SimpleUploadedFile("a.png", png()), ctx=CTX)
        assert self.files(settings) == []
        question.refresh_from_db()
        assert not question.image

    def test_deleting_the_question_removes_its_image(
        self, api, question, settings, django_capture_on_commit_callbacks
    ):
        self.upload(api, question)
        assert len(self.files(settings)) == 1
        with django_capture_on_commit_callbacks(execute=True):
            assert api.delete(f"{QUESTIONS}{question.pk}/").status_code == 204
        assert self.files(settings) == []

    def test_old_file_is_kept_until_commit(self, api, question, settings):
        self.upload(api, question)
        first = self.files(settings)
        # Without running on-commit callbacks (no commit yet in this test transaction),
        # the replaced file must still exist.
        self.upload(api, question, png(color=(9, 9, 9)))
        assert set(first) <= set(self.files(settings)) and len(self.files(settings)) == 2

    def test_post_commit_delete_failure_does_not_fail_the_request(
        self, api, question, monkeypatch, django_capture_on_commit_callbacks
    ):
        storage = Question._meta.get_field("image").storage
        with django_capture_on_commit_callbacks(execute=True):
            self.upload(api, question)
        monkeypatch.setattr(storage, "delete", mock.Mock(side_effect=OSError("read-only")))
        with django_capture_on_commit_callbacks(execute=True):
            response = api.delete(f"{QUESTIONS}{question.pk}/image/")
        assert response.status_code == 200
        question.refresh_from_db()
        assert not question.image

    def test_repeated_uploads_leave_exactly_one_file(
        self, api, question, settings, django_capture_on_commit_callbacks
    ):
        for i in range(4):
            with django_capture_on_commit_callbacks(execute=True):
                assert self.upload(api, question, png(color=(i, i, i))).status_code == 200
        question.refresh_from_db()
        assert self.files(settings) == [question.image.name.split("/")[-1]]

    def test_audit_never_contains_the_upload_name_or_path(self, api, question):
        self.upload(api, question, name="secret-exam-paper-2026.png")
        question.refresh_from_db()
        dumped = json.dumps(
            list(AuditLog.objects.values("summary", "metadata", "user_agent")), default=str
        )
        assert "secret-exam-paper" not in dumped and question.image.name not in dumped


@pytest.mark.django_db(transaction=True)
def test_concurrent_uploads_leave_one_referenced_file(settings, tmp_path):
    import os

    settings.MEDIA_ROOT = str(tmp_path / "concurrent-media")
    question = make_question(make_subject("uploads"))
    results = _run_concurrently(
        *[
            (
                lambda i=i: services.set_question_image(
                    question.pk, SimpleUploadedFile("a.png", png(color=(i, 0, 0))), ctx=CTX
                )
            )
            for i in range(3)
        ]
    )
    assert all(isinstance(r, Question) for r in results), results
    question.refresh_from_db()
    folder = os.path.join(settings.MEDIA_ROOT, "questions")
    assert os.listdir(folder) == [question.image.name.split("/")[-1]]


class TestImageSecurity:
    @pytest.fixture
    def question(self, subject):
        return make_question(subject)

    def post(self, api, question, content, name="x.png"):
        return api.post(
            f"{QUESTIONS}{question.pk}/image/",
            {"image": SimpleUploadedFile(name, content, "image/png")},
        )

    def test_appended_payload_is_dropped_by_reencoding(self, api, question):
        payload_bytes = b"<?php system($_GET['c']); ?>"
        response = self.post(api, question, png() + payload_bytes, name="x.php.png")
        assert response.status_code == 200
        question.refresh_from_db()
        assert question.image.name.endswith(".png")
        with open(question.image.path, "rb") as stored:
            assert payload_bytes not in stored.read()

    def test_fake_magic_bytes_rejected(self, api, question):
        assert self.post(api, question, b"\x89PNG\r\n\x1a\n<?php echo 1; ?>").status_code == 400
        assert self.post(api, question, b"\xff\xd8\xff\xe0<script>").status_code == 400

    @pytest.mark.parametrize("pillow_limit", [300, 120])  # warning band / error band
    def test_pillow_decompression_bomb_guard(
        self, api, question, settings, monkeypatch, pillow_limit
    ):
        settings.QUESTION_IMAGE_MAX_PIXELS = 10**9  # make Pillow's own guard the one that fires
        monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", pillow_limit)
        response = self.post(api, question, png(size=(20, 20)))  # 400 pixels
        assert response.status_code == 400 and "image" in errors(response)

    def test_size_limit_enforced_by_the_service_too(self, api, question, settings):
        settings.QUESTION_IMAGE_MAX_BYTES = 500  # body stays within the multipart allowance
        noisy = Image.effect_noise((60, 60), 100).convert("RGB")
        buffer = io.BytesIO()
        noisy.save(buffer, format="PNG")
        assert 500 < len(buffer.getvalue()) < 60_000
        response = self.post(api, question, buffer.getvalue())
        assert response.status_code == 400 and "too large" in errors(response)["image"][0]

    def test_media_is_not_routed_when_debug_is_off(self, settings):
        from django.urls import Resolver404, resolve

        assert settings.DEBUG is False
        try:
            match = resolve("/media/questions/x.png")
        except Resolver404:
            return
        assert match.func.__name__ != "serve"


class TestMassAssignment:
    def test_patch_cannot_set_read_only_fields(self, api, subject, admin_user):
        question_id = api.post(QUESTIONS, payload(subject), format="json").json()["id"]
        before = Question.objects.values().get(pk=question_id)
        other_user = User.objects.create_user("01712345678", password=PW, full_name="S")
        response = api.patch(
            f"{QUESTIONS}{question_id}/",
            {
                "id": 999,
                "available_languages": "bn",
                "image": "questions/../../etc/passwd",
                "created_by": other_user.pk,
                "created_at": "2000-01-01T00:00:00Z",
                "updated_at": "2000-01-01T00:00:00Z",
                "is_correct": True,
                "options_count": 99,
            },
            format="json",
        )
        assert response.status_code == 200
        assert Question.objects.values().get(pk=question_id) == before
        assert not AuditLog.objects.filter(action="question.update").exists()

    def test_question_delete_never_touches_the_subject(self, api, subject):
        question = make_question(subject)
        api.delete(f"{QUESTIONS}{question.pk}/")
        assert Subject.objects.filter(pk=subject.pk).exists()
