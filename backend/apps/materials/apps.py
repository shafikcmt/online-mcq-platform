from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


class MaterialsConfig(AppConfig):
    name = "apps.materials"
    label = "materials"
    verbose_name = _("Study materials")
