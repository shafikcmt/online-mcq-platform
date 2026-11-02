from django.urls import path

from .views import (
    MySubscriptionListView,
    PackageAccessRulesView,
    PackageDetailView,
    PackageListCreateView,
    PublicPackageListView,
    StudentPackageListView,
    SubscriptionCancelView,
    SubscriptionDetailView,
    SubscriptionGrantView,
    SubscriptionListView,
)

admin_urlpatterns = [
    path("packages/", PackageListCreateView.as_view(), name="package-list"),
    path("packages/<int:pk>/", PackageDetailView.as_view(), name="package-detail"),
    path(
        "packages/<int:pk>/access-rules/",
        PackageAccessRulesView.as_view(),
        name="package-access-rules",
    ),
    path("subscriptions/", SubscriptionListView.as_view(), name="subscription-list"),
    path("subscriptions/grant/", SubscriptionGrantView.as_view(), name="subscription-grant"),
    path("subscriptions/<int:pk>/", SubscriptionDetailView.as_view(), name="subscription-detail"),
    path(
        "subscriptions/<int:pk>/cancel/",
        SubscriptionCancelView.as_view(),
        name="subscription-cancel",
    ),
]

me_urlpatterns = [
    path("subscriptions/", MySubscriptionListView.as_view(), name="my-subscriptions"),
]

# Student JWT (app): packages with the caller's own subscription state.
student_urlpatterns = [
    path("packages/", StudentPackageListView.as_view(), name="student-package-list"),
]

public_urlpatterns = [
    path("packages/", PublicPackageListView.as_view(), name="package-list"),
]
