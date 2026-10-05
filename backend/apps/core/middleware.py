"""Choose the response language for every request.

Order (docs/LOCALIZATION.md §3.2):
1. ``?lang=bn|en`` query parameter
2. ``Accept-Language`` header
3. (Milestone 2) the logged-in user's ``preferred_language``
4. Default: ``ADMIN_DEFAULT_LANGUAGE`` (English) for Admin Panel API paths,
   otherwise ``LANGUAGE_CODE`` (Bangla — Mobile App and Public Website default).
"""

from django.conf import settings
from django.utils import translation
from django.utils.cache import patch_vary_headers

from .i18n import normalize_language, parse_accept_language


class LanguageMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        language = self.select_language(request)
        translation.activate(language)
        request.LANGUAGE_CODE = language
        try:
            response = self.get_response(request)
        finally:
            translation.deactivate()
        patch_vary_headers(response, ("Accept-Language",))
        response.headers.setdefault("Content-Language", language)
        return response

    @staticmethod
    def select_language(request) -> str:
        from_query = normalize_language(request.GET.get("lang"))
        if from_query:
            return from_query
        from_header = parse_accept_language(request.headers.get("Accept-Language"))
        if from_header:
            return from_header[0]
        if request.path.startswith(settings.ADMIN_API_PATH_PREFIX):
            return settings.ADMIN_DEFAULT_LANGUAGE
        return settings.LANGUAGE_CODE
