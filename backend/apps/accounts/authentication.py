"""JWT authentication for the student API.

On every request, besides simplejwt's checks (signature, expiry, user exists, active):
- the token's ``auth_version`` must equal ``User.auth_version`` → password reset/change
  invalidates every already-issued access token immediately;
- only student accounts are accepted (Admin Panel auth is designed in Milestone 7);
- if the client did not ask for a language explicitly, the user's preferred language
  is activated for the rest of the request (docs/LOCALIZATION.md §3.2, step 3).
"""

from django.utils import translation
from django.utils.translation import gettext_lazy as _
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed


class StudentJWTAuthentication(JWTAuthentication):
    def get_user(self, validated_token):
        user = super().get_user(validated_token)  # also rejects inactive users
        if validated_token.get("auth_version") != user.auth_version or not user.is_student:
            raise AuthenticationFailed(_("Token is invalid or expired"), code="token_not_valid")
        return user

    def authenticate(self, request):
        result = super().authenticate(request)
        if result is not None:
            user = result[0]
            django_request = getattr(request, "_request", request)
            if not getattr(django_request, "language_is_explicit", True):
                translation.activate(user.preferred_language)
                django_request.LANGUAGE_CODE = user.preferred_language
        return result
