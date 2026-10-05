"""Version 1 API routes. Each module adds its own ``include`` here in later milestones."""

from django.urls import path

from apps.core.views import HealthView

app_name = "api_v1"

urlpatterns = [
    path("health/", HealthView.as_view(), name="health"),
]
