from django.urls import path

from .views import (
    NotificationDetailView,
    NotificationListView,
    NotificationReadAllView,
    NotificationReadView,
)

# Mounted under /api/v1/me/ (student JWT).
me_urlpatterns = [
    path("notifications/", NotificationListView.as_view(), name="notification-list"),
    path(
        "notifications/read-all/", NotificationReadAllView.as_view(), name="notification-read-all"
    ),
    path(
        "notifications/<uuid:public_id>/",
        NotificationDetailView.as_view(),
        name="notification-detail",
    ),
    path(
        "notifications/<uuid:public_id>/read/",
        NotificationReadView.as_view(),
        name="notification-read",
    ),
]
