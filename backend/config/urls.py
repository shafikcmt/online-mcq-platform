"""Root URL configuration.

All API endpoints live under /api/v1/ so a future /api/v2/ will not break
app versions already installed on students' phones.
"""

from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path
from django.utils.translation import gettext_lazy as _

from apps.core.views import not_found

admin.site.site_header = _("Live Model Test — internal administration")
admin.site.site_title = _("Live Model Test administration")

urlpatterns = [
    path("api/v1/", include("config.api_v1")),
    # Internal operations only; the product Admin Panel is a separate app.
    path(settings.DJANGO_ADMIN_URL, admin.site.urls),
]

if settings.API_DOCS_ENABLED:
    from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

    urlpatterns += [
        path("api/schema/", SpectacularAPIView.as_view(), name="api-schema"),
        path("api/docs/", SpectacularSwaggerView.as_view(url_name="api-schema"), name="api-docs"),
    ]

# Uploaded media is served by Django only in development; production uses the web
# server (static files only, never executed).
if settings.DEBUG:
    from django.conf.urls.static import static

    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

# Any other /api/... path → JSON 404, in development too (clients always expect JSON).
# Only paths ending in "/" match, so Django can still redirect "/api/v1/health" → "/api/v1/health/".
urlpatterns += [re_path(r"^api/.*/$", not_found)]

# JSON error responses instead of HTML pages (used when DEBUG is off).
handler404 = "apps.core.views.not_found"
handler500 = "apps.core.views.server_error"
