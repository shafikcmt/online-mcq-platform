# ruff: noqa: F811 -- imported pytest fixtures are re-named as test arguments
"""A student deletes their own account: personal data goes; exam and payment records stay."""

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.accounts import services as account_services
from apps.accounts.models import StudentProfile
from apps.audit.models import AuditLog
from apps.notifications.models import PushDevice
from apps.results import services as result_services
from apps.results.models import Result
from apps.verification.models import OtpCode
from tests.test_attempts import make_student
from tests.test_cms import admin_user, api  # noqa: F401
from tests.test_results import published, take
from tests.test_subscriptions import PW, jwt_client

User = get_user_model()
pytestmark = pytest.mark.django_db
URL = "/api/v1/auth/account/delete/"


def delete(user, password=PW):
    return jwt_client(user).post(URL, {"current_password": password}, format="json")


def test_the_account_is_anonymised_and_cannot_be_used_again():
    student = make_student(full_name="Rahim Uddin", email="rahim@example.org")
    old_number = student.mobile_number
    StudentProfile.objects.filter(user=student).update(display_name="Rahim")
    PushDevice.objects.create(user=student, token="ExponentPushToken[abcdefghij0000000001]")
    client = jwt_client(student)
    assert delete(student).status_code == 204
    student.refresh_from_db()
    assert student.full_name == "Deleted user" and student.email is None
    assert student.mobile_number != old_number and student.mobile_number.startswith("+990")
    assert not student.is_active and not student.is_mobile_verified
    assert not student.has_usable_password()
    assert StudentProfile.objects.get(user=student).display_name == ""
    assert not PushDevice.objects.filter(user=student).exists()
    # Every session ended: the old access token no longer works, nor does signing in.
    assert client.get("/api/v1/me/").status_code == 401
    assert (
        APIClient()
        .post("/api/v1/auth/login/", {"mobile_number": old_number, "password": PW}, format="json")
        .status_code
        == 401
    )


def test_the_old_number_can_register_again_and_the_placeholder_is_unique_per_user():
    first, second = make_student(), make_student()
    old = first.mobile_number
    assert delete(first).status_code == 204 and delete(second).status_code == 204
    first.refresh_from_db()
    second.refresh_from_db()
    assert first.mobile_number != second.mobile_number
    again = User.objects.create_user(old, password=PW, full_name="New person")
    assert again.pk != first.pk


def test_a_wrong_password_deletes_nothing():
    student = make_student(full_name="Rahim Uddin")
    response = delete(student, "not-the-password")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_current_password"
    student.refresh_from_db()
    assert student.full_name == "Rahim Uddin" and student.is_active


def test_the_password_is_required():
    student = make_student()
    assert jwt_client(student).post(URL, {}, format="json").status_code == 400
    assert APIClient().post(URL, {"current_password": PW}, format="json").status_code == 401


def test_an_admin_account_cannot_be_deleted_this_way():
    admin = User.objects.create_user("01799999901", password=PW, full_name="Admin", role="admin")
    # The student API does not even accept an admin's token (401); the service refuses too.
    assert delete(admin).status_code in (401, 403, 409)
    from tests.test_cms import CTX

    with pytest.raises(account_services.NotAStudent):
        account_services.delete_account(admin, current_password=PW, ctx=CTX)
    admin.refresh_from_db()
    assert admin.is_active and admin.full_name == "Admin"


def test_results_and_merit_stay_and_carry_no_name(settings):
    exam_row = published_exam_with_merit()
    exam, students = exam_row
    before = list(
        Result.objects.filter(exam=exam)
        .order_by("merit_position")
        .values_list("merit_position", flat=True)
    )
    assert delete(students[0]).status_code == 204
    after = list(
        Result.objects.filter(exam=exam)
        .order_by("merit_position")
        .values_list("merit_position", flat=True)
    )
    assert after == before  # nobody else's position moves
    row = Result.objects.get(exam=exam, user=students[0])
    assert row.user.full_name == "Deleted user"


def published_exam_with_merit():
    from tests.test_exams import make_subject

    exam = published(make_subject())
    students = [make_student(full_name=f"Real{i} Student") for i in range(3)]
    for i, student in enumerate(students):
        take(student, exam, "c" * (i + 1) + "-" * (2 - i))
    result_services.generate_merit(exam.pk)
    return exam, students


def test_pending_codes_for_the_old_number_are_erased_and_the_audit_has_no_personal_data():
    student = make_student(full_name="Rahim Uddin")
    from django.utils import timezone

    OtpCode.objects.create(
        mobile_number=student.mobile_number,
        purpose="password_reset",
        language="bn",
        expires_at=timezone.now(),
    )
    old = student.mobile_number
    assert delete(student).status_code == 204
    assert not OtpCode.objects.filter(mobile_number=old).exists()
    entry = AuditLog.objects.get(action="user.delete_account")
    assert entry.entity_id == str(student.pk) and entry.actor_id == student.pk
    dumped = f"{entry.summary} {entry.metadata}"
    assert "Rahim" not in dumped and old not in dumped


def test_service_is_all_or_nothing_for_a_wrong_password():
    student = make_student(full_name="Keep Me")
    from tests.test_cms import CTX

    with pytest.raises(account_services.InvalidCurrentPassword):
        account_services.delete_account(student, current_password="x", ctx=CTX)
    student.refresh_from_db()
    assert student.full_name == "Keep Me"


# --------------------------------------------------------------------------------------


# --------------------------------------------------------------------------------------
# An admin erases a student's data on request
# --------------------------------------------------------------------------------------
ADMIN_URL = "/api/v1/admin/users/{pk}/anonymise/"


def test_an_admin_erases_a_students_personal_data_on_request(api):
    student = make_student(full_name="Rahim Uddin", email="rahim@example.org")
    old = student.mobile_number
    response = api.post(ADMIN_URL.format(pk=student.pk), {"confirm": True}, format="json")
    assert response.status_code == 200, response.content
    student.refresh_from_db()
    assert student.full_name == "Deleted user" and student.email is None and not student.is_active
    assert student.mobile_number != old and not student.has_usable_password()
    entry = AuditLog.objects.get(action="user.anonymise")
    assert entry.entity_id == str(student.pk)
    assert "Rahim" not in f"{entry.summary} {entry.metadata}"
    # Asking again changes nothing and adds no second audit entry.
    assert (
        api.post(ADMIN_URL.format(pk=student.pk), {"confirm": True}, format="json").status_code
        == 200
    )
    assert AuditLog.objects.filter(action="user.anonymise").count() == 1


def test_the_admin_must_confirm_and_staff_are_refused(api, admin_user):
    student = make_student(full_name="Keep Me")
    for body in ({}, {"confirm": False}):
        assert api.post(ADMIN_URL.format(pk=student.pk), body, format="json").status_code == 400
    student.refresh_from_db()
    assert student.full_name == "Keep Me"
    refused = api.post(ADMIN_URL.format(pk=admin_user.pk), {"confirm": True}, format="json")
    assert refused.status_code == 409
    admin_user.refresh_from_db()
    assert admin_user.is_active
    assert (
        api.post(ADMIN_URL.format(pk=999999), {"confirm": True}, format="json").status_code == 404
    )


def test_only_an_admin_may_use_it():
    student = make_student()
    other = make_student()
    assert jwt_client(other).post(
        ADMIN_URL.format(pk=student.pk), {"confirm": True}, format="json"
    ).status_code in (401, 403)
    assert APIClient().post(
        ADMIN_URL.format(pk=student.pk), {"confirm": True}, format="json"
    ).status_code in (
        401,
        403,
    )
