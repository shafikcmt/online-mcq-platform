"""JWT issuing, rotation and revocation (djangorestframework-simplejwt).

Claims are minimal: ``token_type``, ``exp``, ``iat``, ``jti``, ``user_id`` and
``auth_version`` — no mobile number, email or name.

Differences from simplejwt's defaults, on purpose:
- ``OutstandingToken.token`` is stored EMPTY: only the ``jti`` is needed to blacklist,
  so a database leak does not hand out usable refresh tokens.
- Rotation locks the token row, so two simultaneous refreshes of the same token
  produce exactly one new pair.
- Every refresh re-checks the user (exists, active, student) and ``auth_version``.

Dependency on simplejwt internals (pinned to 5.5.1 in requirements/base.txt):
we use its ``token_blacklist`` models directly instead of ``RefreshToken.for_user`` /
``TokenRefreshSerializer``. This relies on: blacklist lookups being by ``jti``
(``BlacklistedToken.token`` → ``OutstandingToken``), ``flushexpiredtokens`` deleting by
``expires_at``, and nothing in the library rebuilding a JWT from
``OutstandingToken.token``. Re-check these (and the TestJtiOnlyStorage tests) before
upgrading simplejwt.
"""

import logging

from django.db import transaction
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.utils import datetime_from_epoch

from .models import User

logger = logging.getLogger(__name__)


class InvalidRefreshToken(Exception):
    """Unknown, expired, blacklisted, revoked or otherwise unusable refresh token."""


def issue_tokens(user: User) -> dict[str, str]:
    refresh = RefreshToken()
    refresh["user_id"] = user.pk
    refresh["auth_version"] = user.auth_version
    OutstandingToken.objects.create(
        user=user,
        jti=refresh["jti"],
        token="",  # never store the token itself
        created_at=refresh.current_time,
        expires_at=datetime_from_epoch(refresh["exp"]),
    )
    return {"access": str(refresh.access_token), "refresh": str(refresh)}


def _parse_refresh(raw: str) -> RefreshToken:
    try:
        return RefreshToken(raw)  # signature, expiry, type and blacklist are checked here
    except TokenError as exc:
        raise InvalidRefreshToken from exc


def _usable_user(token: RefreshToken) -> User:
    user = User.objects.filter(pk=token.get("user_id")).first()
    if (
        user is None
        or not user.is_active
        or not user.is_student
        or token.get("auth_version") != user.auth_version
    ):
        raise InvalidRefreshToken
    return user


def _blacklist_locked(jti: str) -> None:
    """Blacklist inside the caller's transaction; fail if already blacklisted/unknown."""
    outstanding = OutstandingToken.objects.select_for_update().filter(jti=jti).first()
    if outstanding is None or BlacklistedToken.objects.filter(token=outstanding).exists():
        raise InvalidRefreshToken
    BlacklistedToken.objects.create(token=outstanding)


def rotate_refresh_token(raw: str) -> dict[str, str]:
    """Exchange a refresh token for a new access + refresh pair; the old one dies."""
    token = _parse_refresh(raw)
    with transaction.atomic():
        user = _usable_user(token)
        _blacklist_locked(token["jti"])
        tokens = issue_tokens(user)
    return tokens


def blacklist_refresh_token(raw: str, *, user: User) -> None:
    """Logout: blacklist a refresh token that must belong to ``user``."""
    token = _parse_refresh(raw)
    if token.get("user_id") != user.pk:
        raise InvalidRefreshToken
    with transaction.atomic():
        _blacklist_locked(token["jti"])


def revoke_all_refresh_tokens(user: User) -> int:
    """Blacklist every outstanding refresh token of ``user`` (all devices)."""
    pending = OutstandingToken.objects.filter(user=user).exclude(
        pk__in=BlacklistedToken.objects.values("token_id")
    )
    created = BlacklistedToken.objects.bulk_create(
        [BlacklistedToken(token=token) for token in pending], ignore_conflicts=True
    )
    return len(created)
