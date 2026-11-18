"""Authentication API (Milestone 2C) — student accounts only.

Admin Panel authentication is designed separately in Milestone 7.
"""

import logging

from django.conf import settings
from django.contrib.auth import authenticate
from django.contrib.auth.models import update_last_login
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.translation import gettext_lazy as _
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.services import AuditContext
from apps.core.exceptions import ApiError
from apps.core.net import get_client_ip
from apps.core.phone import mask_mobile, try_normalize_bd_mobile
from apps.verification import services as verification
from apps.verification.exceptions import OtpRateLimited, VerificationError
from apps.verification.models import OtpPurpose

from .. import services, tokens
from ..exceptions import AccountError, InvalidCredentials
from ..tasks import deliver_password_reset_otp
from . import serializers as s
from .errors import from_account_error, from_verification_error
from .throttles import (
    LoginIpThrottle,
    LoginThrottle,
    OtpVerifyThrottle,
    PasswordChangeThrottle,
    PasswordResetThrottle,
    RegisterThrottle,
    TokenRefreshThrottle,
)

logger = logging.getLogger(__name__)

# The same answer for every accepted OTP request — real account or not.
OTP_ACCEPTED_MESSAGE = _("If the details are valid, a verification code will be sent by SMS.")
TOKEN_INVALID_MESSAGE = _("Token is invalid or expired")


def _password_errors(field: str, exc: DjangoValidationError):
    return serializers.ValidationError({field: list(exc.messages)})


def _token_invalid():
    return ApiError(
        status_code=status.HTTP_401_UNAUTHORIZED,
        code="token_not_valid",
        message=TOKEN_INVALID_MESSAGE,
    )


class PublicAuthView(APIView):
    """No authentication for public auth endpoints: a stale token must not block them."""

    authentication_classes = []
    permission_classes = [AllowAny]


# --------------------------------------------------------------------------------------
# OTP
# --------------------------------------------------------------------------------------
class OtpRequestView(PublicAuthView):
    @extend_schema(
        request=s.OtpRequestSerializer, responses={202: s.AcceptedSerializer}, tags=["auth"]
    )
    def post(self, request):
        data = s.OtpRequestSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        mobile = data.validated_data["mobile_number"]
        purpose = data.validated_data["purpose"]
        language = data.validated_data.get("language") or request.LANGUAGE_CODE
        ip = get_client_ip(request)
        try:
            if purpose == OtpPurpose.PASSWORD_RESET:
                # Identical work for every number: abuse checks + one queued task. The
                # worker decides whether an account exists; this request never looks.
                mobile = verification.check_otp_request(mobile, purpose, request_ip=ip)
                deliver_password_reset_otp.apply_async(
                    args=(mobile, language, ip),
                    argsrepr=f"('{mask_mobile(mobile)}', '{language}', '<ip>')",
                )
            else:
                # Registration codes are always sent; "already registered" is only
                # revealed at the register step, to someone who proved they own the phone.
                verification.request_otp(mobile, purpose, language=language, request_ip=ip)
        except VerificationError as exc:
            if purpose == OtpPurpose.PASSWORD_RESET and isinstance(exc, OtpRateLimited):
                # Real accounts are limited by database history (sliding window), unknown
                # numbers by Redis (fixed window): report one coarse value for both.
                exc.retry_after = max(
                    settings.OTP_REQUEST_WINDOW_SECONDS, settings.OTP_IP_REQUEST_WINDOW_SECONDS
                )
            raise from_verification_error(exc) from exc
        return Response({"detail": str(OTP_ACCEPTED_MESSAGE)}, status=status.HTTP_202_ACCEPTED)


class OtpVerifyView(PublicAuthView):
    throttle_classes = [OtpVerifyThrottle]

    @extend_schema(
        request=s.OtpVerifySerializer, responses={200: s.OtpVerifyResponseSerializer}, tags=["auth"]
    )
    def post(self, request):
        data = s.OtpVerifySerializer(data=request.data)
        data.is_valid(raise_exception=True)
        purpose = data.validated_data["purpose"]
        try:
            result = verification.verify_otp(
                data.validated_data["mobile_number"], purpose, data.validated_data["code"]
            )
        except VerificationError as exc:
            raise from_verification_error(
                exc, generic=purpose == OtpPurpose.PASSWORD_RESET
            ) from exc
        return Response(
            {"verification_token": result.verification_token, "expires_at": result.expires_at}
        )


