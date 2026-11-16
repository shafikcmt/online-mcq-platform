# ruff: noqa: F811 -- imported pytest fixtures are re-named as test arguments
"""Push notifications: device tokens, admin messages, delivery through a fake Expo, exam reminders.
No test calls the real Expo service: the transport is replaced."""

import json
from datetime import timedelta
from unittest import mock

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.notifications import push, push_services
from apps.notifications.models import PushDevice, PushKind, PushMessage, PushStatus
from tests.test_cms import CTX, admin_user, api  # noqa: F401
from tests.test_exams import make_exam, make_subject
from tests.test_subscriptions import jwt_client, make_student

pytestmark = pytest.mark.django_db

ADMIN = "/api/v1/admin/push/"
ME = "/api/v1/me/push-devices/"


def token(n: int) -> str:
    return f"ExponentPushToken[abcdefghij{n:010d}]"


class FakeExpo:
    """Replaces ``push.post_messages``: records the requests and answers one ticket per message."""

    def __init__(self, fail=None, tickets=None):
        self.requests: list[list[dict]] = []
        self.fail = fail
        self.tickets = tickets or {}

    def __call__(self, messages):
        if self.fail:
            raise push.PushTransportError(self.fail)
        self.requests.append(messages)
        return [self.tickets.get(m["to"], {"status": "ok", "id": "t"}) for m in messages]

    @property
    def sent(self):
        return [m for batch in self.requests for m in batch]


@pytest.fixture
def expo(settings):
    settings.PUSH_ENABLED = True
    fake = FakeExpo()
    with mock.patch.object(push, "post_messages", fake):
        yield fake


def device(user, n=1, **fields):
    return PushDevice.objects.create(user=user, token=token(n), **fields)


# --------------------------------------------------------------------------------------
# Tokens
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize(
    "value",
    ["ExponentPushToken[abcdefghijklmnop]", "ExpoPushToken[abcdefghij_klmn-op]"],
)
def test_valid_tokens(value):
    assert push.is_valid_token(value)


@pytest.mark.parametrize(
    "value",
    [
        "",
        "abc",
        "ExponentPushToken[]",
        "ExponentPushToken[short]",
        "ExponentPushToken[a b c d e f g h i j]",
        "ExponentPushToken[abcdefghij<script>]",
        "Bearer ExponentPushToken[abcdefghijklmnop]",
        None,
        5,
    ],
)
def test_invalid_tokens(value):
    assert not push.is_valid_token(value)


def test_a_student_registers_and_removes_a_phone():
    student = make_student()
    client = jwt_client(student)
    assert client.post(ME, {"token": token(1)}, format="json").json() == {"registered": True}
    assert PushDevice.objects.get().user == student
    assert client.post(ME, {"token": token(1)}, format="json").status_code == 200  # idempotent
    assert PushDevice.objects.count() == 1
    assert client.delete(ME, {"token": token(1)}, format="json").json() == {"registered": False}
    assert not PushDevice.objects.exists()


def test_a_bad_token_is_refused():
    response = jwt_client(make_student()).post(ME, {"token": "nope"}, format="json")
    assert response.status_code == 400
    assert not PushDevice.objects.exists()


def test_a_phone_moves_to_whoever_signed_in_last():
    first, second = make_student(), make_student()
    jwt_client(first).post(ME, {"token": token(1)}, format="json")
    jwt_client(second).post(ME, {"token": token(1)}, format="json")
    assert PushDevice.objects.get().user == second


def test_registering_reactivates_a_switched_off_device():
    student = make_student()
    device(student, is_active=False, last_error="DeviceNotRegistered")
    jwt_client(student).post(ME, {"token": token(1)}, format="json")
    row = PushDevice.objects.get()
    assert row.is_active and row.last_error == ""


def test_a_student_cannot_remove_someone_elses_device():
    owner, other = make_student(), make_student()
    device(owner)
    jwt_client(other).delete(ME, {"token": token(1)}, format="json")
    assert PushDevice.objects.count() == 1


def test_anonymous_cannot_register():
    assert APIClient().post(ME, {"token": token(1)}, format="json").status_code in (401, 403)


