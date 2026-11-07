"""Admin API for payment gateways (``/api/v1/admin/payment-gateways/…``).

Admin session + CSRF + admin role (``AdminAPIMixin``). Credential and mode changes also
need ``password`` (the admin's own). No response ever carries a secret: credentials are
reported as ``{set, hint}`` only.
"""

from contextlib import contextmanager

from django.core.exceptions import ValidationError as DjangoValidationError
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.services import AuditContext
from apps.core.admin_api import AdminAPIMixin, to_drf_validation_error
from apps.core.exceptions import ApiError

from .. import gateway_admin as admin
from ..models import PaymentGateway, PaymentGatewayLog, PaymentTester


@contextmanager
def _errors():
    """Turn the service layer's refusals into the API's standard error envelope."""
    try:
        yield
    except admin.GatewayAdminError as exc:
        raise ApiError(
            status_code=exc.status, code=exc.code, message=str(exc.message), details=exc.details
        ) from exc
    except DjangoValidationError as exc:
        raise to_drf_validation_error(exc) from exc


def _body(request) -> dict:
    data = request.data
    return dict(data) if hasattr(data, "items") else {}


def _ctx(request) -> AuditContext:
    return AuditContext.from_request(request)


class AdaptersView(AdminAPIMixin, APIView):
    """The providers the system knows, what each supports and the fields its form needs.
    Providers without an adapter (Nagad, Rocket direct) are listed as not implemented."""

    http_method_names = ["get", "options"]

    @extend_schema(
        operation_id="admin_payment_gateways_adapters_list",
        tags=["payment-gateways"],
        responses=dict,
    )
    def get(self, request):
        return Response({"results": admin.adapters_view()})


class GatewayListCreateView(AdminAPIMixin, APIView):
    http_method_names = ["get", "post", "options"]

    @extend_schema(
        operation_id="admin_payment_gateways_list", tags=["payment-gateways"], responses=dict
    )
    def get(self, request):
        rows = PaymentGateway.objects.all()
        return Response({"results": [admin.gateway_view(row) for row in rows]})

    @extend_schema(
        operation_id="admin_payment_gateways_create",
        tags=["payment-gateways"],
        request=dict,
        responses=dict,
    )
    def post(self, request):
        with _errors():
            gateway = admin.create_gateway(_body(request), ctx=_ctx(request))
        return Response(admin.gateway_view(gateway), status=status.HTTP_201_CREATED)


class GatewayDetailView(AdminAPIMixin, APIView):
    http_method_names = ["get", "patch", "options"]

    @extend_schema(
        operation_id="admin_payment_gateways_detail", tags=["payment-gateways"], responses=dict
    )
    def get(self, request, public_id):
        return Response(admin.gateway_view(admin.get_gateway_row(public_id)))

    @extend_schema(
        operation_id="admin_payment_gateways_update",
        tags=["payment-gateways"],
        request=dict,
        responses=dict,
    )
    def patch(self, request, public_id):
        gateway = admin.get_gateway_row(public_id)
        with _errors():
            gateway = admin.update_gateway(gateway, _body(request), ctx=_ctx(request))
        return Response(admin.gateway_view(gateway))


class GatewayCredentialsView(AdminAPIMixin, APIView):
    """``POST {mode, values: {field: secret}, password}``: write-only; blank values keep the
    stored secret. The answer lists which fields are set (hints only)."""

    http_method_names = ["post", "options"]

    @extend_schema(
        operation_id="admin_payment_gateways_credentials_set",
        tags=["payment-gateways"],
        request=dict,
        responses=dict,
    )
    def post(self, request, public_id):
        gateway = admin.get_gateway_row(public_id)
        body = _body(request)
        with _errors():
            changed = admin.set_credentials(
                gateway,
                body.get("mode"),
                body.get("values"),
                user=request.user,
                password=body.get("password"),
                ctx=_ctx(request),
            )
        return Response({"changed": changed, "gateway": admin.gateway_view(gateway)})


class GatewayModeView(AdminAPIMixin, APIView):
    """``POST {mode, password}``: sandbox ⇄ live. Live is refused (409 ``live_not_ready``)
    without the live credentials and a successful sandbox payment on this gateway."""

    http_method_names = ["post", "options"]

    @extend_schema(
        operation_id="admin_payment_gateways_mode_set",
        tags=["payment-gateways"],
        request=dict,
        responses=dict,
    )
    def post(self, request, public_id):
        gateway = admin.get_gateway_row(public_id)
        body = _body(request)
        with _errors():
            gateway = admin.change_mode(
                gateway,
                body.get("mode"),
                user=request.user,
                password=body.get("password"),
                ctx=_ctx(request),
            )
        return Response(admin.gateway_view(gateway))


