from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


class QuestionsConfig(AppConfig):
    name = "apps.questions"
    label = "questions"
    verbose_name = _("Question bank")

    def ready(self):
        from . import checks  # noqa: F401 — fail-safe check for the question locks
