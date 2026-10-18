from django.apps import AppConfig


class DashboardConfig(AppConfig):
    name = "apps.dashboard"
    label = "dashboard"
    verbose_name = "Dashboard"

    def ready(self):
        from . import checks  # noqa: F401 — registers configuration checks
