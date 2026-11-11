from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


class SimulationConfig(AppConfig):
    name = "apps.simulation"
    label = "simulation"
    verbose_name = _("Sample participants")
