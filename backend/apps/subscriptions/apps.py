from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


class SubscriptionsConfig(AppConfig):
    name = "apps.subscriptions"
    label = "subscriptions"
    verbose_name = _("Subscriptions")
