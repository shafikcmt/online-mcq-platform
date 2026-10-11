from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


class AttemptsConfig(AppConfig):
    name = "apps.attempts"
    label = "attempts"
    verbose_name = _("Exam attempts")

    def ready(self):
        from apps.exams.locks import register_history_check
        from apps.questions.locks import CONTENT, register_lock

        from .selectors import exam_has_attempts, question_used_by_attempt

        # Attempts are history: their questions keep their content forever, and an exam
        # that students have taken can no longer be edited (only duplicated).
        register_lock(CONTENT, question_used_by_attempt)
        register_history_check(exam_has_attempts)
