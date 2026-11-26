from django.urls import path

from .public import PublicCategoryListView, PublicGroupDetailView, PublicGroupListView
from .views import (
    CategoryDetailView,
    CategoryListCreateView,
    GroupDetailView,
    GroupListCreateView,
    SubjectDetailView,
    SubjectListCreateView,
)

admin_urlpatterns = [
    path("categories/", CategoryListCreateView.as_view(), name="category-list"),
    path("categories/<int:pk>/", CategoryDetailView.as_view(), name="category-detail"),
    path("groups/", GroupListCreateView.as_view(), name="group-list"),
    path("groups/<int:pk>/", GroupDetailView.as_view(), name="group-detail"),
    path("subjects/", SubjectListCreateView.as_view(), name="subject-list"),
    path("subjects/<int:pk>/", SubjectDetailView.as_view(), name="subject-detail"),
]

public_urlpatterns = [
    path("categories/", PublicCategoryListView.as_view(), name="category-list"),
    path("groups/", PublicGroupListView.as_view(), name="public-group-list"),
    path("groups/<slug:slug>/", PublicGroupDetailView.as_view(), name="public-group-detail"),
]
