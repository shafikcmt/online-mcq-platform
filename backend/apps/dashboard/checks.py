"""System checks: `manage.py check` reports an unusable dashboard configuration."""

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.core.checks import Error, register

LIST_SIZE_BOUNDS = (1, 20)


@register()
def check_dashboard_settings(app_configs, **kwargs):
    messages = []
    try:
        ZoneInfo(settings.DASHBOARD_TIME_ZONE)
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        messages.append(
            Error(
                f"DASHBOARD_TIME_ZONE={settings.DASHBOARD_TIME_ZONE!r} is not a known time zone.",
                hint="Use an IANA name such as Asia/Dhaka.",
                id="dashboard.E001",
            )
        )
    low, high = LIST_SIZE_BOUNDS
    if not low <= settings.DASHBOARD_LIST_SIZE <= high:
        messages.append(
            Error(
                f"DASHBOARD_LIST_SIZE={settings.DASHBOARD_LIST_SIZE} must be between "
                f"{low} and {high}.",
                id="dashboard.E002",
            )
        )
    return messages
