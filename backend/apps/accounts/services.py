"""Account use cases behind the authentication API (Milestone 2C).

Every function that changes credentials runs in one database transaction, so a
failure leaves no half-done state (e.g. a consumed verification token without an
account, or a new password without revoked sessions).
"""

import logging

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import F
from django.http import Http404

from apps.audit import services as audit
from apps.audit.services import AuditContext
from apps.core.phone import mask_mobile
from apps.verification.models import OtpPurpose
from apps.verification.services import consume_verification_token

from . import tokens
from .exceptions import AccountExists, EmailTaken, InvalidCurrentPassword, NotAStudent
from .models import Role, StudentProfile, User

logger = logging.getLogger(__name__)

EMAIL_CONSTRAINT = "accounts_user_email_unique_ci"


def _integrity_error_to_account_error(exc: IntegrityError) -> Exception:
    constraint = getattr(getattr(exc.__cause__, "diag", None), "constraint_name", "") or ""
    if constraint == EMAIL_CONSTRAINT or EMAIL_CONSTRAINT in str(exc):
        return EmailTaken(field="email")
    return AccountExists()


def active_student_exists(mobile_number: str) -> bool:
    return User.objects.filter(
        mobile_number=mobile_number, is_active=True, role=Role.STUDENT
    ).exists()


# --------------------------------------------------------------------------------------
# Registration
# --------------------------------------------------------------------------------------
def register_student(
    *,
    verification_token: str,
    mobile_number: str,
    full_name: str,
    password: str,
    email: str | None = None,
    preferred_language: str | None = None,
) -> tuple[User, dict[str, str]]:
    """Create a verified student account from a ``registration`` verification token.

    ``mobile_number`` must already be normalized. Role, staff flags and verification
    status are never taken from the client.
    """
    # Validate the password first so a weak password does not burn the token.
    candidate = User(mobile_number=mobile_number, full_name=full_name, email=email)
    validate_password(password, candidate)

    extra = {"email": email or None, "is_mobile_verified": True}
    if preferred_language:
        extra["preferred_language"] = preferred_language

    with transaction.atomic():
        consume_verification_token(verification_token, mobile_number, OtpPurpose.REGISTRATION)
        if User.objects.filter(mobile_number=mobile_number).exists():
            raise AccountExists()  # rolls back: the token stays unused
        try:
            with transaction.atomic():  # savepoint: a lost race must not poison the outer block
                user = User.objects.create_user(
                    mobile_number, password=password, full_name=full_name, **extra
                )
        except IntegrityError as exc:
            raise _integrity_error_to_account_error(exc) from exc
        except ValidationError as exc:
            if "mobile_number" in exc.message_dict:
                raise AccountExists() from exc
            # The case-insensitive email constraint is expression-based → "__all__".
            if "__all__" in exc.message_dict:
                raise EmailTaken(field="email") from exc
            raise
        issued = tokens.issue_tokens(user)

    logger.info("Student registered user_id=%s mobile=%s", user.pk, mask_mobile(mobile_number))
    return user, issued


# --------------------------------------------------------------------------------------
# Passwords
# --------------------------------------------------------------------------------------
def _set_password_and_revoke(user: User, new_password: str) -> None:
    """Set the password, bump ``auth_version`` and blacklist every refresh token."""
    user.set_password(new_password)
    user.auth_version = F("auth_version") + 1
    user.save(update_fields=["password", "auth_version", "updated_at"])
    user.refresh_from_db(fields=["auth_version"])
    tokens.revoke_all_refresh_tokens(user)


def reset_password(*, verification_token: str, mobile_number: str, new_password: str) -> None:
    """Set a new password using a ``password_reset`` verification token.

    Raises ``VerificationTokenInvalid`` for any token problem — including a number that
    has no active student account — so nothing reveals whether an account exists.
    """
    from apps.verification.exceptions import VerificationTokenInvalid

    with transaction.atomic():
        user = (
            User.objects.select_for_update()
            .filter(mobile_number=mobile_number, is_active=True, role=Role.STUDENT)
            .first()
        )
        if user is None:
            raise VerificationTokenInvalid()
        validate_password(new_password, user)  # before consuming: a weak password can retry
        consume_verification_token(verification_token, mobile_number, OtpPurpose.PASSWORD_RESET)
        _set_password_and_revoke(user, new_password)
    logger.info("Password reset user_id=%s", user.pk)


def change_password(user: User, *, current_password: str, new_password: str) -> None:
    """Change the password and log out every device, including the current one."""
    with transaction.atomic():
        locked = User.objects.select_for_update().get(pk=user.pk)
        if not locked.check_password(current_password):
            raise InvalidCurrentPassword(field="current_password")
        validate_password(new_password, locked)
        _set_password_and_revoke(locked, new_password)
    logger.info("Password changed user_id=%s", user.pk)


# --------------------------------------------------------------------------------------
# Profile
# --------------------------------------------------------------------------------------
PROFILE_USER_FIELDS = ("full_name", "email", "preferred_language")


def update_profile(user: User, data: dict) -> User:
    """Update only the approved profile fields."""
    with transaction.atomic():
        locked = User.objects.select_for_update().get(pk=user.pk)
        changed = [name for name in PROFILE_USER_FIELDS if name in data]
        for name in changed:
            setattr(locked, name, data[name] if name != "email" else (data[name] or None))
        if changed:
            try:
                locked.full_clean(exclude=["password"])
                with transaction.atomic():
                    locked.save(update_fields=[*changed, "updated_at"])
            except ValidationError as exc:
                if "__all__" in exc.message_dict:  # case-insensitive email constraint
                    raise EmailTaken(field="email") from exc
                raise
            except IntegrityError as exc:
                raise _integrity_error_to_account_error(exc) from exc
        if "display_name" in data:
            profile, _created = StudentProfile.objects.get_or_create(user=locked)
            profile.display_name = data["display_name"] or ""
            profile.save(update_fields=["display_name", "updated_at"])
    return locked


