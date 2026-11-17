"""Sample participants API.

Admin (admin session + CSRF + admin role; every write audited):
- ``POST sample-participants/bulk/`` — many names at once
- ``GET/POST sample-participants/``, ``sample-participants/{id}/`` get, update, delete
  (409 while the participant is in an exam)
- ``GET/PUT exams/{id}/sample-participants/`` — the exam's complete list with marks

Public (no login):
- ``GET exams/{slug}/participation/`` — real students and sample participants, counted separately
- ``GET exams/{slug}/sample-participants/`` — the labelled sample list, only while the exam's
  merit list is visible (the same rule as the real leaderboard)
"""

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Count
from django.http import Http404
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.services import AuditContext
from apps.core.admin_api import (
    AdminAPIMixin,
    query_bool,
    query_ordering,
    query_search,
    to_drf_validation_error,
)
from apps.core.exceptions import ApiError
from apps.core.public_api import PublicAPIMixin
from apps.exams.api.views import public_exams
from apps.exams.models import Exam
from apps.exams.selectors import with_question_totals
from apps.results.selectors import results_visible

from .. import selectors, services
from ..models import SampleEntry, SamplePerson
from .serializers import (
    BulkNamesResultSerializer,
    BulkNamesSerializer,
    EntryListOutSerializer,
    EntryListSerializer,
    ParticipationSerializer,
    PublicSampleListSerializer,
    SamplePersonSerializer,
)

ORDERING = ("id", "name", "created_at")


def _write(request, func, *args, **kwargs):
    try:
        return func(*args, ctx=AuditContext.from_request(request), **kwargs)
    except DjangoValidationError as exc:
        raise to_drf_validation_error(exc) from exc


@extend_schema_view(
    get=extend_schema(
        parameters=[
            OpenApiParameter("is_active", OpenApiTypes.BOOL),
            OpenApiParameter("search", OpenApiTypes.STR, description="Name."),
            OpenApiParameter(
                "ordering", OpenApiTypes.STR, description="Fields: " + ", ".join(ORDERING)
            ),
        ]
    )
)
class PersonListCreateView(AdminAPIMixin, generics.ListCreateAPIView):
    serializer_class = SamplePersonSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = SamplePerson.objects.annotate(exam_count=Count("entries"))
        is_active = query_bool(self.request, "is_active")
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active)
        search = query_search(self.request)
        if search:
            queryset = queryset.filter(name__icontains=search)
        return queryset.order_by(*query_ordering(self.request, ORDERING, ("name", "id")))

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        person = _write(request, services.create_person, SamplePerson(**serializer.validated_data))
        return Response(self.get_serializer(person).data, status=status.HTTP_201_CREATED)


class PersonBulkCreateView(AdminAPIMixin, APIView):
    """Add many sample participants at once from a list of names (all or none)."""

    http_method_names = ["post", "options"]

    @extend_schema(
        operation_id="admin_sample_participants_bulk",
        request=BulkNamesSerializer,
        responses={201: BulkNamesResultSerializer},
    )
    def post(self, request):
        serializer = BulkNamesSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        created, skipped = _write(
            request, services.create_people, serializer.validated_data["names"]
        )
        return Response(
            {"created": len(created), "skipped": skipped}, status=status.HTTP_201_CREATED
        )


class PersonDetailView(AdminAPIMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = SamplePersonSerializer
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return SamplePerson.objects.annotate(exam_count=Count("entries"))

    def update(self, request, *args, **kwargs):
        person = self.get_object()
        serializer = self.get_serializer(person, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        _write(request, services.update_person, person.pk, serializer.validated_data)
        return Response(self.get_serializer(self.get_queryset().get(pk=person.pk)).data)

    def destroy(self, request, *args, **kwargs):
        person = self.get_object()
        try:
            _write(request, services.delete_person, person.pk)
        except services.SampleInUse as exc:
            raise ApiError(
                status_code=status.HTTP_409_CONFLICT,
                code="in_use",
                message="This sample participant is in an exam. Remove it from the exams first.",
                details={"exam_count": exc.exams},
            ) from exc
        return Response(status=status.HTTP_204_NO_CONTENT)


class ExamEntriesView(AdminAPIMixin, APIView):
    """``GET`` the exam's sample participants; ``PUT`` replaces the COMPLETE list (with marks),
    atomically. Allowed on a published exam: it changes no question, scoring or real result."""

    http_method_names = ["get", "put", "options"]

    def _payload(self, exam_id):
        exam = with_question_totals(Exam.objects.filter(pk=exam_id)).get()
        rows = SampleEntry.objects.filter(exam_id=exam_id).select_related("person")
        return {
            "total_marks": exam.total_marks,
            "entries": [
                {
                    "person": row.person_id,
                    "name": row.person.name,
                    "is_active": row.person.is_active,
                    "marks": row.marks,
                }
                for row in rows
            ],
        }

    @extend_schema(operation_id="admin_exams_sample_get", responses=EntryListOutSerializer)
    def get(self, request, pk):
        generics.get_object_or_404(Exam.objects.all(), pk=pk)
        return Response(EntryListOutSerializer(self._payload(pk)).data)

    @extend_schema(
        operation_id="admin_exams_sample_set",
        request=EntryListSerializer,
        responses=EntryListOutSerializer,
    )
    def put(self, request, pk):
        generics.get_object_or_404(Exam.objects.all(), pk=pk)
        serializer = EntryListSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _write(request, services.set_exam_entries, pk, serializer.validated_data["entries"])
        return Response(EntryListOutSerializer(self._payload(pk)).data)


# --------------------------------------------------------------------------------------
# Public
# --------------------------------------------------------------------------------------
class ParticipationView(PublicAPIMixin, APIView):
    http_method_names = ["get", "options"]

    @extend_schema(
        operation_id="public_exam_participation", responses=ParticipationSerializer, tags=["public"]
    )
    def get(self, request, slug):
        exam = generics.get_object_or_404(public_exams(), slug=slug)
        real = selectors.real_participant_count(exam.pk)
        sample = selectors.sample_count(exam.pk)
        return Response({"real_count": real, "sample_count": sample, "total_count": real + sample})


class PublicSampleListView(PublicAPIMixin, APIView):
    """The labelled sample participants of a published exam, best marks first, with no rank. Hidden
    (404) until the real merit list is visible, like the leaderboard itself."""

    http_method_names = ["get", "options"]

    @extend_schema(
        operation_id="public_exam_sample_participants",
        responses=PublicSampleListSerializer,
        tags=["public"],
    )
    def get(self, request, slug):
        exam = generics.get_object_or_404(with_question_totals(public_exams()), slug=slug)
        if not exam.merit_enabled or not results_visible(exam, timezone.now()):
            raise Http404
        entries = list(selectors.sample_entries(exam))
        positions = selectors.positions_by_marks(exam, [entry.marks for entry in entries])
        rows = [
            {
                "name": entry.person.name,
                "marks": entry.marks,
                "percentage": selectors.percentage(entry.marks, exam.total_marks),
                "is_sample": True,
                "position_by_marks": position,
            }
            for entry, position in zip(entries, positions, strict=True)
        ]
        payload = {"count": len(rows), "total_marks": exam.total_marks, "results": rows}
        return Response(PublicSampleListSerializer(payload).data)
