from django.urls import path

from .admin_views import AdminAttemptDetailView, AdminAttemptListView
from .views import (
    AnswerBatchView,
    AnswerView,
    AttemptDetailView,
    AttemptListView,
    AttemptStartView,
    SubmitView,
)

student_urlpatterns = [
    path("exams/<slug:slug>/attempts/", AttemptStartView.as_view(), name="attempt-start"),
    path("attempts/", AttemptListView.as_view(), name="attempt-list"),
    path("attempts/<uuid:public_id>/", AttemptDetailView.as_view(), name="attempt-detail"),
    path(
        "attempts/<uuid:public_id>/answers/",
        AnswerBatchView.as_view(),
        name="attempt-answers",
    ),
    path(
        "attempts/<uuid:public_id>/answers/<int:question_id>/",
        AnswerView.as_view(),
        name="attempt-answer",
    ),
    path("attempts/<uuid:public_id>/submit/", SubmitView.as_view(), name="attempt-submit"),
]

admin_urlpatterns = [
    path("attempts/", AdminAttemptListView.as_view(), name="attempt-list"),
    path("attempts/<uuid:public_id>/", AdminAttemptDetailView.as_view(), name="attempt-detail"),
]
