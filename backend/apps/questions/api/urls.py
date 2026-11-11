from django.urls import path

from .import_views import QuestionImportTemplateView, QuestionImportView
from .views import QuestionDetailView, QuestionImageView, QuestionListCreateView

admin_urlpatterns = [
    path("questions/", QuestionListCreateView.as_view(), name="question-list"),
    path("questions/import/", QuestionImportView.as_view(), name="question-import"),
    path(
        "questions/import/template/",
        QuestionImportTemplateView.as_view(),
        name="question-import-template",
    ),
    path("questions/<int:pk>/", QuestionDetailView.as_view(), name="question-detail"),
    path("questions/<int:pk>/image/", QuestionImageView.as_view(), name="question-image"),
]
