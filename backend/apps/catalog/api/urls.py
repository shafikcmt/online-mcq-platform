from django.urls import path

from .views import (
    CategoryDetailView,
    CategoryListCreateView,
    SubjectDetailView,
    SubjectListCreateView,
)

admin_urlpatterns = [
    path("categories/", CategoryListCreateView.as_view(), name="category-list"),
    path("categories/<int:pk>/", CategoryDetailView.as_view(), name="category-detail"),
    path("subjects/", SubjectListCreateView.as_view(), name="subject-list"),
    path("subjects/<int:pk>/", SubjectDetailView.as_view(), name="subject-detail"),
]
