"""SMS provider interface.

OTP business logic only talks to ``SmsProvider``. A real Bangladesh SMS gateway is
added later as a new subclass + an entry in ``settings.SMS_PROVIDERS`` — no change
to the OTP services.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.utils.module_loading import import_string


@dataclass(frozen=True)
class SmsResult:
    provider: str
    message_id: str


class SmsDeliveryError(Exception):
    """Temporary delivery failure; the Celery task retries it."""


class SmsRejectedError(Exception):
    """Permanent rejection (bad sender, no balance, IP not allowed…); never retried.

    The message must not contain secrets (API keys) — it may reach the task log.
    """


class SmsProvider(ABC):
    name: str = "base"

    @abstractmethod
    def send(self, to: str, message: str) -> SmsResult:
        """Send ``message`` to an E.164 number. Raise ``SmsDeliveryError`` to retry."""


def get_sms_provider() -> SmsProvider:
    # An admin-enabled gateway (database) wins over the environment provider.
    from apps.verification.models import SmsGatewaySettings

    from .http_gateway import HttpGatewayProvider

    config = SmsGatewaySettings.load()
    if config is not None and config.enabled:
        return HttpGatewayProvider(config)
    path = settings.SMS_PROVIDERS.get(settings.SMS_PROVIDER)
    if path is None:
        raise ImproperlyConfigured(
            f"SMS_PROVIDER={settings.SMS_PROVIDER!r} is not one of "
            f"{sorted(settings.SMS_PROVIDERS)}."
        )
    return import_string(path)()
