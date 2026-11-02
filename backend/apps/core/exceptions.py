"""One JSON error shape for the whole API (docs/API_PLAN.md §1.1):

    {"error": {"code": "...", "message": "...", "details": {...}, "field_errors": {...}}}

``code`` is a stable machine string; ``message`` is localized to the request language.
"""

from django.utils.translation import gettext as _
from rest_framework import exceptions
from rest_framework.views import exception_handler


def error_body(code: str, message: str, *, details=None, field_errors=None) -> dict:
    error = {"code": code, "message": message}
    if details:
        error["details"] = details
    if field_errors:
        error["field_errors"] = field_errors
    return {"error": error}


class ApiError(exceptions.APIException):
    """A domain error with a stable code, optional details and optional Retry-After."""

    def __init__(
        self, *, status_code, code, message, details=None, field_errors=None, retry_after=None
    ):
        super().__init__(detail=message, code=code)
        self.status_code = status_code
        self.error_code = code
        self.details = details or {}
        self.field_errors = field_errors or {}
        self.retry_after = retry_after


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is None:
        # Unexpected error → Django returns a 500 (JSON via apps.core.views.server_error).
        return None

    if isinstance(exc, ApiError):
        response.data = error_body(
            exc.error_code, str(exc.detail), details=exc.details, field_errors=exc.field_errors
        )
        if exc.retry_after:
            response["Retry-After"] = str(int(exc.retry_after))
        if exc.status_code == 401:
            response["WWW-Authenticate"] = 'Bearer realm="api"'
        return response

    if isinstance(exc, exceptions.ValidationError):
        data = response.data
        field_errors = data if isinstance(data, dict) else {"non_field_errors": data}
        response.data = error_body(
            "validation_error",
            _("Please correct the highlighted fields."),
            field_errors=field_errors,
        )
        return response

    detail = getattr(exc, "detail", "")
    if isinstance(detail, dict):  # e.g. simplejwt: {"detail": ..., "code": ..., "messages": [...]}
        code = str(detail.get("code") or getattr(exc, "default_code", "error"))
        message = str(detail.get("detail", ""))
    else:
        codes = exc.get_codes() if isinstance(exc, exceptions.APIException) else None
        code = codes if isinstance(codes, str) else getattr(exc, "default_code", "error")
        message = str(detail)
    details = {}
    if isinstance(exc, exceptions.Throttled) and exc.wait:
        details["retry_after"] = int(exc.wait) + 1  # Retry-After header is set by DRF
    response.data = error_body(code, message, details=details)
    return response
