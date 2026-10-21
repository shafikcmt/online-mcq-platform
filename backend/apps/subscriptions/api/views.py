"""Subscriptions API.

- Admin (``/api/v1/admin/packages|subscriptions/…``): admin session + CSRF + admin
  role. Packages are edited directly; subscription status only changes through the
  grant and cancel actions.
- Student (``/api/v1/me/subscriptions/``): student JWT; only the caller's own rows.
- Public (``/api/v1/public/packages/``): no login; active packages only.

Views stay thin: validate input, call ``subscriptions.services`` (one transaction with
the audit entry), serialize.
"""

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Count, Q
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.services import AuditContext
from apps.core.admin_api import (
    AdminAPIMixin,
    query_bool,
    query_choice,
    query_int,
    query_ordering,
    query_search,
    to_drf_validation_error,
)
from apps.core.exceptions import ApiError
from apps.core.public_api import PublicAPIMixin

from .. import services
from ..exceptions import SubscriptionError
from ..models import Package, PackageAccessRule, PackageStatus, Subscription, SubscriptionStatus
from ..selectors import EffectiveStatus, active_window, effective_status_filter
from .serializers import (
    AccessRuleAdminSerializer,
    AccessRuleListResponseSerializer,
    AccessRuleListSerializer,
    GrantSerializer,
    MySubscriptionSerializer,
    PackageAdminSerializer,
    PublicPackageSerializer,
    SubscriptionAdminSerializer,
)

PACKAGE_ORDERING = ("id", "sort_order", "price", "validity_days", "created_at", "updated_at")
SUBSCRIPTION_ORDERING = ("id", "created_at", "starts_at", "expires_at")


def _write(request, func, *args, **kwargs):
    try:
        return func(*args, ctx=AuditContext.from_request(request), **kwargs)
    except DjangoValidationError as exc:
        raise to_drf_validation_error(exc) from exc
    except SubscriptionError as exc:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code=exc.code,
            message=str(exc.message),
            details=exc.details,
        ) from exc


# --------------------------------------------------------------------------------------
# Admin: packages
# --------------------------------------------------------------------------------------
def _package_queryset():
    return Package.objects.annotate(
        rule_count=Count("access_rules", distinct=True),
        subscription_count=Count("subscriptions", distinct=True),
    )


def _package_response(request, package_id, status_code=status.HTTP_200_OK):
    package = _package_queryset().get(pk=package_id)
    return Response(
        PackageAdminSerializer(package, context={"request": request}).data, status=status_code
    )


@extend_schema_view(
    get=extend_schema(
        parameters=[
            OpenApiParameter("status", OpenApiTypes.STR, enum=PackageStatus.values),
            OpenApiParameter("is_featured", OpenApiTypes.BOOL),
            OpenApiParameter(
                "search", OpenApiTypes.STR, description="Bangla/English name or slug."
            ),
            OpenApiParameter(
                "ordering",
                OpenApiTypes.STR,
                description="Comma-separated; '-' = descending. Fields: "
                + ", ".join(PACKAGE_ORDERING),
            ),
        ]
    )
)
class PackageListCreateView(AdminAPIMixin, generics.ListCreateAPIView):
    serializer_class = PackageAdminSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        request = self.request
        queryset = _package_queryset()
        package_status = query_choice(request, "status", PackageStatus.values)
        if package_status:
            queryset = queryset.filter(status=package_status)
        featured = query_bool(request, "is_featured")
        if featured is not None:
            queryset = queryset.filter(is_featured=featured)
        search = query_search(request)
        if search:
            queryset = queryset.filter(
                Q(name_bn__icontains=search)
                | Q(name_en__icontains=search)
                | Q(slug__icontains=search)
            )
        return queryset.order_by(*query_ordering(request, PACKAGE_ORDERING, ("sort_order",)))

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        package = _write(request, services.create_package, Package(**serializer.validated_data))
        return _package_response(request, package.pk, status.HTTP_201_CREATED)


