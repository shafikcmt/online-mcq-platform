from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


class PaymentsConfig(AppConfig):
    name = "apps.payments"
    label = "payments"
    verbose_name = _("Payments")

    def ready(self):
        from . import checks  # noqa: F401 — registers configuration checks