# --------------------------------------------------------------------------------------
# Registration & login
# --------------------------------------------------------------------------------------
class RegisterView(PublicAuthView):
    throttle_classes = [RegisterThrottle]

    @extend_schema(
        request=s.RegisterSerializer, responses={201: s.AuthResponseSerializer}, tags=["auth"]
    )
    def post(self, request):
        data = s.RegisterSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        try:
            user, issued = services.register_student(
                verification_token=v["verification_token"],
                mobile_number=v["mobile_number"],
                full_name=v["full_name"],
                password=v["password"],
                email=v.get("email") or None,
                preferred_language=v.get("preferred_language"),
            )
        except DjangoValidationError as exc:
            if hasattr(exc, "error_dict"):
                raise serializers.ValidationError(exc.message_dict) from exc
            raise _password_errors("password", exc) from exc
        except VerificationError as exc:
            raise from_verification_error(exc) from exc
        except AccountError as exc:
            raise from_account_error(exc) from exc
        return Response(
            {"user": s.ProfileSerializer(user).data, **issued}, status=status.HTTP_201_CREATED
        )


class LoginView(PublicAuthView):
    throttle_classes = [LoginIpThrottle, LoginThrottle]

    @extend_schema(
        request=s.LoginSerializer, responses={200: s.AuthResponseSerializer}, tags=["auth"]
    )
    def post(self, request):
        data = s.LoginSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        mobile = try_normalize_bd_mobile(data.validated_data["mobile_number"])
        # Unknown number, wrong password, inactive account and non-student accounts all
        # end here with the same answer. ModelBackend also hashes a dummy password for
        # unknown users, so response time does not reveal which case happened.
        user = authenticate(request, mobile_number=mobile, password=data.validated_data["password"])
        if user is None or not user.is_student:
            logger.warning("Login failed mobile=%s", mask_mobile(mobile))
            raise from_account_error(InvalidCredentials())
        update_last_login(None, user)
        logger.info("Login succeeded user_id=%s", user.pk)
        return Response({"user": s.ProfileSerializer(user).data, **tokens.issue_tokens(user)})


class TokenRefreshView(PublicAuthView):
    throttle_classes = [TokenRefreshThrottle]

    @extend_schema(
        request=s.RefreshSerializer, responses={200: s.TokenPairSerializer}, tags=["auth"]
    )
    def post(self, request):
        data = s.RefreshSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            return Response(tokens.rotate_refresh_token(data.validated_data["refresh"]))
        except tokens.InvalidRefreshToken as exc:
            raise _token_invalid() from exc


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=s.RefreshSerializer, responses={204: None}, tags=["auth"])
    def post(self, request):
        data = s.RefreshSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            tokens.blacklist_refresh_token(data.validated_data["refresh"], user=request.user)
        except tokens.InvalidRefreshToken as exc:
            raise _token_invalid() from exc
        return Response(status=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------------------
# Passwords
# --------------------------------------------------------------------------------------
class PasswordResetView(PublicAuthView):
    throttle_classes = [PasswordResetThrottle]

    @extend_schema(request=s.PasswordResetSerializer, responses={204: None}, tags=["auth"])
    def post(self, request):
        data = s.PasswordResetSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        try:
            services.reset_password(
                verification_token=v["verification_token"],
                mobile_number=v["mobile_number"],
                new_password=v["new_password"],
            )
        except DjangoValidationError as exc:
            raise _password_errors("new_password", exc) from exc
        except VerificationError as exc:
            raise from_verification_error(exc) from exc
        return Response(status=status.HTTP_204_NO_CONTENT)


class PasswordChangeView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [PasswordChangeThrottle]

    @extend_schema(request=s.PasswordChangeSerializer, responses={204: None}, tags=["auth"])
    def post(self, request):
        data = s.PasswordChangeSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            services.change_password(
                request.user,
                current_password=data.validated_data["current_password"],
                new_password=data.validated_data["new_password"],
            )
        except DjangoValidationError as exc:
            raise _password_errors("new_password", exc) from exc
        except AccountError as exc:
            raise from_account_error(exc) from exc
        return Response(status=status.HTTP_204_NO_CONTENT)


class AccountDeleteView(APIView):
    """``POST``: the signed-in student deletes (anonymises) their own account.

    Needs the current password. Irreversible; ends every session. Answers 204."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [PasswordChangeThrottle]
    http_method_names = ["post", "options"]

    @extend_schema(request=s.AccountDeleteSerializer, responses={204: None}, tags=["me"])
    def post(self, request):
        data = s.AccountDeleteSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            services.delete_account(
                request.user,
                current_password=data.validated_data["current_password"],
                ctx=AuditContext.from_request(request),
            )
        except AccountError as exc:
            raise from_account_error(exc) from exc
        return Response(status=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------------------
# Profile
# --------------------------------------------------------------------------------------
class MeView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: s.ProfileSerializer}, tags=["me"])
    def get(self, request):
        return Response(s.ProfileSerializer(request.user).data)

    @extend_schema(
        request=s.ProfileUpdateSerializer, responses={200: s.ProfileSerializer}, tags=["me"]
    )
    def patch(self, request):
        data = s.ProfileUpdateSerializer(data=request.data, partial=True)
        data.is_valid(raise_exception=True)
        try:
            user = services.update_profile(request.user, data.validated_data)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict) from exc
        except AccountError as exc:
            raise from_account_error(exc) from exc
        return Response(s.ProfileSerializer(user).data)
