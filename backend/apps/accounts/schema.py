"""Tell drf-spectacular that the student API uses Bearer JWT (for the API docs page)."""

from drf_spectacular.contrib.rest_framework_simplejwt import SimpleJWTScheme


class StudentJWTScheme(SimpleJWTScheme):
    target_class = "apps.accounts.authentication.StudentJWTAuthentication"
    name = "studentJWT"
