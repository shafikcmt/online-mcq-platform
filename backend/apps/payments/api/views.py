"""Payments API.

Student (student JWT; every query filtered by ``request.user``):
- ``POST /payments/``               initiate ``{package_id}`` (optional Idempotency-Key)
- ``GET  /payments/``               my payment history
- ``GET  /payments/{payment_id}/``  status (the app polls it after checkout)

Provider-facing (no login; untrusted input — they only trigger a verification):
- ``GET|POST /payments/callback/{provider}/{success|fail|cancel}/`` browser return →
  redirect to the server-configured app return page
- ``POST /payments/ipn/{provider}/`` server notification → always ``200``
- ``GET /payments/mock/checkout/{reference}/?result=…`` mock provider page (never in
  production)

Admin (session + CSRF + admin role): list, detail, re-verify (audited). Responses are
allow-listed (7H): masked student, package names, our codes, a verification summary and
the latest 50 events as short codes — never ``raw_verification``, event payloads, source
IPs, the provider session key, the checkout URL or the idempotency key. There is
deliberately no endpoint that sets a payment status.
"""

import logging
import re
import urllib.parse

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import F
from django.http import Http404, HttpResponseRedirect
from django.utils.dateparse import parse_date
from django.utils.translation import gettext_lazy as _
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiResponse,
    extend_schema,
    extend_schema_view,
    inline_serializer,
)
from rest_framework import generics, serializers, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.services import AuditContext
from apps.core.admin_api import (
    AdminAPIMixin,
    query_choice,
    query_int,
    query_ordering,
    query_search,
    to_drf_validation_error,
)
from apps.core.exceptions import ApiError
from apps.core.net import get_client_ip
from apps.core.public_api import PublicAPIMixin
from apps.core.throttling import SecurityThrottle
from apps.subscriptions.models import Package

from .. import gateway_manager, services
from ..exceptions import INVALID_CHANNEL_MESSAGE, PAYMENT_UNAVAILABLE_MESSAGE, PaymentError
from ..gateways import CallbackKind, is_enabled
from ..gateways import mock as mock_gateway
from ..models import IDEMPOTENCY_KEY_MAX_LENGTH, Payment, PaymentProvider, PaymentStatus
from ..selectors import with_timeline
from .serializers import (
    AdminPaymentDetailSerializer,
    AdminPaymentSerializer,
    InitiateSerializer,
    PaymentMethodSerializer,
    PaymentSerializer,
)

logger = logging.getLogger(__name__)

IDEMPOTENCY_KEY_PATTERN = re.compile(rf"^[A-Za-z0-9._:-]{{1,{IDEMPOTENCY_KEY_MAX_LENGTH}}}$")
IDEMPOTENCY_KEY_INVALID_MESSAGE = _(
    "Idempotency-Key must be 1–64 letters, digits or the characters . _ : -"
)
INVALID_DATE_MESSAGE = _("Enter a valid date (YYYY-MM-DD).")
IDEMPOTENCY_HEADER = OpenApiParameter(
    "Idempotency-Key",
    OpenApiTypes.STR,
    location=OpenApiParameter.HEADER,
    required=False,
    description="Optional; retrying with the same key returns the same payment.",
)
PAYMENT_ORDERING = ("id", "created_at", "updated_at", "amount", "verified_at")


def _api_error(exc: PaymentError) -> ApiError:
    return ApiError(
        status_code=exc.status, code=exc.code, message=str(exc.message), retry_after=exc.retry_after
    )


# --------------------------------------------------------------------------------------
# Throttles
# --------------------------------------------------------------------------------------
class PaymentInitThrottle(SecurityThrottle):
    """``payment_init``: per student (docs/API_PLAN.md §5)."""

    scope = "payment_init"

    def identity(self, request, view) -> str:
        return f"user:{request.user.pk}"

    def allow_request(self, request, view):
        if request.method != "POST":
            return True
        return super().allow_request(request, view)


class PaymentMethodsThrottle(SecurityThrottle):
    """``payment_methods``: per student; the list reads every gateway and its credentials."""

    scope = "payment_methods"

    def identity(self, request, view) -> str:
        return f"user:{request.user.pk}"


