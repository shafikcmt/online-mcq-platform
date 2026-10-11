from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


class ExamsConfig(AppConfig):
    name = "apps.exams"
    label = "exams"
    verbose_name = _("Exams")

    def ready(self):
        from apps.questions.locks import CONTENT, DEACTIVATE, register_lock

        from .selectors import question_used_by_non_draft_exam, question_used_by_published_exam

        # Questions in a published (or once-published) exam keep their content, and a
        # currently published exam never loses a question to deactivation.
        register_lock(CONTENT, question_used_by_non_draft_exam)
        register_lock(DEACTIVATE, question_used_by_published_exam)
