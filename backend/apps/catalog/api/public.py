"""Public category list (``GET /api/v1/public/categories/``, no login): active
categories with their active subjects, localized, in admin-defined order, plus how many
exams a student can see in each (``exam_count``: published, in an active subject or none —
the same rule as the public exam list)."""

from django.db.models import Count, OuterRef, Prefetch, Subquery
from django.db.models.functions import Coalesce
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
    exam_count = serializers.IntegerField()


class PublicCategoryListView(PublicAPIMixin, generics.ListAPIView):
    serializer_class = PublicCategorySerializer

    def get_queryset(self):
        from apps.exams.selectors import listable_exams

        subjects = Subject.objects.filter(is_active=True).order_by("sort_order", "id")
        exams = (
            listable_exams()
            .filter(category=OuterRef("pk"))
            .order_by()
            .values("category")
            .annotate(n=Count("pk"))
            .values("n")
        )
        return (
            Category.objects.filter(is_active=True)
            .annotate(exam_count=Coalesce(Subquery(exams), 0))
            .prefetch_related(Prefetch("subjects", queryset=subjects, to_attr="active_subjects"))
            .order_by("sort_order", "id")
        )
