"""One small HTTPS + JSON client for payment gateways.

Standard library only; certificate verification is on; every problem (not https, network,
timeout, an HTTP error, a body that is too large or not a JSON object) becomes a
``GatewayError`` with a short, safe reason code. Request headers and bodies (which carry
provider credentials) are never logged or put into an error.
"""

import json
import urllib.error
import urllib.request

from .base import GatewayError

MAX_RESPONSE_BYTES = 256 * 1024


def request_json(
    method: str,
    url: str,
    *,
    body: dict | None = None,
    headers: dict | None = None,
    timeout: float,
) -> dict:
    """One HTTPS request → the parsed JSON object. Raises ``GatewayError``."""
    if not url.startswith("https://"):
        raise GatewayError("insecure_url")
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(  # noqa: S310 — https only (checked above)
        url,
        data=data,
        method=method,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            **(headers or {}),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
            raw = response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as exc:
        raise GatewayError(f"http_{exc.code}") from None
    except TimeoutError:
        raise GatewayError("timeout") from None
    except (urllib.error.URLError, OSError) as exc:
        if isinstance(getattr(exc, "reason", None), TimeoutError):
            raise GatewayError("timeout") from None
        raise GatewayError("network_error") from None
    if len(raw) > MAX_RESPONSE_BYTES:
        raise GatewayError("response_too_large")
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise GatewayError("bad_response") from None
    if not isinstance(parsed, dict):
        raise GatewayError("bad_response")
    return parsed
