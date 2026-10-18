from django.urls import path

from .views import AdminDashboardView, StudentDashboardView

me_urlpatterns = [
    path("dashboard/", StudentDashboardView.as_view(), name="dashboard"),
]

admin_urlpatterns = [
    path("dashboard/", AdminDashboardView.as_view(), name="dashboard"),
]
