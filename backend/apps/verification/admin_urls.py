from django.urls import path

from .admin_api import GatewayAdminView, PresetsAdminView, TestSmsAdminView

admin_urlpatterns = [
    path("sms/gateway/", GatewayAdminView.as_view(), name="sms-gateway"),
    path("sms/presets/", PresetsAdminView.as_view(), name="sms-presets"),
    path("sms/test/", TestSmsAdminView.as_view(), name="sms-test"),
]
