from django.utils.translation import gettext_lazy as _


class ResultError(Exception):
    """A results request the server refuses (stable ``code`` + HTTP ``status``)."""

    def __init__(self, code: str, message, *, status: int):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


MERIT_DISABLED_MESSAGE = _("This exam has no merit list.")
RESULT_OUT_OF_RANGE_MESSAGE = _("The result could not be calculated. Please contact support.")
RESULT_NOT_VISIBLE_MESSAGE = _("The result of this exam is not available yet.")
REVIEW_NOT_ALLOWED_MESSAGE = _("Answer review is not available for this exam.")
