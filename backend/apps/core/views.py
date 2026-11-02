from django.http import JsonResponse
from django.utils.translation import gettext as _
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .exceptions import error_body


class HealthView(APIView):
    """Liveness check. Public, cheap, and reveals nothing about the system."""

    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(
        summary="Health check",
        responses=inline_serializer("Health", fields={"status": serializers.CharField()}),
        tags=["system"],
    )
    def get(self, request):
        return Response({"status": "ok"})


def not_found(request, exception=None):
    return JsonResponse(
        error_body("not_found", _("The requested resource was not found.")), status=404
    )


def server_error(request):
    return JsonResponse(
        error_body("server_error", _("Something went wrong on our side. Please try again.")),
        status=500,
    )
