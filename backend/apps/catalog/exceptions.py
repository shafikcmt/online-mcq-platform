from django.utils.translation import gettext_lazy as _


class CatalogInUse(Exception):
    """The object is still referenced (subjects now; questions/exams in later milestones)."""

    def __init__(self, message, *, details=None):
        super().__init__(message)
        self.message = message
        self.details = details or {}


CATEGORY_IN_USE_MESSAGE = _(
    "This category still has subjects. Move or delete them first, or deactivate the category."
)
SUBJECT_IN_USE_MESSAGE = _("This subject is still in use. Deactivate it instead of deleting it.")
CATEGORY_REFERENCED_MESSAGE = _(
    "This category is still used by exams, groups or packages. "
    "Deactivate it instead of deleting it."
)
GROUP_IN_USE_MESSAGE = _(
    "This group still has exams or sub-groups. Move them first, or deactivate the group."
)