class PackageDetailView(AdminAPIMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = PackageAdminSerializer
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return _package_queryset()

    def update(self, request, *args, **kwargs):
        package = self.get_object()
        serializer = self.get_serializer(package, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        _write(request, services.update_package, package.pk, dict(serializer.validated_data))
        return _package_response(request, package.pk)

    def destroy(self, request, *args, **kwargs):
        package = self.get_object()
        _write(request, services.delete_package, package.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)


class PackageAccessRulesView(AdminAPIMixin, APIView):
    """``GET`` the package's access rules; ``PATCH`` replaces them with the COMPLETE
    list sent, atomically."""

    http_method_names = ["get", "patch", "options"]

    def _rules(self, package_id):
        rules = (
            PackageAccessRule.objects.filter(package_id=package_id)
            .select_related("category", "exam")
            .order_by("id")
        )
        return {"rules": AccessRuleAdminSerializer(rules, many=True).data}

    @extend_schema(responses=AccessRuleListResponseSerializer)
    def get(self, request, pk):
        generics.get_object_or_404(Package.objects.all(), pk=pk)
        return Response(self._rules(pk))

    @extend_schema(request=AccessRuleListSerializer, responses=AccessRuleListResponseSerializer)
    def patch(self, request, pk):
        generics.get_object_or_404(Package.objects.all(), pk=pk)
        serializer = AccessRuleListSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _write(request, services.set_access_rules, pk, serializer.validated_data["rules"])
        return Response(self._rules(pk))


# --------------------------------------------------------------------------------------
# Admin: subscriptions
# --------------------------------------------------------------------------------------
def _subscription_queryset():
    return Subscription.objects.select_related("user", "package")


@extend_schema_view(
    get=extend_schema(
        parameters=[
            OpenApiParameter(
                "status",
                OpenApiTypes.STR,
                enum=SubscriptionStatus.values,
                description="Stored status (kept for compatibility; prefer effective_status).",
            ),
            OpenApiParameter(
                "effective_status",
                OpenApiTypes.STR,
                enum=EffectiveStatus.values,
                description="Computed from server time like each row's effective_status: "
                "active (granting access now), scheduled (starts later), expired, cancelled.",
            ),
            OpenApiParameter(
                "active",
                OpenApiTypes.BOOL,
                description="true = grants access right now (status, start and expiry).",
            ),
            OpenApiParameter("package", OpenApiTypes.INT),
            OpenApiParameter("user", OpenApiTypes.INT),
            OpenApiParameter(
                "ordering",
                OpenApiTypes.STR,
                description="Comma-separated; '-' = descending. Fields: "
                + ", ".join(SUBSCRIPTION_ORDERING),
            ),
        ]
    )
)
class SubscriptionListView(AdminAPIMixin, generics.ListAPIView):
    serializer_class = SubscriptionAdminSerializer

    def now(self):
        # One server instant per request: the filters and each row's effective_status agree.
        if not hasattr(self, "_now"):
            self._now = timezone.now()
        return self._now

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "now": self.now()}

    def get_queryset(self):
        request = self.request
        queryset = _subscription_queryset()
        stored = query_choice(request, "status", SubscriptionStatus.values)
        if stored:
            queryset = queryset.filter(status=stored)
        effective = query_choice(request, "effective_status", EffectiveStatus.values)
        if effective:
            queryset = queryset.filter(effective_status_filter(effective, self.now()))
        active = query_bool(request, "active")
        if active is not None:
            window = active_window(self.now())
            queryset = queryset.filter(window) if active else queryset.exclude(window)
        for name in ("package", "user"):
            value = query_int(request, name)
            if value is not None:
                queryset = queryset.filter(**{f"{name}_id": value})
        return queryset.order_by(*query_ordering(request, SUBSCRIPTION_ORDERING, ("-created_at",)))


class SubscriptionDetailView(AdminAPIMixin, generics.RetrieveAPIView):
    serializer_class = SubscriptionAdminSerializer

    def get_queryset(self):
        return _subscription_queryset()


def _subscription_response(request, subscription_id, status_code=status.HTTP_200_OK):
    subscription = _subscription_queryset().get(pk=subscription_id)
    return Response(
        SubscriptionAdminSerializer(subscription, context={"request": request}).data,
        status=status_code,
    )


class SubscriptionGrantView(AdminAPIMixin, APIView):
    """Manual grant: a new subscription (201), or the extension of the student's
    running subscription to the same package (200)."""

    http_method_names = ["post", "options"]

    @extend_schema(
        request=GrantSerializer,
        responses={201: SubscriptionAdminSerializer, 200: SubscriptionAdminSerializer},
    )
    def post(self, request):
        serializer = GrantSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        result = _write(
            request,
            services.grant_subscription,
            data["user"],
            data["package"],
            price_paid=data.get("price_paid"),
            starts_at=data.get("starts_at"),
        )
        code = status.HTTP_200_OK if result.extended else status.HTTP_201_CREATED
        return _subscription_response(request, result.subscription.pk, code)


class SubscriptionCancelView(AdminAPIMixin, APIView):
    http_method_names = ["post", "options"]

    @extend_schema(request=None, responses=SubscriptionAdminSerializer)
    def post(self, request, pk):
        generics.get_object_or_404(Subscription.objects.all(), pk=pk)
        subscription = _write(request, services.cancel_subscription, pk)
        return _subscription_response(request, subscription.pk)


# --------------------------------------------------------------------------------------
# Student: own subscriptions (default student JWT authentication)
# --------------------------------------------------------------------------------------
class MySubscriptionListView(generics.ListAPIView):
    """Active and past subscriptions of the logged-in student — always filtered by
    ``request.user`` (never by an id from the request)."""

    serializer_class = MySubscriptionSerializer

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "now": timezone.now()}

    def get_queryset(self):
        return (
            Subscription.objects.filter(user_id=self.request.user.pk)
            .select_related("package")
            .order_by("-starts_at", "-id")
        )

    @extend_schema(tags=["me"])
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)


# --------------------------------------------------------------------------------------
# Public: packages (website & app, no login)
# --------------------------------------------------------------------------------------
class PublicPackageListView(PublicAPIMixin, generics.ListAPIView):
    serializer_class = PublicPackageSerializer

    def get_queryset(self):
        return Package.objects.filter(status=PackageStatus.ACTIVE).order_by("sort_order", "id")
