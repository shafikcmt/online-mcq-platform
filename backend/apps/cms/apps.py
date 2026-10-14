from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


class CmsConfig(AppConfig):
    name = "apps.cms"
    label = "cms"
    verbose_name = _("Content")

    def ready(self):
        from . import checks  # noqa: F401 — registers configuration checks
