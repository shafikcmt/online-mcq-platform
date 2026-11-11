"""Security throttles for sensitive endpoints (login, OTP verify, registration …).

- Backed by the Django cache (Redis), keyed by the safe client IP from ``core.net``.
- Rates come from ``settings.AUTH_THROTTLE_RATES`` (configurable via environment).
- Fail closed: if the cache backend is unavailable the request is refused with
  503 ``temporarily_unavailable`` instead of being allowed without limits.
"""

import logging

from django.conf import settings
from django.utils.translation import gettext_lazy as _
from rest_framework import exceptions, status
from rest_framework.throttling import SimpleRateThrottle

from .net import get_client_ip

logger = logging.getLogger(__name__)


class TemporarilyUnavailable(exceptions.APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_code = "temporarily_unavailable"
    default_detail = _("This service is temporarily unavailable. Please try again shortly.")


class SecurityThrottle(SimpleRateThrottle):
    scope: str = ""

    def get_rate(self):
        return settings.AUTH_THROTTLE_RATES[self.scope]

    def get_ident(self, request):
        return get_client_ip(request) or "unknown"

    def identity(self, request, view) -> str:
        return self.get_ident(request)

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.identity(request, view)}

    def allow_request(self, request, view):
        try:
            return super().allow_request(request, view)
        except Exception as exc:  # noqa: BLE001 — cache backend failure must fail closed
            logger.error(
                "Throttle backend unavailable scope=%s error=%s", self.scope, type(exc).__name__
            )
            raise TemporarilyUnavailable() from exc


class DocumentUploadThrottle(SecurityThrottle):
    """``document_upload``: per admin; every PDF upload is read whole and checked."""

    scope = "document_upload"

    def identity(self, request, view) -> str:
        return f"user:{request.user.pk}"