class PaymentCallbackThrottle(SecurityThrottle):
    """``payment_callback``: per client IP — every known reference costs a provider call."""

    scope = "payment_callback"


# --------------------------------------------------------------------------------------
# Student
# --------------------------------------------------------------------------------------
def own_payments(user):
    return Payment.objects.filter(user_id=user.pk).select_related("package")


@extend_schema_view(
    get=extend_schema(tags=["payments"]),
    post=extend_schema(
        tags=["payments"],
        request=InitiateSerializer,
        responses={201: PaymentSerializer, 200: PaymentSerializer},
        parameters=[IDEMPOTENCY_HEADER],
    ),
)
class PaymentListCreateView(generics.ListAPIView):
    """My payments (newest first); ``POST`` starts buying a package."""

    serializer_class = PaymentSerializer
    throttle_classes = [PaymentInitThrottle]

    def get_queryset(self):
        return own_payments(self.request.user).order_by("-created_at", "-id")

    def post(self, request):
        key = request.headers.get("Idempotency-Key", "").strip()
        if key and not IDEMPOTENCY_KEY_PATTERN.match(key):
            raise serializers.ValidationError(
                {"idempotency_key": [IDEMPOTENCY_KEY_INVALID_MESSAGE]}
            )
        data = InitiateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            payment, created = services.initiate_payment(
                request.user,
                data.validated_data["package_id"],
                idempotency_key=key,
                ip=get_client_ip(request),
                provider=data.validated_data.get("provider", ""),
                gateway=data.validated_data.get("gateway", ""),
                channel=data.validated_data.get("channel", ""),
            )
        except DjangoValidationError as exc:
            raise to_drf_validation_error(exc) from exc
        except PaymentError as exc:
            raise _api_error(exc) from exc
        if created and payment.status == PaymentStatus.FAILED:
            raise ApiError(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                code="payment_unavailable",
                message=str(PAYMENT_UNAVAILABLE_MESSAGE),
                details={"payment_id": str(payment.public_id)},
            )
        payment = own_payments(request.user).get(pk=payment.pk)
        return Response(
            PaymentSerializer(payment, context={"request": request}).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class PaymentMethodsView(APIView):
    """The payment methods a student can choose from right now (in display order; the
    first is the default). Empty while payments are switched off."""

    throttle_classes = [PaymentMethodsThrottle]

    @extend_schema(
        tags=["payments"],
        parameters=[
            OpenApiParameter("channel", OpenApiTypes.STR, enum=["web", "app"]),
            OpenApiParameter(
                "package_id", OpenApiTypes.INT, description="Applies the gateways' amount limits."
            ),
        ],
        responses=inline_serializer(
            "PaymentMethodsResponse", {"results": PaymentMethodSerializer(many=True)}
        ),
    )
    def get(self, request):
        channel = request.query_params.get("channel", "")
        if channel not in ("", "web", "app"):
            raise serializers.ValidationError({"channel": [INVALID_CHANNEL_MESSAGE]})
        amount, currency = None, ""
        package_id = request.query_params.get("package_id", "")
        if package_id.isdecimal():
            package = Package.objects.filter(pk=int(package_id)).first()
            if package is not None:
                amount, currency = package.price, package.currency
        offers = gateway_manager.available_offers(
            request.user, channel, amount=amount, currency=currency
        )
        return Response(
            {
                "results": [
                    {
                        "provider": offer.adapter,
                        "gateway": offer.slug,
                        "label": offer.name(),
                        "name": offer.name(),
                        "description": offer.description(),
                        "logo_url": offer.logo_url,
                        "min_amount": None
                        if offer.min_amount is None
                        else f"{offer.min_amount:.2f}",
                        "max_amount": None
                        if offer.max_amount is None
                        else f"{offer.max_amount:.2f}",
                        "is_test": offer.mode == "sandbox",
                    }
                    for offer in offers
                ]
            }
        )


class PaymentDetailView(generics.RetrieveAPIView):
    serializer_class = PaymentSerializer
    lookup_field = "public_id"

    def get_queryset(self):
        return own_payments(self.request.user)

    @extend_schema(tags=["payments"])
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)


