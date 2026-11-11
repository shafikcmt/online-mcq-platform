from django.urls import path

from .views import (
    ExamEntriesView,
    ParticipationView,
    PersonDetailView,
    PersonListCreateView,
    PublicSampleListView,
)

admin_urlpatterns = [
    path("sample-participants/", PersonListCreateView.as_view(), name="sample-person-list"),
    path("sample-participants/<int:pk>/", PersonDetailView.as_view(), name="sample-person-detail"),
    path(
        "exams/<int:pk>/sample-participants/", ExamEntriesView.as_view(), name="exam-sample-entries"
    ),
]

public_urlpatterns = [
    path("exams/<slug:slug>/participation/", ParticipationView.as_view(), name="participation"),
    path(
        "exams/<slug:slug>/sample-participants/",
        PublicSampleListView.as_view(),
        name="sample-participants",
    ),
]
