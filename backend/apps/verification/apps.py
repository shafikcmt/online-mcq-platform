from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


class VerificationConfig(AppConfig):
    name = "apps.verification"
    label = "verification"
    verbose_name = _("Verification")

    def ready(self):
        from . import checks  # noqa: F401 — registers configuration checks