class _SwitchView(AdminAPIMixin, APIView):
    http_method_names = ["post", "options"]
    enable = True

    def _switch(self, request, public_id):
        gateway = admin.get_gateway_row(public_id)
        with _errors():
            gateway = admin.set_enabled(gateway, self.enable, ctx=_ctx(request))
        return Response(admin.gateway_view(gateway))


class GatewayEnableView(_SwitchView):
    enable = True

    @extend_schema(
        operation_id="admin_payment_gateways_enable",
        tags=["payment-gateways"],
        request=None,
        responses=dict,
    )
    def post(self, request, public_id):
        return self._switch(request, public_id)


class GatewayDisableView(_SwitchView):
    enable = False

    @extend_schema(
        operation_id="admin_payment_gateways_disable",
        tags=["payment-gateways"],
        request=None,
        responses=dict,
    )
    def post(self, request, public_id):
        return self._switch(request, public_id)


class GatewayTestView(AdminAPIMixin, APIView):
    """Check the credentials with the provider (no payment is started)."""

    http_method_names = ["post", "options"]

    @extend_schema(
        operation_id="admin_payment_gateways_test",
        tags=["payment-gateways"],
        request=None,
        responses=dict,
    )
    def post(self, request, public_id):
        gateway = admin.get_gateway_row(public_id)
        with _errors():
            result = admin.test_connection(gateway, ctx=_ctx(request))
        gateway.refresh_from_db()
        return Response({"result": result, "gateway": admin.gateway_view(gateway)})


class GatewayLogView(AdminAPIMixin, APIView):
    http_method_names = ["get", "options"]
    LIMIT = 100

    @extend_schema(
        operation_id="admin_payment_gateways_logs", tags=["payment-gateways"], responses=dict
    )
    def get(self, request, public_id):
        gateway = admin.get_gateway_row(public_id)
        rows = PaymentGatewayLog.objects.filter(gateway=gateway).select_related("actor")[
            : self.LIMIT
        ]
        return Response(
            {
                "results": [
                    {
                        "id": row.pk,
                        "event_type": row.event_type,
                        "summary": row.summary,
                        "details": row.details,
                        "actor": row.actor.full_name if row.actor else "",
                        "created_at": row.created_at,
                    }
                    for row in rows
                ]
            }
        )


class GatewayStatsView(AdminAPIMixin, APIView):
    http_method_names = ["get", "options"]

    @extend_schema(
        operation_id="admin_payment_gateways_stats", tags=["payment-gateways"], responses=dict
    )
    def get(self, request):
        return Response(admin.stats())


class TesterListCreateView(AdminAPIMixin, APIView):
    """Student accounts allowed to pay through sandbox gateways."""

    http_method_names = ["get", "post", "options"]

    @extend_schema(
        operation_id="admin_payment_gateways_testers_list",
        tags=["payment-gateways"],
        responses=dict,
    )
    def get(self, request):
        rows = PaymentTester.objects.select_related("user")
        return Response({"results": [admin.tester_view(row) for row in rows]})

    @extend_schema(
        operation_id="admin_payment_gateways_testers_add",
        tags=["payment-gateways"],
        request=dict,
        responses=dict,
    )
    def post(self, request):
        user_id = _body(request).get("user_id")
        if isinstance(user_id, bool) or not isinstance(user_id, int):
            raise to_drf_validation_error(
                DjangoValidationError({"user_id": DjangoValidationError("Send the student's id.")})
            )
        with _errors():
            tester = admin.add_tester(user_id, ctx=_ctx(request))
        return Response(admin.tester_view(tester), status=status.HTTP_201_CREATED)


class TesterDetailView(AdminAPIMixin, APIView):
    http_method_names = ["delete", "options"]

    @extend_schema(
        operation_id="admin_payment_gateways_testers_remove",
        tags=["payment-gateways"],
        responses={204: None},
    )
    def delete(self, request, user_id):
        with _errors():
            admin.remove_tester(user_id, ctx=_ctx(request))
        return Response(status=status.HTTP_204_NO_CONTENT)


class TestSubscriptionRevokeView(AdminAPIMixin, APIView):
    """Cancel a test subscription (one made by a sandbox payment) immediately."""

    http_method_names = ["post", "options"]

    @extend_schema(
        operation_id="admin_payment_gateways_test_subscription_revoke",
        tags=["payment-gateways"],
        request=None,
        responses=dict,
    )
    def post(self, request, subscription_id):
        from apps.subscriptions.exceptions import SubscriptionError

        try:
            subscription = admin.revoke_test_subscription(subscription_id, ctx=_ctx(request))
        except SubscriptionError as exc:
            raise ApiError(
                status_code=status.HTTP_409_CONFLICT,
                code=exc.code,
                message=str(exc.message),
                details=exc.details,
            ) from exc
        return Response({"id": subscription.pk, "status": subscription.status})
