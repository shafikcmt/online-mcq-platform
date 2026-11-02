"""Student in-app notifications (student JWT; only the caller's own rows):

- ``GET  /me/notifications/``                 newest first, paginated; ``?is_read=true|false``
- ``GET  /me/notifications/{id}/``            one notification
- ``POST /me/notifications/{id}/read/``       mark read (idempotent)
- ``POST /me/notifications/read-all/``        mark all of mine read (idempotent)

Notifications are created only by the server (payment success, result published); there
is no create, edit or delete endpoint. Another student's notification is "not found".
"""

from django.http import Http404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.admin_api import query_bool

from .. import services
from .serializers import NotificationSerializer, ReadAllResultSerializer


class NotificationListView(generics.ListAPIView):
    serializer_class = NotificationSerializer

    def get_queryset(self):
        queryset = services.own_notifications(self.request.user)
        is_read = query_bool(self.request, "is_read")
        if is_read is not None:
            queryset = queryset.filter(read_at__isnull=not is_read)
        return queryset.order_by("-created_at", "-id")

    @extend_schema(
        tags=["notifications"],
        parameters=[OpenApiParameter("is_read", OpenApiTypes.BOOL)],
    )
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)


class NotificationDetailView(generics.RetrieveAPIView):
    serializer_class = NotificationSerializer
    lookup_field = "public_id"

    def get_queryset(self):
        return services.own_notifications(self.request.user)

    @extend_schema(tags=["notifications"])
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)


class NotificationReadView(APIView):
    http_method_names = ["post", "options"]

    @extend_schema(request=None, responses=NotificationSerializer, tags=["notifications"])
    def post(self, request, public_id):
        notification = services.mark_read(request.user, public_id)
        if notification is None:
            raise Http404
        return Response(NotificationSerializer(notification, context={"request": request}).data)


class NotificationReadAllView(APIView):
    http_method_names = ["post", "options"]

    @extend_schema(request=None, responses=ReadAllResultSerializer, tags=["notifications"])
    def post(self, request):
        return Response({"updated": services.mark_all_read(request.user)})
