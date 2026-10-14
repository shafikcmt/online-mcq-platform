from django.urls import path

from .views import (
    AnnouncementDetailView,
    AnnouncementListCreateView,
    ContactMessageDetailView,
    ContactMessageListView,
    FaqDetailView,
    FaqListCreateView,
    PageDetailView,
    PageListCreateView,
    PublicAnnouncementListView,
    PublicAppLinksView,
    PublicContactView,
    PublicFaqListView,
    PublicPageView,
    PublicSettingsView,
    SiteSettingsAdminView,
    StudentAnnouncementListView,
)

admin_urlpatterns = [
    path("settings/", SiteSettingsAdminView.as_view(), name="site-settings"),
    path("announcements/", AnnouncementListCreateView.as_view(), name="announcement-list"),
    path("announcements/<int:pk>/", AnnouncementDetailView.as_view(), name="announcement-detail"),
    path("faqs/", FaqListCreateView.as_view(), name="faq-list"),
    path("faqs/<int:pk>/", FaqDetailView.as_view(), name="faq-detail"),
    path("pages/", PageListCreateView.as_view(), name="page-list"),
    path("pages/<int:pk>/", PageDetailView.as_view(), name="page-detail"),
    path("contact-messages/", ContactMessageListView.as_view(), name="contact-message-list"),
    path(
        "contact-messages/<int:pk>/",
        ContactMessageDetailView.as_view(),
        name="contact-message-detail",
    ),
]

public_urlpatterns = [
    path("settings/", PublicSettingsView.as_view(), name="settings"),
    path("app-links/", PublicAppLinksView.as_view(), name="app-links"),
    path("announcements/", PublicAnnouncementListView.as_view(), name="announcement-list"),
    path("faqs/", PublicFaqListView.as_view(), name="faq-list"),
    path("pages/<slug:slug>/", PublicPageView.as_view(), name="page-detail"),
    path("contact/", PublicContactView.as_view(), name="contact"),
]

student_urlpatterns = [
    path("announcements/", StudentAnnouncementListView.as_view(), name="announcement-list"),
]
