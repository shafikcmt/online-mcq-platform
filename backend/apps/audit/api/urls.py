from django.urls import path

from .views import AuditLogListView

admin_urlpatterns = [path("audit-logs/", AuditLogListView.as_view(), name="audit-log-list")]
