from django.utils.translation import gettext_lazy as _


class ExamStateError(Exception):
    """The action is not allowed in the exam's current status (→ 409 with ``code``)."""

    def __init__(self, code: str, message):
        super().__init__(message)
        self.code = code
        self.message = message


EXAM_LOCKED_MESSAGE = _(
    "Published and archived exams cannot be changed. Unpublish the exam first, or duplicate it."
)
EXAM_NOT_DELETABLE_MESSAGE = _(
    "Only draft exams can be deleted. Unpublish or archive this exam instead."
)
ALREADY_PUBLISHED_MESSAGE = _("This exam is already published.")
NOT_PUBLISHED_MESSAGE = _("Only a published exam can be unpublished.")
NOT_ARCHIVABLE_MESSAGE = _("Only draft or unpublished exams can be archived.")
EXAM_IN_USE_MESSAGE = _(
    "This exam is still used by a package. Remove it from the package first, or archive the exam."
)
