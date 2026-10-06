"""API docs auth schemes: student API = Bearer JWT, admin API = session cookie."""

from django.conf import settings
from drf_spectacular.contrib.rest_framework_simplejwt import SimpleJWTScheme
from drf_spectacular.extensions import OpenApiAuthenticationExtension


class StudentJWTScheme(SimpleJWTScheme):
    target_class = "apps.accounts.authentication.StudentJWTAuthentication"
    name = "studentJWT"


class AdminSessionScheme(OpenApiAuthenticationExtension):
    """Admin API: Django session cookie (+ X-CSRFToken header on unsafe methods)."""

    target_class = "apps.core.authentication.AdminSessionAuthentication"
    name = "adminSession"

    def get_security_definition(self, auto_schema):
        return {"type": "apiKey", "in": "cookie", "name": settings.SESSION_COOKIE_NAME}
