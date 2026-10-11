from django.utils.translation import gettext_lazy as _


class SubscriptionError(Exception):
    """The action conflicts with the current state (→ 409 with ``code``)."""

    def __init__(self, code: str, message, *, details=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


PACKAGE_IN_USE_MESSAGE = _(
    "This package has subscriptions and cannot be deleted. Deactivate it instead."
)
ALREADY_CANCELLED_MESSAGE = _("This subscription is already cancelled.")
SUBSCRIPTION_EXPIRED_MESSAGE = _("This subscription has already expired.")
