from django.utils.translation import gettext_lazy as _


class PaymentError(Exception):
    """A payment action is refused (→ API error with ``code`` and ``status``)."""

    def __init__(self, code: str, message, *, status: int = 409, retry_after: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.retry_after = retry_after


NOT_STUDENT_MESSAGE = _("Only active student accounts can buy packages.")
PACKAGE_MISSING_MESSAGE = _("This package does not exist.")
PACKAGE_INACTIVE_MESSAGE = _("This package is not on sale right now.")
PACKAGE_NOT_PURCHASABLE_MESSAGE = _("This package is free and cannot be bought.")
PAYMENT_UNAVAILABLE_MESSAGE = _(
    "The payment could not be started. Please try again in a few minutes."
)
PAYMENTS_DISABLED_MESSAGE = _("Payments are temporarily unavailable. Please try again later.")
IDEMPOTENCY_KEY_REUSED_MESSAGE = _(
    "This Idempotency-Key was already used for a payment for another package."
)
PROVIDER_DISABLED_MESSAGE = _("This payment provider is not enabled on this server.")
ALREADY_SUCCESSFUL_MESSAGE = _(
    "This payment is already successful; there is nothing to verify again."
)
REVERIFY_TOO_SOON_MESSAGE = _(
    "This payment was checked with the provider moments ago. Try again in %(seconds)s seconds."
)
PROVIDER_NOT_OFFERED_MESSAGE = _("This payment method is not available.")
INVALID_CHANNEL_MESSAGE = _("The channel must be web or app.")
