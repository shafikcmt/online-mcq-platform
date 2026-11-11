"""Expo push transport: one HTTPS call that hands up to 100 messages to Expo's push service.

Documented API (https://docs.expo.dev/push-notifications/sending-notifications/): ``POST`` a JSON
array of ``{to, title, body, data, sound, channelId}``. The answer is ``{"data": [ticket, ...]}``
in the same order, each ticket ``{"status": "ok", "id": ...}`` or ``{"status": "error",
"message": ..., "details": {"error": "DeviceNotRegistered"|...}}``. An ``Authorization: Bearer``
header is needed only when the Expo project turned on enhanced push security.

Rules kept here: https only, a short timeout, no secret or token ever logged, and every failure
turns into a ``PushTransportError`` (the caller records it; nothing is retried blindly).
"""

import json
import logging
import re
import urllib.error
import urllib.request

from django.conf import settings

logger = logging.getLogger(__name__)

# ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx] (older: ExpoPushToken[...]); URL-safe characters inside.
TOKEN_PATTERN = re.compile(r"^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{10,180}\]$")


class PushTransportError(Exception):
    """The request to Expo failed as a whole (network, timeout, a refusal or an unreadable
    answer)."""


def is_valid_token(value: str) -> bool:
    return bool(isinstance(value, str) and TOKEN_PATTERN.fullmatch(value))


def post_messages(messages: list[dict]) -> list[dict]:
    """Send ``messages`` (at most ``PUSH_BATCH_SIZE``) and return one ticket per message, in
    order."""
    url = settings.EXPO_PUSH_URL
    if not url.startswith("https://"):
        raise PushTransportError("EXPO_PUSH_URL must be an https address.")
    if not messages or len(messages) > settings.PUSH_BATCH_SIZE:
        raise PushTransportError("A push request carries 1 to 100 messages.")
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Accept-Encoding": "identity",
    }
    if settings.EXPO_ACCESS_TOKEN:
        headers["Authorization"] = f"Bearer {settings.EXPO_ACCESS_TOKEN}"
    request = urllib.request.Request(  # noqa: S310 - https only, checked above
        url, data=json.dumps(messages).encode(), headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=settings.PUSH_TIMEOUT_SECONDS) as response:  # noqa: S310
            payload = json.loads(response.read(2_000_000))
    except urllib.error.HTTPError as exc:
        raise PushTransportError(f"Expo answered HTTP {exc.code}.") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise PushTransportError("Expo could not be reached.") from None
    except ValueError:
        raise PushTransportError("Expo's answer could not be read.") from None
    tickets = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(tickets, list) or len(tickets) != len(messages):
        raise PushTransportError("Expo's answer did not match the request.")
    return [ticket if isinstance(ticket, dict) else {} for ticket in tickets]
