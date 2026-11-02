"""System checks: `manage.py check` reports an unusable app deep-link scheme."""

from django.conf import settings
from django.core.checks import Error, register

from .models import app_deep_link_scheme


@register()
def check_cms_settings(app_configs, **kwargs):
    configured = (settings.APP_DEEP_LINK_SCHEME or "").strip()
    if configured and not app_deep_link_scheme():
        return [
            Error(
                f"APP_DEEP_LINK_SCHEME={configured!r} is not a usable app scheme.",
                hint="Use 2–31 lowercase letters/digits/+.- starting with a letter; "
                "never http, https, javascript, data, vbscript, file, blob or about.",
                id="cms.E001",
            )
        ]
    return []
