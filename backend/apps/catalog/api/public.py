"""Public category list (``GET /api/v1/public/categories/``, no login): active
categories with their active subjects, localized, in admin-defined order."""

from django.db.models import Prefetch
from rest_framework import generics, serializers

from apps.core.public_api import LocalizedSerializer, PublicAPIMixin

from ..models import Category, Subject


class PublicSubjectSerializer(LocalizedSerializer):
    slug = serializers.CharField()
    name = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()

    def get_name(self, obj) -> str:
        return self.text(obj, "name")

    def get_description(self, obj) -> str:
        return self.text(obj, "description")


class PublicCategorySerializer(PublicSubjectSerializer):
    subjects = PublicSubjectSerializer(source="active_subjects", many=True)


class PublicCategoryListView(PublicAPIMixin, generics.ListAPIView):
    serializer_class = PublicCategorySerializer

    def get_queryset(self):
        subjects = Subject.objects.filter(is_active=True).order_by("sort_order", "id")
        return (
            Category.objects.filter(is_active=True)
            .prefetch_related(Prefetch("subjects", queryset=subjects, to_attr="active_subjects"))
            .order_by("sort_order", "id")
        )