DELETED_NAME = "Deleted user"


def deleted_mobile_number(pk: int) -> str:
    """A placeholder number for a deleted account.

    Valid E.164 (so the database check passes), unique per user (it carries the user id) and in the
    unassigned ``+990`` range, so it can never clash with a real person who registers later."""
    return f"+990{pk:011d}"


def delete_account(user: User, *, current_password: str, ctx: AuditContext) -> None:
    """A student deletes their own account (the person can always erase their data).

    The account is anonymised, not removed: the name, mobile number, e-mail and nickname are
    replaced, the password becomes unusable, every session ends, and push devices and pending
    verification codes for the old number are deleted.

    What stays, with no personal detail attached: exam attempts, results and merit positions
    (other students' ranks must not change), payments and subscriptions (accounting records).
    The old mobile number is free to register again.

    Only a student can do this, and only with the current password; admins are never deleted this
    way. Raises ``InvalidCurrentPassword`` or ``NotAStudent``."""
    with transaction.atomic():
        locked = User.objects.select_for_update().get(pk=user.pk)
        if locked.role != Role.STUDENT:
            raise NotAStudent()
        if not locked.check_password(current_password):
            raise InvalidCurrentPassword(field="current_password")
        _erase_personal_data(locked)
        audit.record(
            ctx,
            action="user.delete_account",
            entity_type="accounts.user",
            entity_id=locked.pk,
            summary="student deleted their own account",
            metadata={},
            allowed_fields=(),
        )
    logger.info("Student deleted their account user_id=%s", user.pk)


def anonymise_student(user_id: int, *, ctx: AuditContext) -> User:
    """An admin erases a student's personal data on the student's request.

    For a person who cannot use the app. Exactly what ``delete_account`` does, without the
    password: the admin has checked the request. A student account only (``NotAStudent`` for
    staff). An account that is already erased is returned unchanged."""
    with transaction.atomic():
        locked = User.objects.select_for_update().filter(pk=user_id).first()
        if locked is None:
            raise Http404
        if locked.role != Role.STUDENT:
            raise NotAStudent()
        if locked.full_name == DELETED_NAME and locked.mobile_number == deleted_mobile_number(
            locked.pk
        ):
            return locked
        _erase_personal_data(locked)
        audit.record(
            ctx,
            action="user.anonymise",
            entity_type="accounts.user",
            entity_id=locked.pk,
            summary="student's personal data erased by an admin",
            metadata={},
            allowed_fields=(),
        )
    logger.info("Admin erased a student's personal data user_id=%s", user_id)
    return locked


def _erase_personal_data(locked: User) -> None:
    """Replace the person's details, end every session and delete what only exists to reach them."""
    from apps.notifications.models import PushDevice
    from apps.verification.models import OtpCode

    old_number = locked.mobile_number
    locked.full_name = DELETED_NAME
    locked.mobile_number = deleted_mobile_number(locked.pk)
    locked.email = None
    locked.is_active = False
    locked.is_mobile_verified = False
    locked.set_unusable_password()
    locked.auth_version = F("auth_version") + 1
    locked.save()
    locked.refresh_from_db(fields=["auth_version"])
    tokens.revoke_all_refresh_tokens(locked)
    StudentProfile.objects.filter(user=locked).update(display_name="")
    PushDevice.objects.filter(user=locked).delete()
    OtpCode.objects.filter(
        mobile_number=old_number
    ).delete()  # also removes its verification tokens


def set_student_active(user_id: int, active: bool, *, ctx: AuditContext) -> User:
    """Activate or deactivate a **student** account (Admin Panel → Users).

    Deactivating signs the student out everywhere at once: ``auth_version`` is bumped (so
    every access token stops working, even after a later re-activation) and every refresh
    token is revoked. An inactive account can neither sign in nor refresh (the API refuses
    inactive users on every request). Staff accounts are not handled here
    (``not_a_student``) — so an admin can never lock themselves or another admin out.
    Asking for the state the account already has changes nothing and is not audited.
    Results, payments and subscriptions are kept: a re-activated student finds them again.
    """
    with transaction.atomic():
        user = User.objects.select_for_update().filter(pk=user_id).first()
        if user is None:
            raise Http404
        if user.role != Role.STUDENT:
            raise NotAStudent()
        if user.is_active == active:
            return user
        user.is_active = active
        fields = ["is_active", "updated_at"]
        if not active:
            user.auth_version = F("auth_version") + 1
            fields.append("auth_version")
        user.save(update_fields=fields)
        user.refresh_from_db(fields=["auth_version"])
        if not active:
            tokens.revoke_all_refresh_tokens(user)
        audit.record(
            ctx,
            action="user.activate" if active else "user.deactivate",
            entity_type="accounts.user",
            entity_id=user.pk,
            summary="student account activated" if active else "student account deactivated",
            metadata={"changes": {"is_active": {"from": not active, "to": active}}},
            allowed_fields=("is_active",),
        )
    logger.info("Student account %s user_id=%s", "activated" if active else "deactivated", user.pk)
    return user
