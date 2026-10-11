from django.utils.translation import gettext_lazy as _


class AttemptError(Exception):
    """A request the exam engine refuses, with a stable ``code`` and HTTP ``status``."""

    def __init__(self, code: str, message, *, status: int, details=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.details = details or {}


EXAM_NOT_STARTED_MESSAGE = _("This exam has not started yet.")
EXAM_ENDED_MESSAGE = _("This exam has ended.")
NEEDS_SUBSCRIPTION_MESSAGE = _("You need an active subscription that includes this exam.")
RETAKE_NOT_ALLOWED_MESSAGE = _("This exam can be taken only once.")
ATTEMPT_LIMIT_MESSAGE = _("You have used all your attempts for this exam.")
NOT_IN_PROGRESS_MESSAGE = _("This attempt has already been submitted.")
DEADLINE_PASSED_MESSAGE = _("The time for this attempt is over.")