# --------------------------------------------------------------------------------------
# Provider-facing
# --------------------------------------------------------------------------------------
class _ProviderView(PublicAPIMixin, APIView):
    parser_classes = [FormParser, MultiPartParser, JSONParser]
    throttle_classes = [PaymentCallbackThrottle]

    @staticmethod
    def _data(request) -> dict:
        source = request.data if request.method == "POST" else request.query_params
        try:
            return {str(k): str(v) for k, v in source.items()}
        except AttributeError:
            return {}

    @staticmethod
    def _process(request, provider: str, kind: str):
        try:
            return services.process_callback(
                provider, kind, _ProviderView._data(request), ip=get_client_ip(request)
            )
        except Exception:  # noqa: BLE001 — never leak internals to a provider/browser
            logger.exception(
                "Payment callback processing failed provider=%s kind=%s", provider, kind
            )
            return None


def _return_redirect(url: str) -> HttpResponseRedirect:
    """Redirect to the server-configured return page; its scheme may be an app scheme
    (e.g. ``mcqapp://payment-result``). The target never comes from the request."""
    scheme = urllib.parse.urlparse(url).scheme
    response_class = type(
        "PaymentReturnRedirect",
        (HttpResponseRedirect,),
        {"allowed_schemes": ["https", "http", scheme]},
    )
    return response_class(url)


@extend_schema(exclude=True)
class PaymentCallbackView(_ProviderView):
    """Browser return from the provider. Verifies with the provider, then redirects to
    the server-configured return page (never a URL from the request)."""

    http_method_names = ["get", "post", "options"]

    def _handle(self, request, provider, kind):
        payment = self._process(request, provider, kind)
        params = {"status": payment.status if payment is not None else "unknown"}
        if payment is not None:
            params["payment"] = str(payment.public_id)
        # The website and the app have different return pages; the payment remembers which
        # one it was started from (and its gateway may carry its own).
        target = (
            gateway_manager.return_url_for(payment)
            if payment is not None
            else settings.PAYMENT_RETURN_URL
        )
        if target:
            separator = "&" if "?" in target else "?"
            return _return_redirect(target + separator + urllib.parse.urlencode(params))
        return Response(params)

    def get(self, request, provider, kind):
        return self._handle(request, provider, kind)

    def post(self, request, provider, kind):
        return self._handle(request, provider, kind)


@extend_schema(exclude=True)
class PaymentIPNView(_ProviderView):
    """Server-to-server notification. Always the same small ``200`` so provider retries
    are harmless and nothing about our records leaks."""

    http_method_names = ["post", "options"]

    def post(self, request, provider):
        self._process(request, provider, CallbackKind.IPN)
        return Response({"status": "received"})


