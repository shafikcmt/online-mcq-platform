"""Choose the response language for every request.

Order (docs/LOCALIZATION.md §3.2):
1. ``?lang=bn|en`` query parameter
2. ``Accept-Language`` header
3. the authenticated user's ``preferred_language`` — applied by the JWT
   authentication class (``apps.accounts.authentication``) when 1–2 are absent
4. Default: ``ADMIN_DEFAULT_LANGUAGE`` (English) for Admin Panel API paths and the
   internal Django admin, otherwise ``LANGUAGE_CODE`` (Bangla — Mobile App and
   Public Website default).
"""

from django.conf import settings
from django.utils import translation
from django.utils.cache import patch_vary_headers

from .i18n import normalize_language, parse_accept_language


class LanguageMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        explicit = self.explicit_language(request)
        language = explicit or self.default_language(request)
        translation.activate(language)
        request.LANGUAGE_CODE = language
        request.language_is_explicit = explicit is not None
        try:
            response = self.get_response(request)
        finally:
            translation.deactivate()
        patch_vary_headers(response, ("Accept-Language",))
        # May have been switched to the user's preferred language during authentication.
        response.headers.setdefault("Content-Language", request.LANGUAGE_CODE)
        return response

    @classmethod
    def select_language(cls, request) -> str:
        return cls.explicit_language(request) or cls.default_language(request)

    @staticmethod
    def explicit_language(request) -> str | None:
        """Language chosen by the client itself (query parameter or header)."""
        from_query = normalize_language(request.GET.get("lang"))
        if from_query:
            return from_query
        from_header = parse_accept_language(request.headers.get("Accept-Language"))
        return from_header[0] if from_header else None

    @staticmethod
    def default_language(request) -> str:
        admin_prefixes = (settings.ADMIN_API_PATH_PREFIX, "/" + settings.DJANGO_ADMIN_URL)
        if request.path.startswith(admin_prefixes):
            return settings.ADMIN_DEFAULT_LANGUAGE
        return settings.LANGUAGE_CODE
