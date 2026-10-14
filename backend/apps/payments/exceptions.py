from django.utils.translation import gettext_lazy as _


class PaymentError(Exception):
    """A payment action is refused (→ API error with ``code`` and ``status``)."""

    def __init__(self, code: str, message, *, status: int = 409):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


NOT_STUDENT_MESSAGE = _("Only active student accounts can buy packages.")
PACKAGE_MISSING_MESSAGE = _("This package does not exist.")
PACKAGE_INACTIVE_MESSAGE = _("This package is not on sale right now.")
PACKAGE_NOT_PURCHASABLE_MESSAGE = _("This package is free and cannot be bought.")
PAYMENT_UNAVAILABLE_MESSAGE = _(
    "The payment could not be started. Please try again in a few minutes."
)
IDEMPOTENCY_KEY_REUSED_MESSAGE = _(
    "This Idempotency-Key was already used for a payment for another package."
)
PROVIDER_DISABLED_MESSAGE = _("This payment provider is not enabled on this server.")
