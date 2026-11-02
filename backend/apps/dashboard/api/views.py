"""Dashboard endpoints (Milestone 6C) — read-only aggregation.

- ``GET /me/dashboard/``    student JWT; the caller's own data only.
- ``GET /admin/dashboard/`` admin session + admin role; basic operational counts only.
"""

from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.admin_api import AdminAPIMixin

from ..selectors import admin_dashboard, student_dashboard
from .serializers import AdminDashboardSerializer, StudentDashboardSerializer


class StudentDashboardView(APIView):
    """Home screen in one call: exams open now / upcoming / practice (short lists),
    active subscriptions, recent visible results, unread notification count."""

    http_method_names = ["get", "options"]

    @extend_schema(responses=StudentDashboardSerializer, tags=["me"])
    def get(self, request):
        data = student_dashboard(request.user, timezone.now(), request.LANGUAGE_CODE)
        return Response(StudentDashboardSerializer(data).data)


class AdminDashboardView(AdminAPIMixin, APIView):
    """Basic operational statistics (counts and sums only — no lists of people)."""

    http_method_names = ["get", "options"]

    @extend_schema(responses=AdminDashboardSerializer)
    def get(self, request):
        return Response(AdminDashboardSerializer(admin_dashboard(timezone.now())).data)
