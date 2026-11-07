from django.urls import path, re_path

from .gateway_views import (
    AdaptersView,
    GatewayCredentialsView,
    GatewayDetailView,
    GatewayDisableView,
    GatewayEnableView,
    GatewayListCreateView,
    GatewayLogView,
    GatewayModeView,
    GatewayStatsView,
    GatewayTestView,
    TesterDetailView,
    TesterListCreateView,
    TestSubscriptionRevokeView,
)
from .views import (
    AdminPaymentDetailView,
    AdminPaymentListView,
    AdminPaymentReverifyView,
    MockCheckoutView,
    PaymentCallbackView,
    PaymentDetailView,
    PaymentIPNView,
    PaymentListCreateView,
    PaymentMethodsView,
)

PROVIDER = r"(?P<provider>[a-z0-9_]{1,20})"

student_urlpatterns = [
    path("payments/", PaymentListCreateView.as_view(), name="payment-list"),
    path("payments/methods/", PaymentMethodsView.as_view(), name="payment-methods"),
    path("payments/<uuid:public_id>/", PaymentDetailView.as_view(), name="payment-detail"),
    # Provider-facing (no login): only trigger a server-side verification.
    re_path(
        rf"^payments/callback/{PROVIDER}/(?P<kind>success|fail|cancel)/$",
        PaymentCallbackView.as_view(),
        name="payment-callback",
    ),
    re_path(rf"^payments/ipn/{PROVIDER}/$", PaymentIPNView.as_view(), name="payment-ipn"),
    re_path(
        r"^payments/mock/checkout/(?P<reference>[A-Z0-9]{1,30})/$",
        MockCheckoutView.as_view(),
        name="payment-mock-checkout",
    ),
]

admin_urlpatterns = [
    path("payments/", AdminPaymentListView.as_view(), name="payment-list"),
    path("payments/<uuid:public_id>/", AdminPaymentDetailView.as_view(), name="payment-detail"),
    path(
        "payments/<uuid:public_id>/reverify/",
        AdminPaymentReverifyView.as_view(),
        name="payment-reverify",
    ),
    # Dynamic payment gateways (Settings → Payment gateways).
    path("payment-gateways/", GatewayListCreateView.as_view(), name="gateway-list"),
    path("payment-gateways/adapters/", AdaptersView.as_view(), name="gateway-adapters"),
    path("payment-gateways/stats/", GatewayStatsView.as_view(), name="gateway-stats"),
    path("payment-gateways/<uuid:public_id>/", GatewayDetailView.as_view(), name="gateway-detail"),
    path(
        "payment-gateways/<uuid:public_id>/credentials/",
        GatewayCredentialsView.as_view(),
        name="gateway-credentials",
    ),
    path("payment-gateways/<uuid:public_id>/mode/", GatewayModeView.as_view(), name="gateway-mode"),
    path(
        "payment-gateways/<uuid:public_id>/enable/",
        GatewayEnableView.as_view(),
        name="gateway-enable",
    ),
    path(
        "payment-gateways/<uuid:public_id>/disable/",
        GatewayDisableView.as_view(),
        name="gateway-disable",
    ),
    path("payment-gateways/<uuid:public_id>/test/", GatewayTestView.as_view(), name="gateway-test"),
    path("payment-gateways/<uuid:public_id>/logs/", GatewayLogView.as_view(), name="gateway-logs"),
    path("payment-testers/", TesterListCreateView.as_view(), name="tester-list"),
    path("payment-testers/<int:user_id>/", TesterDetailView.as_view(), name="tester-detail"),
    path(
        "test-subscriptions/<int:subscription_id>/revoke/",
        TestSubscriptionRevokeView.as_view(),
        name="test-subscription-revoke",
    ),
]
