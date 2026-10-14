"""Safety checks that stop production from starting with unsafe configuration."""

from django.core.exceptions import ImproperlyConfigured

PLACEHOLDER_VALUES = {
    "",
    "change-me",
    "changeme",
    "secret",
    "dev-only-insecure-key-do-not-use-in-production",
    "dev-only-insecure-jwt-key-do-not-use-in-production",
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
    jwt_signing_key: str = "",
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
    if (
        jwt_signing_key.strip().lower() in PLACEHOLDER_VALUES
        or len(jwt_signing_key) < MIN_SECRET_KEY_LENGTH
    ):
        problems.append(
            "JWT_SIGNING_KEY must be a random value of at least "
            f"{MIN_SECRET_KEY_LENGTH} characters."
        )
    elif jwt_signing_key == secret_key:
        problems.append("JWT_SIGNING_KEY must be different from DJANGO_SECRET_KEY.")
    if sms_provider == "mock" and not allow_mock_sms:
        problems.append(
            "SMS_PROVIDER=mock never delivers SMS. Configure a real provider, or set "
            "SMS_ALLOW_MOCK_IN_PRODUCTION=true only for a non-public test deployment."
        )
    if problems:
        raise ImproperlyConfigured("Unsafe production configuration: " + " ".join(problems))


def validate_payment_settings(
    *,
    provider: str,
    providers: dict,
    store_id: str,
    store_password: str,
    sandbox: bool,
    allow_sandbox: bool,
    callback_base_url: str,
    return_url: str,
) -> None:
    """Production refuses fake money and broken provider configuration."""
    problems = []
    if provider == "mock":
        problems.append(
            "PAYMENT_PROVIDER=mock grants access without payment and is never allowed in "
            "production."
        )
    elif provider not in providers:
        problems.append(f"PAYMENT_PROVIDER={provider!r} is not a configured provider.")
    if provider == "sslcommerz":
        if store_id.strip().lower() in PLACEHOLDER_VALUES:
            problems.append("SSLCOMMERZ_STORE_ID must be set.")
        if store_password.strip().lower() in PLACEHOLDER_VALUES:
            problems.append("SSLCOMMERZ_STORE_PASSWORD must be set.")
        if sandbox and not allow_sandbox:
            problems.append(
                "SSLCOMMERZ_SANDBOX=true takes no real money. Use live credentials, or set "
                "PAYMENT_ALLOW_SANDBOX_IN_PRODUCTION=true only for a non-public test deployment."
            )
    if not callback_base_url.startswith("https://"):
        problems.append("PAYMENT_CALLBACK_BASE_URL must be the public https:// URL of the API.")
    if not return_url:
        problems.append("PAYMENT_RETURN_URL must be set (the app's payment return page).")
    if problems:
        raise ImproperlyConfigured("Unsafe payment configuration: " + " ".join(problems))
