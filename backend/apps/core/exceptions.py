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


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is None:
        # Unexpected error → Django returns a 500 (JSON via apps.core.views.server_error).
        return None

    if isinstance(exc, exceptions.ValidationError):
        data = response.data
        field_errors = data if isinstance(data, dict) else {"non_field_errors": data}
        response.data = error_body(
            "validation_error",
            _("Please correct the highlighted fields."),
            field_errors=field_errors,
        )
        return response

    codes = exc.get_codes() if isinstance(exc, exceptions.APIException) else None
    code = codes if isinstance(codes, str) else getattr(exc, "default_code", "error")
    detail = response.data.get("detail", "") if isinstance(response.data, dict) else ""
    response.data = error_body(code, str(detail))
    return response
