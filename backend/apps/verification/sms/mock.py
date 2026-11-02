"""Development/test SMS provider. Never delivers anything.

Messages are kept in ``MockSmsProvider.outbox`` (per process) so tests can read the
code — the same idea as Django's ``mail.outbox``. Logs show only a masked number and
the message length; the message itself is logged only when BOTH ``DEBUG`` and
``SMS_MOCK_LOG_CONTENT`` are on (local development convenience).
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import ClassVar

from django.conf import settings
from django.utils import timezone

from apps.core.phone import mask_mobile

from .base import SmsProvider, SmsResult

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SentSms:
    to: str
    message: str
    sent_at: datetime


class MockSmsProvider(SmsProvider):
    name = "mock"
    outbox: ClassVar[list[SentSms]] = []

    def send(self, to: str, message: str) -> SmsResult:
        message_id = f"mock-{uuid.uuid4().hex}"
        self.outbox.append(SentSms(to=to, message=message, sent_at=timezone.now()))
        if settings.DEBUG and settings.SMS_MOCK_LOG_CONTENT:
            logger.warning("[MOCK SMS — development only] to %s: %s", mask_mobile(to), message)
        else:
            logger.info(
                "Mock SMS accepted to=%s length=%d id=%s", mask_mobile(to), len(message), message_id
            )
        return SmsResult(provider=self.name, message_id=message_id)
