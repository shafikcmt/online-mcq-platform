"""Safety checks that stop production from starting with unsafe configuration."""

from django.core.exceptions import ImproperlyConfigured

PLACEHOLDER_VALUES = {
    "",
    "change-me",
    "changeme",
    "secret",
    "dev-only-insecure-key-do-not-use-in-production",
}
MIN_SECRET_KEY_LENGTH = 50


def validate_production_settings(
    *,
    secret_key: str,
    debug: bool,
    allowed_hosts: list[str],
    db_password: str,
    sms_provider: str = "mock",
    allow_mock_sms: bool = False,
) -> None:
    problems = []
    if secret_key.strip().lower() in PLACEHOLDER_VALUES or len(secret_key) < MIN_SECRET_KEY_LENGTH:
        problems.append(
            "DJANGO_SECRET_KEY must be a random value of at least "
            f"{MIN_SECRET_KEY_LENGTH} characters."
        )
    if debug:
        problems.append("DJANGO_DEBUG must be false in production.")
    if not allowed_hosts or "*" in allowed_hosts:
        problems.append("DJANGO_ALLOWED_HOSTS must list the real host names (no '*').")
    if db_password.strip().lower() in PLACEHOLDER_VALUES:
        problems.append("POSTGRES_PASSWORD must be set to a real password.")
    if sms_provider == "mock" and not allow_mock_sms:
        problems.append(
            "SMS_PROVIDER=mock never delivers SMS. Configure a real provider, or set "
            "SMS_ALLOW_MOCK_IN_PRODUCTION=true only for a non-public test deployment."
        )
    if problems:
        raise ImproperlyConfigured("Unsafe production configuration: " + " ".join(problems))
