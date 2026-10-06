"""Version 1 API routes. Each module adds its own ``include`` here in later milestones."""

from django.urls import include, path

from apps.accounts.api.urls import auth_urlpatterns
from apps.accounts.api.views import MeView
from apps.core.views import HealthView

app_name = "api_v1"

urlpatterns = [
    path("health/", HealthView.as_view(), name="health"),
    path("auth/", include((auth_urlpatterns, "auth"))),
    path("me/", MeView.as_view(), name="me"),
]