@extend_schema(exclude=True)
class MockCheckoutView(PublicAPIMixin, APIView):
    """The mock provider's checkout page (development only): records the outcome in the
    mock ledger and returns to our callback like a real provider would."""

    http_method_names = ["get", "options"]

    def get(self, request, reference):
        if not is_enabled(PaymentProvider.MOCK):
            raise Http404
        result = request.query_params.get("result", "")
        if result not in mock_gateway.RESULTS:
            return Response(
                {"choose": sorted(f"?result={name}" for name in mock_gateway.RESULTS)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not Payment.objects.filter(
            merchant_reference=reference, provider=PaymentProvider.MOCK
        ).exists():
            raise Http404
        try:
            val_id = mock_gateway.complete(reference, result)
        except KeyError as exc:
            raise Http404 from exc
        urls = services.callback_urls(PaymentProvider.MOCK)
        target = {"success": urls.success, "fail": urls.fail, "cancel": urls.cancel}[result]
        query = urllib.parse.urlencode({"tran_id": reference, "val_id": val_id})
        return HttpResponseRedirect(f"{target}?{query}")


# --------------------------------------------------------------------------------------
# Admin
# --------------------------------------------------------------------------------------
def _admin_queryset():
    return Payment.objects.select_related("user", "package")


def _ordering(request) -> list:
    """Allowed fields only; ``verified_at`` sorts unverified payments (no time) last in
    both directions; ``id`` keeps the order stable."""
    ordering = []
    for field in query_ordering(request, PAYMENT_ORDERING, ("-created_at",)):
        if field.lstrip("-") == "verified_at":
            expression = F("verified_at")
            field = (
                expression.desc(nulls_last=True)
                if field.startswith("-")
                else expression.asc(nulls_last=True)
            )
        ordering.append(field)
    return ordering


def _query_date(request, name):
    raw = request.query_params.get(name, "").strip()
    if not raw:
        return None
    try:
        value = parse_date(raw)
    except ValueError:
        value = None
    if value is None:
        raise serializers.ValidationError({name: [INVALID_DATE_MESSAGE]})
    return value


@extend_schema_view(
    get=extend_schema(
        parameters=[
            OpenApiParameter("status", OpenApiTypes.STR, enum=PaymentStatus.values),
            OpenApiParameter("provider", OpenApiTypes.STR, enum=PaymentProvider.values),
            OpenApiParameter("user", OpenApiTypes.INT),
            OpenApiParameter("package", OpenApiTypes.INT),
            OpenApiParameter(
                "subscription",
                OpenApiTypes.INT,
                description="Payments that created or extended this subscription",
            ),
            OpenApiParameter("created_from", OpenApiTypes.DATE, description="UTC date, inclusive"),
            OpenApiParameter("created_to", OpenApiTypes.DATE, description="UTC date, inclusive"),
            OpenApiParameter(
                "search", OpenApiTypes.STR, description="Merchant reference or transaction ID"
            ),
            OpenApiParameter(
                "ordering",
                OpenApiTypes.STR,
                description="Comma-separated; '-' = descending. Fields: "
                + ", ".join(PAYMENT_ORDERING)
                + ". Unverified payments sort last by verified_at (both directions).",
            ),
        ]
    )
)
class AdminPaymentListView(AdminAPIMixin, generics.ListAPIView):
    serializer_class = AdminPaymentSerializer

    def get_queryset(self):
        request = self.request
        queryset = _admin_queryset()
        for name, choices in (
            ("status", PaymentStatus.values),
            ("provider", PaymentProvider.values),
        ):
            value = query_choice(request, name, choices)
            if value:
                queryset = queryset.filter(**{name: value})
        for name in ("user", "package", "subscription"):
            value = query_int(request, name)
            if value is not None:
                queryset = queryset.filter(**{f"{name}_id": value})
        created_from = _query_date(request, "created_from")
        if created_from:
            queryset = queryset.filter(created_at__date__gte=created_from)
        created_to = _query_date(request, "created_to")
        if created_to:
            queryset = queryset.filter(created_at__date__lte=created_to)
        search = query_search(request)
        if search:
            queryset = queryset.filter(merchant_reference__iexact=search) | queryset.filter(
                provider_transaction_id__iexact=search
            )
        return queryset.order_by(*_ordering(request))


class AdminPaymentDetailView(AdminAPIMixin, generics.RetrieveAPIView):
    """One payment with an allow-listed verification summary and the latest events."""

    serializer_class = AdminPaymentDetailSerializer
    lookup_field = "public_id"

    def get_queryset(self):
        return _admin_queryset()

    def get_object(self):
        return with_timeline(super().get_object())


class AdminPaymentReverifyView(AdminAPIMixin, APIView):
    """Ask the provider again and apply its answer (same rules as callbacks). Audited.
    Never sets a status by itself. A successful payment is final (409), and each payment
    is queried at most once per ``PAYMENT_REVERIFY_COOLDOWN_SECONDS`` (429)."""

    http_method_names = ["post", "options"]

    @extend_schema(
        request=None,
        responses={
            200: AdminPaymentDetailSerializer,
            409: OpenApiResponse(
                description="`already_successful` (a successful payment is final) or "
                "`provider_disabled`."
            ),
            429: OpenApiResponse(
                description="`reverify_too_soon`: this payment was checked with the provider "
                "within the cooldown (a callback, reconciliation or another re-verify); "
                "`Retry-After` gives the seconds to wait."
            ),
        },
    )
    def post(self, request, public_id):
        generics.get_object_or_404(Payment.objects.all(), public_id=public_id)
        try:
            payment = services.admin_reverify(public_id, ctx=AuditContext.from_request(request))
        except PaymentError as exc:
            raise _api_error(exc) from exc
        payment = with_timeline(_admin_queryset().get(pk=payment.pk))
        return Response(AdminPaymentDetailSerializer(payment, context={"request": request}).data)