# --------------------------------------------------------------------------------------
# Admin messages
# --------------------------------------------------------------------------------------
def send(api, **body):
    body.setdefault("title_en", "Schedule change")
    body.setdefault("body_en", "Friday's test moves to Saturday.")
    return api.post(f"{ADMIN}messages/", body, format="json")


def latest(api):
    """The newest message as the history shows it (after delivery has run)."""
    return api.get(f"{ADMIN}messages/").json()["results"][0]


def test_the_status_shows_whether_push_is_on_and_how_many_phones(api, settings, expo):
    device(make_student(), 1)
    device(make_student(), 2, is_active=False)
    settings.EXAM_REMINDER_OFFSETS_MINUTES = [60, 1440, 60]
    assert api.get(ADMIN).json() == {
        "enabled": True,
        "devices": 1,
        "reminder_offsets": [60, 1440],
        "announce_new_exams": True,
    }


def test_a_message_reaches_every_active_student_phone_in_their_language(
    api, expo, django_capture_on_commit_callbacks
):
    bn = make_student(preferred_language="bn")
    en = make_student(preferred_language="en")
    device(bn, 1)
    device(en, 2)
    device(make_student(), 3, is_active=False)
    with django_capture_on_commit_callbacks(execute=True):
        response = send(api, title_bn="সময়সূচি বদল", body_bn="শুক্রবারের পরীক্ষা শনিবারে।")
    assert response.status_code == 201, response.content
    assert response.json()["status"] == "pending"  # queued; the task then sends it
    data = latest(api)
    assert data["kind"] == "manual" and data["status"] == "sent"
    assert (data["device_count"], data["sent_count"], data["failed_count"]) == (2, 2, 0)
    by_token = {m["to"]: m for m in expo.sent}
    assert by_token[token(1)]["title"] == "সময়সূচি বদল"
    assert by_token[token(2)]["title"] == "Schedule change"
    assert all(m["data"] == {"type": "notice"} and m["sound"] == "default" for m in expo.sent)
    assert AuditLog.objects.filter(action="push.create").count() == 1


def test_a_language_with_no_text_falls_back_to_the_other(
    api, expo, django_capture_on_commit_callbacks
):
    device(make_student(preferred_language="bn"), 1)
    with django_capture_on_commit_callbacks(execute=True):
        send(api)  # English only
    assert expo.sent[0]["title"] == "Schedule change"


def test_a_message_about_an_exam_opens_it(api, expo, django_capture_on_commit_callbacks):
    exam = make_exam(make_subject(), publish=True)
    device(make_student(), 1)
    with django_capture_on_commit_callbacks(execute=True):
        send(api, exam=exam.pk)
    assert expo.sent[0]["data"] == {"type": "exam", "exam_slug": exam.slug}


def test_only_students_with_active_accounts_get_it(
    api, expo, django_capture_on_commit_callbacks, admin_user
):
    gone = make_student()
    gone.is_active = False
    gone.save()
    device(gone, 1)
    device(admin_user, 2)  # an admin's phone is not a student's
    device(make_student(), 3)
    with django_capture_on_commit_callbacks(execute=True):
        send(api)
    assert [m["to"] for m in expo.sent] == [token(3)]


def test_text_rules(api, expo):
    assert send(api, title_en="", body_en="").status_code == 400  # nothing
    assert send(api, title_en="Only a title", body_en="").status_code == 400  # incomplete language
    assert send(api, title_en="x" * 101).status_code == 400
    assert send(api, body_en="x" * 301).status_code == 400
    assert not PushMessage.objects.exists()


def test_while_push_is_off_the_message_is_recorded_but_not_sent(
    api, settings, django_capture_on_commit_callbacks
):
    settings.PUSH_ENABLED = False
    device(make_student(), 1)
    fake = FakeExpo()
    with (
        mock.patch.object(push, "post_messages", fake),
        django_capture_on_commit_callbacks(execute=True),
    ):
        response = send(api)
    assert response.status_code == 201
    assert response.json()["status"] == "disabled" and latest(api)["sent_count"] == 0
    assert fake.requests == []


