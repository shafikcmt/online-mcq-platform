"""Admin Users API (Milestone 7E) — read-only.

- ``GET /admin/users/``       paginated list; filters ``role``, ``is_active``; ``search``
  (name, mobile number — any form, Bangla digits too — or email); ``ordering``
  (``date_joined``, ``full_name``, ``-`` = descending).
- ``GET /admin/users/{id}/``  the same fields plus summary counts (attempts, results,
  active subscriptions, payments) — counts only, never embedded lists.

Personal data is masked: responses carry ``mobile_display`` and ``email_display``, never
the raw ``mobile_number`` or ``email`` (search may match the raw values, the response
stays masked). No password, ``auth_version``, staff/superuser flags, groups, permissions,
tokens or verification data.

The only changes: ``POST /admin/users/{id}/activate/`` and ``…/deactivate/`` — students
only (``409 not_a_student`` for staff), audited; deactivating signs the student out
everywhere (``accounts.services.set_student_active``). Admin session + CSRF + admin role,
like every Admin API call.
"""

import re

from django.db.models import Q
from django.utils.translation import gettext_lazy as _
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import generics, serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.services import AuditContext
from apps.core.admin_api import (
    AdminAPIMixin,
    query_bool,
    query_choice,
    query_ordering,
    query_search,
)
from apps.core.i18n import normalize_digits
from apps.core.phone import mask_mobile, try_normalize_bd_mobile

from .. import services
from ..exceptions import AccountError
from ..models import Role, User
from .errors import from_account_error

USER_ORDERING = ("date_joined", "full_name")
USER_DEFAULT_ORDERING = ("-date_joined",)
# A number fragment worth matching against stored numbers (+8801XXXXXXXXX).
_MOBILE_FRAGMENT = re.compile(r"^\+?[\d\s\-.()]{3,}$")
_SEPARATORS = re.compile(r"[\s\-.()+]")


def mask_email(value: str | None) -> str | None:
    """``rahim.uddin@gmail.com`` → ``r***@g***.com``; ``None`` when there is no email."""
    if not value or "@" not in value:
        return None
    local, _at, domain = value.rpartition("@")
    name, dot, tld = domain.rpartition(".")
    host = name if dot else domain
    masked_domain = f"{host[:1]}***{dot}{tld}" if dot else f"{host[:1]}***"
    return f"{local[:1]}***@{masked_domain}"


def mobile_query(search: str) -> Q | None:
    """Match a whole number (normalized) or a fragment of at least 3 digits."""
    text = normalize_digits(search.strip())
    if not _MOBILE_FRAGMENT.fullmatch(text):
        return None
    full = try_normalize_bd_mobile(text)
    if full != text and full.startswith("+880"):
        return Q(mobile_number=full)
    digits = _SEPARATORS.sub("", text)
    return Q(mobile_number__contains=digits) if len(digits) >= 3 else None


class AdminUserSerializer(serializers.Serializer):
    """Explicit, read-only fields. Never the raw mobile number or email."""

    id = serializers.IntegerField()
    full_name = serializers.CharField()
    display_name = serializers.SerializerMethodField()
    role = serializers.ChoiceField(choices=Role.choices)
    preferred_language = serializers.CharField()
    is_active = serializers.BooleanField()
    is_mobile_verified = serializers.BooleanField()
    mobile_display = serializers.SerializerMethodField(
        help_text=_("Masked mobile number, e.g. +88017*****678.")
    )
    email_display = serializers.SerializerMethodField(
        help_text=_("Masked email, e.g. r***@g***.com; null when there is none.")
    )
    date_joined = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()

    def get_display_name(self, user) -> str:
        profile = getattr(user, "student_profile", None)
        return profile.display_name if profile is not None else ""

    def get_mobile_display(self, user) -> str:
        return mask_mobile(user.mobile_number)

    def get_email_display(self, user) -> str | None:
        return mask_email(user.email)


class AdminUserDetailSerializer(AdminUserSerializer):
    attempts_count = serializers.IntegerField()
    results_count = serializers.IntegerField()
    active_subscriptions_count = serializers.IntegerField()
    payments_count = serializers.IntegerField()


def _admin_users():
    # Admins have no student profile; the join returns null for them (no extra query).
    return User.objects.select_related("student_profile")


@extend_schema_view(
    get=extend_schema(
        parameters=[
            OpenApiParameter("role", OpenApiTypes.STR, enum=Role.values),
            OpenApiParameter("is_active", OpenApiTypes.BOOL),
            OpenApiParameter(
                "search",
                OpenApiTypes.STR,
                description="Full name, mobile number (any form; 3+ digits match a part) "
                "or email. Results stay masked.",
            ),
            OpenApiParameter(
                "ordering",
                OpenApiTypes.STR,
                description="Comma-separated; '-' = descending. Fields: "
                + ", ".join(USER_ORDERING)
                + ". Default: newest first.",
            ),
        ]
    )
)
class AdminUserListView(AdminAPIMixin, generics.ListAPIView):
    serializer_class = AdminUserSerializer
    http_method_names = ["get", "head", "options"]

    def get_queryset(self):
        request = self.request
        queryset = _admin_users()
        role = query_choice(request, "role", Role.values)
        if role is not None:
            queryset = queryset.filter(role=role)
        active = query_bool(request, "is_active")
        if active is not None:
            queryset = queryset.filter(is_active=active)
        search = query_search(request)
        if search:
            match = Q(full_name__icontains=search) | Q(email__icontains=search)
            by_mobile = mobile_query(search)
            queryset = queryset.filter(match | by_mobile if by_mobile is not None else match)
        return queryset.order_by(*query_ordering(request, USER_ORDERING, USER_DEFAULT_ORDERING))


class AdminUserDetailView(AdminAPIMixin, generics.RetrieveAPIView):
    """One user and how much they have done — counts only; the panel links to the
    filtered lists. Counts reuse each module's own definitions (active subscriptions:
    ``subscriptions.selectors.active_subscriptions``)."""

    serializer_class = AdminUserDetailSerializer
    http_method_names = ["get", "head", "options"]
    queryset = _admin_users()

    def get_object(self):
        return _with_counts(super().get_object())


def _with_counts(user: User) -> User:
    from apps.attempts.models import ExamAttempt
    from apps.payments.models import Payment
    from apps.results.models import Result
    from apps.subscriptions.selectors import active_subscriptions

    user.attempts_count = ExamAttempt.objects.filter(user_id=user.pk).count()
    user.results_count = Result.objects.filter(user_id=user.pk).count()
    user.active_subscriptions_count = active_subscriptions(user).count()
    user.payments_count = Payment.objects.filter(user_id=user.pk).count()
    return user


class _SetActiveView(AdminAPIMixin, APIView):
    active: bool
    http_method_names = ["post", "options"]

    @extend_schema(request=None, responses=AdminUserDetailSerializer)
    def post(self, request, pk):
        try:
            services.set_student_active(pk, self.active, ctx=AuditContext.from_request(request))
        except AccountError as exc:
            raise from_account_error(exc) from exc
        user = _with_counts(generics.get_object_or_404(_admin_users(), pk=pk))
        return Response(AdminUserDetailSerializer(user, context={"request": request}).data)


class AdminUserActivateView(_SetActiveView):
    active = True


class AdminUserDeactivateView(_SetActiveView):
    active = False
