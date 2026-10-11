from django.utils.translation import gettext_lazy as _


class QuestionInUse(Exception):
    """The question is referenced elsewhere (exams/attempts from Milestone 3C/4)."""

    def __init__(self, message):
        super().__init__(message)
        self.message = message


QUESTION_IN_USE_MESSAGE = _("This question is used in exams. Deactivate it instead of deleting it.")


class QuestionLocked(Exception):
    """The question is used by a published (or once-published) exam: its content,
    options and correct answer can no longer change."""

    def __init__(self, message):
        super().__init__(message)
        self.message = message


QUESTION_LOCKED_MESSAGE = _(
    "This question is used in a published exam, so its content, options and correct answer "
    "can no longer change. Create a new question instead."
)
QUESTION_DEACTIVATE_LOCKED_MESSAGE = _(
    "This question is used in a published exam and cannot be deactivated. Unpublish the exam first."
)
