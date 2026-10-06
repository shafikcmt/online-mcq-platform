from django.utils.translation import gettext_lazy as _


class AccountError(Exception):
    code = "account_error"
    default_message = _("The request could not be completed.")

    def __init__(self, message=None, *, field=None):
        self.message = message or self.default_message
        self.field = field
        super().__init__(self.code)


class AccountExists(AccountError):
    code = "account_exists"
    default_message = _(
        "An account already exists for this mobile number. Log in or reset your password."
    )


class EmailTaken(AccountError):
    code = "email_taken"
    default_message = _("A user with this email address already exists.")


class InvalidCredentials(AccountError):
    code = "invalid_credentials"
    default_message = _("The mobile number or password is incorrect.")


class InvalidCurrentPassword(AccountError):
    code = "invalid_current_password"
    default_message = _("Your current password is incorrect.")
