"""Public category list (``GET /api/v1/public/categories/``, no login): active
categories with their active subjects, localized, in admin-defined order, plus how many
exams a student can see in each (``exam_count``: published, in an active subject or none —
the same rule as the public exam list) and how many scheduled exams are running in it right
now (``live_count``: the routine's rule, so "any time" exams never count as live)."""

from django.db.models import Count, F, OuterRef, Prefetch, Q, Subquery
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import generics, serializers

from apps.core.public_api import LocalizedSerializer, PublicAPIMixin

from ..models import Category, ExamGroup, Subject


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
    live_count = serializers.IntegerField()


class PublicCategoryListView(PublicAPIMixin, generics.ListAPIView):
    serializer_class = PublicCategorySerializer

    def get_queryset(self):
        from apps.exams.selectors import listable_exams, routine_exams

        now = timezone.now()
        live = (
            routine_exams(now)
            .filter(start_at__lte=now, category=OuterRef("pk"))
            .order_by()
            .values("category")
            .annotate(n=Count("pk"))
            .values("n")
        )

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
            .annotate(
                exam_count=Coalesce(Subquery(exams), 0), live_count=Coalesce(Subquery(live), 0)
            )
            .prefetch_related(Prefetch("subjects", queryset=subjects, to_attr="active_subjects"))
            .order_by("sort_order", "id")
        )


# ------------------------------------------------------------------------ exam groups
def annotated_groups(queryset, now=None, *, with_exams_only=False):
    """Active groups (under an active parent, if any) with what a student can see in each:
    ``exam_count`` = exams in the group plus those in its sub-groups, ``live_count`` = scheduled
    exams running now (the routine's rule), ``child_count`` = active sub-groups."""
    from apps.exams.models import ExamStatus
    from apps.exams.selectors import listable_exams, routine_exams

    now = now or timezone.now()

    def count(exams, field):
        return Coalesce(
            Subquery(
                exams.filter(**{field: OuterRef("pk")})
                .order_by()
                .values(field)
                .annotate(n=Count("pk"))
                .values("n")
            ),
            0,
        )

    live = routine_exams(now).filter(start_at__lte=now)
    rows = (
        queryset.filter(is_active=True, category__is_active=True)
        .filter(Q(parent__isnull=True) | Q(parent__is_active=True))
        .annotate(
            own_exams=count(listable_exams(), "group"),
            child_exams=count(listable_exams(), "group__parent"),
            own_live=count(live, "group"),
            child_live=count(live, "group__parent"),
            # Only sub-groups that hold a published exam: an empty shelf is never offered.
            child_count=Coalesce(
                Subquery(
                    ExamGroup.objects.filter(
                        parent=OuterRef("pk"), is_active=True, exams__status=ExamStatus.PUBLISHED
                    )
                    .order_by()
                    .values("parent")
                    .annotate(n=Count("pk", distinct=True))
                    .values("n")
                ),
                0,
            ),
        )
        .annotate(
            exam_count=F("own_exams") + F("child_exams"),
            live_count=F("own_live") + F("child_live"),
        )
        .select_related("category", "parent")
        .order_by("sort_order", "id")
    )
    return rows.filter(exam_count__gt=0) if with_exams_only else rows


class PublicGroupSerializer(PublicSubjectSerializer):
    exam_count = serializers.IntegerField()
    live_count = serializers.IntegerField()
    child_count = serializers.IntegerField()


class PublicGroupDetailSerializer(PublicGroupSerializer):
    """One group with where it sits (for the breadcrumb) and its sub-groups."""

    category = serializers.SerializerMethodField()
    parent = serializers.SerializerMethodField()
    children = serializers.SerializerMethodField()

    def _ref(self, obj):
        return None if obj is None else {"slug": obj.slug, "name": self.text(obj, "name")}

    def get_category(self, obj) -> dict:
        return self._ref(obj.category)

    def get_parent(self, obj) -> dict | None:
        return self._ref(obj.parent)

    def get_children(self, obj) -> list:
        rows = annotated_groups(ExamGroup.objects.filter(parent=obj), with_exams_only=True)
        return PublicGroupSerializer(rows, many=True, context=self.context).data


class PublicGroupListView(PublicAPIMixin, generics.ListAPIView):
    """``GET /public/groups/?category=<slug>`` = the category's top-level groups;
    add ``&parent=<slug>`` for that group's sub-groups."""

    serializer_class = PublicGroupSerializer

    def get_queryset(self):
        params = self.request.query_params
        category = params.get("category", "").strip().lower()[:140]
        parent = params.get("parent", "").strip().lower()[:140]
        queryset = ExamGroup.objects.all()
        if parent:
            queryset = queryset.filter(parent__slug=parent)
        else:
            queryset = queryset.filter(parent__isnull=True)
        if category:
            queryset = queryset.filter(category__slug=category)
        return annotated_groups(queryset, with_exams_only=True)


class PublicGroupDetailView(PublicAPIMixin, generics.RetrieveAPIView):
    serializer_class = PublicGroupDetailSerializer
    lookup_field = "slug"

    def get_queryset(self):
        return annotated_groups(ExamGroup.objects.all())
