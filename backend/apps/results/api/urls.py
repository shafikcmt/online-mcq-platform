from django.urls import path

from .views import (
    AdminResultListView,
    ExamLeaderboardView,
    MeritGenerateView,
    MyResultListView,
    PublicLeaderboardExamListView,
    PublicLeaderboardView,
    ResultDetailView,
    ResultReviewView,
)

student_urlpatterns = [
    path("results/", MyResultListView.as_view(), name="result-list"),
    path("results/<uuid:attempt_id>/", ResultDetailView.as_view(), name="result-detail"),
    path("results/<uuid:attempt_id>/review/", ResultReviewView.as_view(), name="result-review"),
    path("exams/<slug:slug>/leaderboard/", ExamLeaderboardView.as_view(), name="leaderboard"),
]

public_urlpatterns = [
    path("leaderboards/", PublicLeaderboardExamListView.as_view(), name="leaderboard-list"),
    path(
        "exams/<slug:slug>/leaderboard/", PublicLeaderboardView.as_view(), name="exam-leaderboard"
    ),
]

admin_urlpatterns = [
    path("results/", AdminResultListView.as_view(), name="result-list"),
    path("exams/<int:pk>/merit/generate/", MeritGenerateView.as_view(), name="merit-generate"),
]
