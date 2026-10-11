"""Version 1 API routes. Each module adds its own ``include`` here in later milestones."""

from django.urls import include, path

from apps.accounts.api.urls import auth_urlpatterns
from apps.accounts.api.views import MeView
from apps.attempts.api.urls import student_urlpatterns as attempt_student_urlpatterns
from apps.audit.api.urls import admin_urlpatterns as audit_admin_urlpatterns
from apps.catalog.api.urls import admin_urlpatterns as catalog_admin_urlpatterns
from apps.catalog.api.urls import public_urlpatterns as catalog_public_urlpatterns
from apps.core.views import HealthView
from apps.exams.api.urls import admin_urlpatterns as exam_admin_urlpatterns
from apps.exams.api.urls import public_urlpatterns as exam_public_urlpatterns
from apps.questions.api.urls import admin_urlpatterns as question_admin_urlpatterns
from apps.subscriptions.api.urls import admin_urlpatterns as subscription_admin_urlpatterns
from apps.subscriptions.api.urls import me_urlpatterns as subscription_me_urlpatterns
from apps.subscriptions.api.urls import public_urlpatterns as subscription_public_urlpatterns

app_name = "api_v1"

# Admin API: admin session + CSRF + admin role (apps.core.admin_api.AdminAPIMixin).
admin_urlpatterns = [
    *catalog_admin_urlpatterns,
    *question_admin_urlpatterns,
    *exam_admin_urlpatterns,
    *subscription_admin_urlpatterns,
    *audit_admin_urlpatterns,
]

urlpatterns = [
    path("health/", HealthView.as_view(), name="health"),
    path("auth/", include((auth_urlpatterns, "auth"))),
    path("me/", MeView.as_view(), name="me"),
    # Student JWT; every query is filtered by request.user.
    path("me/", include((subscription_me_urlpatterns, "me"))),
    path("admin/", include((admin_urlpatterns, "admin"))),
    # Student exam engine (student JWT; every query filtered by request.user).
    path("", include((attempt_student_urlpatterns, "attempts"))),
    # Public (no login): website & app. Only published, safe fields — no questions.
    path(
        "public/",
        include(
            (
                [
                    *catalog_public_urlpatterns,
                    *exam_public_urlpatterns,
                    *subscription_public_urlpatterns,
                ],
                "public",
            )
        ),
    ),
]
