"""Version 1 API routes. Each module adds its own ``include`` here in later milestones."""

from django.urls import include, path

from apps.accounts.api.urls import auth_urlpatterns
from apps.accounts.api.views import MeView
from apps.audit.api.urls import admin_urlpatterns as audit_admin_urlpatterns
from apps.catalog.api.urls import admin_urlpatterns as catalog_admin_urlpatterns
from apps.core.views import HealthView
from apps.questions.api.urls import admin_urlpatterns as question_admin_urlpatterns

app_name = "api_v1"

# Admin API: admin session + CSRF + admin role (apps.core.admin_api.AdminAPIMixin).
admin_urlpatterns = [
    *catalog_admin_urlpatterns,
    *question_admin_urlpatterns,
    *audit_admin_urlpatterns,
]

urlpatterns = [
    path("health/", HealthView.as_view(), name="health"),
    path("auth/", include((auth_urlpatterns, "auth"))),
    path("me/", MeView.as_view(), name="me"),
    path("admin/", include((admin_urlpatterns, "admin"))),
]
