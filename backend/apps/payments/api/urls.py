from django.urls import path, re_path

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
]
