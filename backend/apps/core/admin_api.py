"""Building blocks shared by every admin API view (``/api/v1/admin/…``)."""

from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from .authentication import AdminSessionAuthentication
from .permissions import IsAdminRole

BOOLEAN_VALUES = {"true": True, "1": True, "false": False, "0": False}
SEARCH_MAX_LENGTH = 100

INVALID_BOOLEAN_MESSAGE = _("Use true or false.")
INVALID_ID_MESSAGE = _("Enter a valid ID.")
INVALID_ORDERING_MESSAGE = _("Unknown ordering field.")
SEARCH_TOO_LONG_MESSAGE = _("The search text is too long.")


class AdminAPIMixin:
    """Admin session authentication + admin-role permission (no student JWT)."""

    authentication_classes = [AdminSessionAuthentication]
    permission_classes = [IsAdminRole]


def to_drf_validation_error(exc: DjangoValidationError) -> serializers.ValidationError:
    if hasattr(exc, "error_dict"):
        errors = {
            ("non_field_errors" if field == "__all__" else field): messages
            for field, messages in exc.message_dict.items()
        }
        return serializers.ValidationError(errors)
    return serializers.ValidationError({"non_field_errors": exc.messages})


def query_bool(request, name: str) -> bool | None:
    raw = request.query_params.get(name)
    if raw is None or raw == "":
        return None
    value = BOOLEAN_VALUES.get(raw.strip().lower())
    if value is None:
        raise serializers.ValidationError({name: [INVALID_BOOLEAN_MESSAGE]})
    return value


def query_int(request, name: str) -> int | None:
    raw = request.query_params.get(name)
    if raw is None or raw == "":
        return None
    try:
        value = int(raw.strip())  # also accepts Bangla digits
    except ValueError:
        value = 0
    if value <= 0:
        raise serializers.ValidationError({name: [INVALID_ID_MESSAGE]})
    return value


INVALID_CHOICE_MESSAGE = _("Unknown value.")


def query_choice(request, name: str, choices) -> str | None:
    raw = request.query_params.get(name)
    if raw is None or raw == "":
        return None
    value = raw.strip().lower()
    if value not in choices:
        raise serializers.ValidationError({name: [INVALID_CHOICE_MESSAGE]})
    return value


def query_search(request, name: str = "search") -> str:
    from .i18n import normalize_text

    value = normalize_text(request.query_params.get(name, ""))
    if len(value) > SEARCH_MAX_LENGTH:
        raise serializers.ValidationError({name: [SEARCH_TOO_LONG_MESSAGE]})
    return value


def query_ordering(request, allowed: tuple[str, ...], default: tuple[str, ...]) -> list[str]:
    """``?ordering=-created_at,name_en`` limited to ``allowed``; ``id`` keeps it stable."""
    raw = request.query_params.get("ordering", "")
    fields = [part.strip() for part in raw.split(",") if part.strip()] or list(default)
    for field in fields:
        if field.lstrip("-") not in allowed:
            raise serializers.ValidationError({"ordering": [INVALID_ORDERING_MESSAGE]})
    if not any(field.lstrip("-") == "id" for field in fields):
        fields.append("id")
    return fields
