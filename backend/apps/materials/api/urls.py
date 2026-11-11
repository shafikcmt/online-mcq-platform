from django.urls import path

from .views import (
    MaterialDetailView,
    MaterialListCreateView,
    MaterialPdfAdminView,
    PublicMaterialListView,
    PublicMaterialPdfView,
)

admin_urlpatterns = [
    path("materials/", MaterialListCreateView.as_view(), name="material-list"),
    path("materials/<int:pk>/", MaterialDetailView.as_view(), name="material-detail"),
    path("materials/<int:pk>/pdf/", MaterialPdfAdminView.as_view(), name="material-pdf"),
]

public_urlpatterns = [
    path("materials/", PublicMaterialListView.as_view(), name="material-list"),
    path("materials/<int:pk>/pdf/", PublicMaterialPdfView.as_view(), name="material-pdf"),
]