def test_a_device_expo_no_longer_knows_is_switched_off(
    api, expo, django_capture_on_commit_callbacks
):
    good, dead = make_student(), make_student()
    device(good, 1)
    device(dead, 2)
    expo.tickets[token(2)] = {
        "status": "error",
        "message": "gone",
        "details": {"error": "DeviceNotRegistered"},
    }
    with django_capture_on_commit_callbacks(execute=True):
        send(api)
    data = latest(api)
    assert (data["sent_count"], data["failed_count"]) == (1, 1)
    row = PushDevice.objects.get(token=token(2))
    assert row.is_active is False and row.last_error == "DeviceNotRegistered"
    assert PushDevice.objects.get(token=token(1)).is_active


def test_a_transport_failure_is_recorded_not_raised(
    api, settings, django_capture_on_commit_callbacks
):
    settings.PUSH_ENABLED = True
    device(make_student(), 1)
    with (
        mock.patch.object(push, "post_messages", FakeExpo(fail="Expo could not be reached.")),
        django_capture_on_commit_callbacks(execute=True),
    ):
        send(api)
    data = latest(api)
    assert data["status"] == "failed" and data["failed_count"] == 1 and data["sent_count"] == 0


def test_batches_of_one_hundred(api, expo, settings, django_capture_on_commit_callbacks):
    PushDevice.objects.bulk_create(
        [PushDevice(user=make_student(), token=token(i)) for i in range(1, 251)]
    )
    with django_capture_on_commit_callbacks(execute=True):
        send(api)
    assert [len(batch) for batch in expo.requests] == [100, 100, 50]
    assert latest(api)["sent_count"] == 250


def test_delivery_is_claimed_once(api, expo, django_capture_on_commit_callbacks):
    device(make_student(), 1)
    with django_capture_on_commit_callbacks(execute=True):
        message_id = send(api).json()["id"]
    assert push_services.deliver(message_id) is None  # already sent: a repeated task sends nothing
    assert len(expo.sent) == 1


def test_history_filters(api, expo, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        send(api)
    PushMessage.objects.create(kind="exam_reminder", title_en="R", body_en="r", status="sent")
    rows = lambda q: api.get(f"{ADMIN}messages/{q}").json()["results"]  # noqa: E731
    assert len(rows("")) == 2
    assert [r["kind"] for r in rows("?kind=manual")] == ["manual"]
    assert [r["kind"] for r in rows("?status=sent&kind=exam_reminder")] == ["exam_reminder"]
    assert api.get(f"{ADMIN}messages/?kind=bogus").status_code == 400


def test_only_admins_can_use_the_admin_endpoints(expo):
    student = jwt_client(make_student())
    for client in (APIClient(), student):
        assert client.get(ADMIN).status_code in (401, 403)
        assert client.post(
            f"{ADMIN}messages/", {"title_en": "x", "body_en": "y"}, format="json"
        ).status_code in (401, 403)


# --------------------------------------------------------------------------------------
# The Expo request itself
# --------------------------------------------------------------------------------------
class _Response:
    def __init__(self, body):
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self, _n=-1):
        return self._body


def test_the_request_to_expo(settings):
    settings.PUSH_ENABLED = True
    settings.EXPO_ACCESS_TOKEN = "secret-access-token"
    captured = {}

    def fake_urlopen(request, timeout):
        captured["url"], captured["headers"], captured["body"], captured["timeout"] = (
            request.full_url,
            dict(request.header_items()),
            json.loads(request.data),
            timeout,
        )
        return _Response(json.dumps({"data": [{"status": "ok", "id": "x"}]}).encode())

    with mock.patch("urllib.request.urlopen", fake_urlopen):
        tickets = push.post_messages([{"to": token(1), "title": "t", "body": "b"}])
    assert tickets == [{"status": "ok", "id": "x"}]
    assert captured["url"] == "https://exp.host/--/api/v2/push/send"
    assert captured["headers"]["Authorization"] == "Bearer secret-access-token"
    assert captured["timeout"] == settings.PUSH_TIMEOUT_SECONDS
    assert captured["body"][0]["to"] == token(1)


def test_no_authorization_header_without_a_configured_token(settings):
    settings.EXPO_ACCESS_TOKEN = ""
    seen = {}

    def fake_urlopen(request, timeout):
        seen["headers"] = dict(request.header_items())
        return _Response(b'{"data":[{"status":"ok"}]}')

    with mock.patch("urllib.request.urlopen", fake_urlopen):
        push.post_messages([{"to": token(1)}])
    assert "Authorization" not in seen["headers"]


