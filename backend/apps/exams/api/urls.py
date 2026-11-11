from django.urls import path

from .views import (
    ExamArchiveView,
    ExamDetailView,
    ExamDuplicateView,
    ExamListCreateView,
    ExamPublishView,
    ExamQuestionsView,
    ExamResultsHideView,
    ExamResultsPublishView,
    ExamSyllabusView,
    ExamUnpublishView,
    PublicExamDetailView,
    PublicExamListView,
)

admin_urlpatterns = [
    path("exams/", ExamListCreateView.as_view(), name="exam-list"),
    path("exams/<int:pk>/", ExamDetailView.as_view(), name="exam-detail"),
    path("exams/<int:pk>/questions/", ExamQuestionsView.as_view(), name="exam-questions"),
    path("exams/<int:pk>/syllabus/", ExamSyllabusView.as_view(), name="exam-syllabus"),
    path("exams/<int:pk>/publish/", ExamPublishView.as_view(), name="exam-publish"),
    path("exams/<int:pk>/unpublish/", ExamUnpublishView.as_view(), name="exam-unpublish"),
    path("exams/<int:pk>/archive/", ExamArchiveView.as_view(), name="exam-archive"),
    path("exams/<int:pk>/duplicate/", ExamDuplicateView.as_view(), name="exam-duplicate"),
    path(
        "exams/<int:pk>/results/publish/",
        ExamResultsPublishView.as_view(),
        name="exam-results-publish",
    ),
    path("exams/<int:pk>/results/hide/", ExamResultsHideView.as_view(), name="exam-results-hide"),
]

public_urlpatterns = [
    path("exams/", PublicExamListView.as_view(), name="exam-list"),
    path("exams/<slug:slug>/", PublicExamDetailView.as_view(), name="exam-detail"),
]
