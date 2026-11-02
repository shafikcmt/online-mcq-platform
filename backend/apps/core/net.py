"""Client IP detection that cannot be spoofed with a forged X-Forwarded-For header.

Default (TRUSTED_PROXY_COUNT=0): only REMOTE_ADDR is used — the address of whoever
opened the TCP connection. Forwarded headers are ignored.

Behind reverse proxies set TRUSTED_PROXY_COUNT to the number of proxies *you* run
in front of Django, each appending to X-Forwarded-For:
    Nginx only                      → 1
    Cloudflare → Nginx → Django     → 2
The client address is then the N-th entry from the right; anything further left was
supplied by the client and is ignored. Never set it higher than the real number of
proxies, and make sure Django is reachable only through them.
"""

import ipaddress

from django.conf import settings


def _valid_ip(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return str(ipaddress.ip_address(value.strip()))
    except ValueError:
        return None


def get_client_ip(request) -> str | None:
    remote_addr = _valid_ip(request.META.get("REMOTE_ADDR"))
    trusted = settings.TRUSTED_PROXY_COUNT
    if trusted <= 0:
        return remote_addr
    forwarded = [
        part.strip()
        for part in request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")
        if part.strip()
    ]
    if len(forwarded) < trusted:
        return remote_addr
    return _valid_ip(forwarded[-trusted]) or remote_addr
