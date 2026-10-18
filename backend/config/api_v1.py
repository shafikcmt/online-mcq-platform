"""Version 1 API routes. Each module adds its own ``include`` here in later milestones."""

from django.urls import include, path

from apps.accounts.api.urls import admin_auth_urlpatterns, auth_urlpatterns
from apps.accounts.api.views import MeView
from apps.attempts.api.urls import student_urlpatterns as attempt_student_urlpatterns
from apps.audit.api.urls import admin_urlpatterns as audit_admin_urlpatterns
from apps.catalog.api.urls import admin_urlpatterns as catalog_admin_urlpatterns
from apps.catalog.api.urls import public_urlpatterns as catalog_public_urlpatterns
from apps.cms.api.urls import admin_urlpatterns as cms_admin_urlpatterns
from apps.cms.api.urls import public_urlpatterns as cms_public_urlpatterns
from apps.cms.api.urls import student_urlpatterns as cms_student_urlpatterns
from apps.core.views import HealthView
from apps.dashboard.api.urls import admin_urlpatterns as dashboard_admin_urlpatterns
from apps.dashboard.api.urls import me_urlpatterns as dashboard_me_urlpatterns
from apps.exams.api.urls import admin_urlpatterns as exam_admin_urlpatterns
from apps.exams.api.urls import public_urlpatterns as exam_public_urlpatterns
from apps.notifications.api.urls import me_urlpatterns as notification_me_urlpatterns
from apps.payments.api.urls import admin_urlpatterns as payment_admin_urlpatterns
from apps.payments.api.urls import student_urlpatterns as payment_student_urlpatterns
from apps.questions.api.urls import admin_urlpatterns as question_admin_urlpatterns
from apps.results.api.urls import admin_urlpatterns as result_admin_urlpatterns
from apps.results.api.urls import public_urlpatterns as result_public_urlpatterns
from apps.results.api.urls import student_urlpatterns as result_student_urlpatterns
from apps.subscriptions.api.urls import admin_urlpatterns as subscription_admin_urlpatterns
from apps.subscriptions.api.urls import me_urlpatterns as subscription_me_urlpatterns
from apps.subscriptions.api.urls import public_urlpatterns as subscription_public_urlpatterns

app_name = "api_v1"

# Admin API: admin session + CSRF + admin role (apps.core.admin_api.AdminAPIMixin).
admin_urlpatterns = [
    path("auth/", include((admin_auth_urlpatterns, "auth"))),
    *catalog_admin_urlpatterns,
    *question_admin_urlpatterns,
    *exam_admin_urlpatterns,
    *subscription_admin_urlpatterns,
    *result_admin_urlpatterns,
    *payment_admin_urlpatterns,
    *cms_admin_urlpatterns,
    *audit_admin_urlpatterns,
    *dashboard_admin_urlpatterns,
]

urlpatterns = [
    path("health/", HealthView.as_view(), name="health"),
    path("auth/", include((auth_urlpatterns, "auth"))),
    path("me/", MeView.as_view(), name="me"),
    # Student JWT; every query is filtered by request.user.
    path("me/", include((subscription_me_urlpatterns, "me"))),
    path("me/", include((notification_me_urlpatterns, "notifications"))),
    path("me/", include((dashboard_me_urlpatterns, "dashboard"))),
    path("admin/", include((admin_urlpatterns, "admin"))),
    # Student exam engine (student JWT; every query filtered by request.user).
    path("", include((attempt_student_urlpatterns, "attempts"))),
    path("", include((result_student_urlpatterns, "results"))),
    # Payments: student JWT for initiate/status/history; provider callbacks need no login
    # and can only trigger a server-side verification.
    path("", include((payment_student_urlpatterns, "payments"))),
    # Notices for logged-in students (student JWT).
    path("", include((cms_student_urlpatterns, "cms"))),
    # Public (no login): website & app. Only published, safe fields — no questions.
    path(
        "public/",
        include(
            (
                [
                    *catalog_public_urlpatterns,
                    *exam_public_urlpatterns,
                    *subscription_public_urlpatterns,
                    *result_public_urlpatterns,
                    *cms_public_urlpatterns,
                ],
                "public",
            )
        ),
    ),
]