@pytest.mark.parametrize("answer", [b"not json", b'{"data":[]}', b'{"data":"x"}', b"[]"])
def test_an_unusable_answer_is_a_transport_error(answer):
    with mock.patch("urllib.request.urlopen", lambda r, timeout: _Response(answer)):
        with pytest.raises(push.PushTransportError):
            push.post_messages([{"to": token(1)}])


def test_only_https_and_bounded_batches(settings):
    settings.EXPO_PUSH_URL = "http://exp.host/send"
    with pytest.raises(push.PushTransportError):
        push.post_messages([{"to": token(1)}])
    settings.EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
    with pytest.raises(push.PushTransportError):
        push.post_messages([])
    with pytest.raises(push.PushTransportError):
        push.post_messages([{"to": token(i)} for i in range(101)])


def test_the_token_never_reaches_the_logs(api, expo, caplog, django_capture_on_commit_callbacks):
    device(make_student(), 1)
    with caplog.at_level("DEBUG"), django_capture_on_commit_callbacks(execute=True):
        send(api)
    assert token(1) not in caplog.text


# --------------------------------------------------------------------------------------
# Automatic exam reminders
# --------------------------------------------------------------------------------------
def timed_exam(minutes_from_now, **extra):
    from apps.catalog.models import Subject

    subject = Subject.objects.filter(slug="physics").first() or make_subject()
    exam = make_exam(subject, **extra)
    exam.start_at = timezone.now() + timedelta(minutes=minutes_from_now)
    exam.end_at = exam.start_at + timedelta(hours=2)
    exam.exam_type = "live"
    exam.save()
    from apps.exams import services as exam_services

    exam_services.publish_exam(exam.pk, ctx=CTX)
    exam.refresh_from_db()
    return exam


def test_a_reminder_goes_out_once_when_its_time_comes(expo, settings):
    settings.EXAM_REMINDER_OFFSETS_MINUTES = [60]
    device(make_student(preferred_language="en"), 1)
    exam = timed_exam(58)
    assert push_services.send_due_reminders() == 1
    message = PushMessage.objects.get()
    assert (
        message.kind == PushKind.EXAM_REMINDER
        and message.exam == exam
        and message.reminder_offset == 60
    )
    assert message.status == PushStatus.SENT
    sent = expo.sent[0]
    assert sent["title"] == "Exam reminder" and "starts in 1 hour" in sent["body"]
    assert sent["data"] == {"type": "exam", "exam_slug": exam.slug}
    assert push_services.send_due_reminders() == 0  # not twice
    assert PushMessage.objects.count() == 1


def test_a_reminder_waits_for_its_window_and_skips_what_is_past(expo, settings):
    settings.EXAM_REMINDER_OFFSETS_MINUTES = [60]
    timed_exam(180)  # too early
    timed_exam(30)  # the reminder moment has gone by (it was due 30 minutes ago)
    assert push_services.send_due_reminders() == 0


def test_each_offset_sends_its_own_reminder(expo, settings):
    settings.EXAM_REMINDER_OFFSETS_MINUTES = [1440, 60]
    exam = timed_exam(60 * 24 - 2)
    assert push_services.send_due_reminders() == 1
    assert PushMessage.objects.get().reminder_offset == 1440
    exam.start_at = timezone.now() + timedelta(minutes=58)
    exam.save()
    assert push_services.send_due_reminders() == 1
    assert sorted(PushMessage.objects.values_list("reminder_offset", flat=True)) == [60, 1440]


def test_draft_exams_get_no_reminder(expo, settings):
    settings.EXAM_REMINDER_OFFSETS_MINUTES = [60]
    exam = timed_exam(58)
    exam.status = "draft"
    exam.save()
    assert push_services.send_due_reminders() == 0


def test_reminders_do_nothing_while_push_is_off(settings):
    settings.PUSH_ENABLED = False
    settings.EXAM_REMINDER_OFFSETS_MINUTES = [60]
    timed_exam(58)
    assert push_services.send_due_reminders() == 0
    assert not PushMessage.objects.exists()


def test_no_offsets_means_no_reminders(expo, settings):
    settings.EXAM_REMINDER_OFFSETS_MINUTES = []
    timed_exam(58)
    assert push_services.send_due_reminders() == 0


