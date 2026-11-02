"""Admin Panel sign-in (Milestone 7): Django session cookie (httpOnly) + CSRF token.

- ``GET  /admin/auth/csrf/``   sets the ``csrftoken`` cookie the panel echoes back in
  ``X-CSRFToken`` on every unsafe request (no login needed).
- ``POST /admin/auth/login/``  mobile number + password → session. CSRF-checked (no login
  CSRF), throttled with admin-only buckets (``admin_login_ip`` per IP, ``admin_login`` per
  IP + number — never shared with student logins), **admin role only**; any failure gives
  the same generic answer as the student login. The session id is rotated on login and the
  session expires after ``ADMIN_SESSION_AGE_SECONDS`` (12 h). Audited (``admin.login``,
  with the real client IP when ``TRUSTED_PROXY_COUNT`` matches the proxies in front).
- ``POST /admin/auth/logout/`` ends the session (admin session + CSRF).
- ``GET  /admin/auth/me/``     the signed-in admin (used by the panel to check its session).

Student JWTs are never accepted here, and the admin session is never accepted by the
student API (separate authenticators). No token is ever stored by the browser app.
"""

import logging

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import update_last_login
from django.db import transaction
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit import services as audit
from apps.audit.services import AuditContext
from apps.core.admin_api import AdminAPIMixin
from apps.core.phone import mask_mobile, try_normalize_bd_mobile

from ..exceptions import InvalidCredentials
from . import serializers as s
from .errors import from_account_error
from .throttles import AdminLoginIpThrottle, AdminLoginThrottle

logger = logging.getLogger(__name__)


class AdminProfileSerializer(serializers.Serializer):
    full_name = serializers.CharField()
    mobile_number = serializers.CharField()
    preferred_language = serializers.CharField()
    role = serializers.CharField()


def _profile(user) -> dict:
    return AdminProfileSerializer(
        {
            "full_name": user.full_name,
            "mobile_number": mask_mobile(user.mobile_number),
            "preferred_language": user.preferred_language,
            "role": user.role,
        }
    ).data


@method_decorator(ensure_csrf_cookie, name="dispatch")
class AdminCsrfView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    http_method_names = ["get", "options"]

    @extend_schema(responses={204: None}, tags=["admin-auth"])
    def get(self, request):
        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminLoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [AdminLoginIpThrottle, AdminLoginThrottle]
    http_method_names = ["post", "options"]

    @extend_schema(
        request=s.LoginSerializer, responses={200: AdminProfileSerializer}, tags=["admin-auth"]
    )
    def post(self, request):
        SessionAuthentication().enforce_csrf(request)  # no login CSRF
        data = s.LoginSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        mobile = try_normalize_bd_mobile(data.validated_data["mobile_number"])
        user = authenticate(request, mobile_number=mobile, password=data.validated_data["password"])
        if user is None or not user.is_admin or not user.is_active:
            logger.warning("Admin login failed mobile=%s", mask_mobile(mobile))
            raise from_account_error(InvalidCredentials())
        with transaction.atomic():
            login(request, user)  # rotates the session id and the CSRF token
            # Admin sessions are short-lived (only this session; others keep the default).
            request.session.set_expiry(settings.ADMIN_SESSION_AGE_SECONDS)
            update_last_login(None, user)
            audit.record(
                AuditContext.from_request(request),
                action="admin.login",
                entity_type="accounts.user",
                entity_id=user.pk,
                summary="admin sign-in",
            )
        logger.info("Admin login succeeded user_id=%s", user.pk)
        return Response(_profile(user))


class AdminLogoutView(AdminAPIMixin, APIView):
    http_method_names = ["post", "options"]

    @extend_schema(request=None, responses={204: None}, tags=["admin-auth"])
    def post(self, request):
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminMeView(AdminAPIMixin, APIView):
    http_method_names = ["get", "options"]

    @extend_schema(responses=AdminProfileSerializer, tags=["admin-auth"])
    def get(self, request):
        return Response(_profile(request.user))
