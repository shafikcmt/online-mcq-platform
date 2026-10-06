"""`manage.py check --deploy`: flag a weak or reused JWT signing key."""

from django.conf import settings
from django.core.checks import Error, Tags, register

from config.settings.checks import MIN_SECRET_KEY_LENGTH, PLACEHOLDER_VALUES


@register(Tags.security, deploy=True)
def check_jwt_signing_key(app_configs, **kwargs):
    key = settings.SIMPLE_JWT.get("SIGNING_KEY") or ""
    if key.strip().lower() in PLACEHOLDER_VALUES or len(key) < MIN_SECRET_KEY_LENGTH:
        return [
            Error(
                f"JWT signing key must be a random value of at least {MIN_SECRET_KEY_LENGTH} "
                "characters.",
                hint="Set JWT_SIGNING_KEY in the environment.",
                id="accounts.E001",
            )
        ]
    if key == settings.SECRET_KEY:
        return [Error("JWT_SIGNING_KEY must differ from SECRET_KEY.", id="accounts.E002")]
    return []
