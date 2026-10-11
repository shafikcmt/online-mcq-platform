from django.urls import path

from .views import QuestionDetailView, QuestionImageView, QuestionListCreateView

admin_urlpatterns = [
    path("questions/", QuestionListCreateView.as_view(), name="question-list"),
    path("questions/<int:pk>/", QuestionDetailView.as_view(), name="question-detail"),
    path("questions/<int:pk>/image/", QuestionImageView.as_view(), name="question-image"),
]