@pytest.mark.parametrize(
    ("minutes", "en", "bn"),
    [
        (1440, "starts in 1 day", "১ দিন পরে"),
        (2880, "starts in 2 days", "২ দিন পরে"),
        (60, "starts in 1 hour", "১ ঘণ্টা পরে"),
        (180, "starts in 3 hours", "৩ ঘণ্টা পরে"),
        (10, "starts in 10 minutes", "১০ মিনিট পরে"),
        (1, "starts in 1 minute", "১ মিনিট পরে"),
    ],
)
def test_reminder_wording(minutes, en, bn):
    exam = mock.Mock(title_en="Physics test", title_bn="পদার্থবিজ্ঞান")
    text = push_services.reminder_text(exam, minutes)
    assert en in text["body_en"] and bn in text["body_bn"]


# --------------------------------------------------------------------------------------
# New exam announcements
# --------------------------------------------------------------------------------------
def published_now(**fields):
    exam = timed_exam(600)  # make_exam(publish=True): its first-publish time is "now"
    for name, value in fields.items():
        setattr(exam, name, value)
    if fields:
        exam.save()
    return exam


def test_publishing_stamps_the_first_publish_time_only_once():
    from apps.exams import services as exam_services
    from tests.test_exams import CTX

    exam = timed_exam(600)
    first = exam.first_published_at
    assert first is not None
    exam_services.unpublish_exam(exam.pk, ctx=CTX)
    exam_services.publish_exam(exam.pk, ctx=CTX)
    exam.refresh_from_db()
    assert exam.first_published_at == first  # publishing again is not "new"


def test_a_new_exam_is_announced_once_and_opens_the_exam(expo):
    device(make_student(preferred_language="bn"), 1)
    device(make_student(preferred_language="en"), 2)
    exam = published_now()
    assert push_services.send_new_exam_announcements() == 1
    message = PushMessage.objects.get()
    assert message.kind == PushKind.NEW_EXAM and message.exam == exam
    assert message.status == PushStatus.SENT
    titles = sorted(sent["title"] for sent in expo.sent)
    assert titles == ["New exam", "নতুন পরীক্ষা"]
    assert all(sent["data"] == {"type": "exam", "exam_slug": exam.slug} for sent in expo.sent)
    assert push_services.send_new_exam_announcements() == 0  # not twice
    assert PushMessage.objects.count() == 1


def test_old_draft_ended_and_already_started_long_ago_exams_are_not_announced(expo, settings):
    settings.NEW_EXAM_ANNOUNCE_WINDOW_MINUTES = 30
    published_now(first_published_at=timezone.now() - timedelta(hours=2))  # not new any more
    published_now(first_published_at=None)  # published before this feature existed
    published_now(status="draft")
    published_now(
        start_at=timezone.now() - timedelta(days=2), end_at=timezone.now() - timedelta(days=1)
    )
    assert push_services.send_new_exam_announcements() == 0
    assert not PushMessage.objects.exists()


def test_new_exam_announcements_can_be_switched_off_and_need_push(expo, settings):
    published_now()
    settings.PUSH_ANNOUNCE_NEW_EXAMS = False
    assert push_services.send_new_exam_announcements() == 0
    settings.PUSH_ANNOUNCE_NEW_EXAMS = True
    settings.PUSH_ENABLED = False
    assert push_services.send_new_exam_announcements() == 0
    assert not PushMessage.objects.exists()


def test_the_scheduler_task_sends_reminders_and_announcements(expo, settings):
    from apps.notifications.tasks import send_exam_reminders_task

    settings.EXAM_REMINDER_OFFSETS_MINUTES = [60]
    timed_exam(58)  # due for a reminder and newly published: two messages
    assert send_exam_reminders_task() == 2
    kinds = sorted(PushMessage.objects.values_list("kind", flat=True))
    assert kinds == ["exam_reminder", "new_exam"]


def test_the_history_can_be_filtered_to_new_exam_announcements(api, expo):
    published_now()
    push_services.send_new_exam_announcements()
    rows = api.get(f"{ADMIN}messages/?kind=new_exam").json()["results"]
    assert len(rows) == 1 and rows[0]["kind"] == "new_exam"
