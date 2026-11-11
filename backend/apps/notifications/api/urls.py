from django.urls import path

from .push_views import PushDeviceView, PushMessageListCreateView, PushStatusView
from .views import (
    NotificationDetailView,
    NotificationListView,
    NotificationReadAllView,
    NotificationReadView,
)

# Mounted under /api/v1/admin/ (admin session).
admin_urlpatterns = [
    path("push/", PushStatusView.as_view(), name="push-status"),
    path("push/messages/", PushMessageListCreateView.as_view(), name="push-message-list"),
]

# Mounted under /api/v1/me/ (student JWT).
me_urlpatterns = [
    path("push-devices/", PushDeviceView.as_view(), name="push-device"),
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
