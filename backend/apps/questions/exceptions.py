from django.utils.translation import gettext_lazy as _


class QuestionInUse(Exception):
    """The question is referenced elsewhere (exams/attempts from Milestone 3C/4)."""

    def __init__(self, message):
        super().__init__(message)
        self.message = message


QUESTION_IN_USE_MESSAGE = _("This question is used in exams. Deactivate it instead of deleting it.")
