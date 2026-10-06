"""Authentication shared across modules.

``AdminSessionAuthentication`` protects the admin API (``/api/v1/admin/…``):
- Django session cookie + mandatory CSRF token on unsafe methods (POST/PATCH/DELETE);
  GET/HEAD/OPTIONS are read-only and need no CSRF token.
- TEMPORARY, Milestone 3 backend-only workflow: an admin signs in at the internal
  Django admin, and that Django session is used for the admin API. This is NOT the
  final Admin Panel authentication — that is designed in Milestone 7 (its own login
  endpoint, httpOnly cookies + ``X-CSRFToken``, docs/API_PLAN.md §1).
- Student JWTs are never accepted on admin views, and admin sessions are never
  accepted on student views: each area has its own authenticator
  (student API: ``apps.accounts.authentication.StudentJWTAuthentication``).
- Django's session layer drops inactive users and sessions whose password changed.
- The admin role itself is checked by ``apps.core.permissions.IsAdminRole``.
"""

from django.utils import translation
from rest_framework.authentication import SessionAuthentication


def apply_preferred_language(request, user) -> None:
    """Use the user's language when the client did not choose one explicitly
    (docs/LOCALIZATION.md §3.2, step 3)."""
    django_request = getattr(request, "_request", request)
    if not getattr(django_request, "language_is_explicit", True):
        translation.activate(user.preferred_language)
        django_request.LANGUAGE_CODE = user.preferred_language


class AdminSessionAuthentication(SessionAuthentication):
    def authenticate(self, request):
        result = super().authenticate(request)  # enforces CSRF for authenticated users
        if result is not None:
            apply_preferred_language(request, result[0])
        return result

    def authenticate_header(self, request):
        # Any header makes DRF answer 401 (not 403) when no valid session is present.
        return 'Session realm="admin"'
