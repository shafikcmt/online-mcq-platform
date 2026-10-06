from apps.core.phone import try_normalize_bd_mobile
from apps.core.throttling import SecurityThrottle


class LoginIpThrottle(SecurityThrottle):
    scope = "login_ip"


class LoginThrottle(SecurityThrottle):
    """Per client IP + mobile number: slows guessing one account's password without
    letting a stranger lock the real owner out from another network."""

    scope = "login"

    def identity(self, request, view):
        try:
            mobile = request.data.get("mobile_number", "")
        except Exception:  # noqa: BLE001 — unparsable body: throttle on IP only
            mobile = ""
        return f"{self.get_ident(request)}:{try_normalize_bd_mobile(str(mobile or ''))}"


class OtpVerifyThrottle(SecurityThrottle):
    scope = "otp_verify"


class RegisterThrottle(SecurityThrottle):
    scope = "register"


class PasswordResetThrottle(SecurityThrottle):
    scope = "password_reset"


class TokenRefreshThrottle(SecurityThrottle):
    scope = "token_refresh"


class PasswordChangeThrottle(SecurityThrottle):
    scope = "password_change"

    def identity(self, request, view):
        return f"user-{request.user.pk}"
