"""CMS API.

Admin (``/api/v1/admin/…``; admin session + CSRF + admin role; every write audited):
- ``GET/PATCH settings/``
- ``announcements/``, ``faqs/``, ``pages/`` — list/create and ``{id}/`` get/update/delete
- ``contact-messages/`` list, ``contact-messages/{id}/`` get + ``PATCH {status}``

Public (``/api/v1/public/…``; no login; published/active content only, localized):
- ``settings/``, ``app-links/``, ``announcements/``, ``faqs/``, ``pages/{slug}/``
- ``POST contact/`` — throttled, honeypot, always a generic ``202``

Student (student JWT): ``GET /api/v1/announcements/`` — notices for students + everyone.
"""

import logging
import re
from types import SimpleNamespace

from django.conf import settings
from django.core import signing
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Q
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import generics, serializers, status
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.services import AuditContext
from apps.core import documents
from apps.core.admin_api import (
    AdminAPIMixin,
    query_bool,
    query_choice,
    query_ordering,
    query_search,
    to_drf_validation_error,
)
from apps.core.exceptions import ApiError
from apps.core.net import get_client_ip
from apps.core.public_api import PublicAPIMixin
from apps.core.throttling import DocumentUploadThrottle, SecurityThrottle

from .. import selectors, services
from ..app_version import update_state
from ..models import (
    Announcement,
    Audience,
    ContactMessage,
    ContactStatus,
    Faq,
    LanguageChoice,
    Page,
)
from .serializers import (
    AnnouncementAdminSerializer,
    ContactFormSerializer,
    ContactMessageAdminSerializer,
    ContactStatusSerializer,
    FaqAdminSerializer,
    PageAdminSerializer,
    PublicAnnouncementSerializer,
    PublicAppLinksSerializer,
    PublicAppUpdateSerializer,
    PublicFaqSerializer,
    PublicPageSerializer,
    PublicSettingsSerializer,
    SiteSettingsAdminSerializer,
)

logger = logging.getLogger(__name__)


def _write(request, func, *args, **kwargs):
    try:
        return func(*args, ctx=AuditContext.from_request(request), **kwargs)
    except DjangoValidationError as exc:
        raise to_drf_validation_error(exc) from exc


def _ordering_parameter(fields) -> OpenApiParameter:
    return OpenApiParameter(
        "ordering",
        OpenApiTypes.STR,
        description="Comma-separated; '-' = descending. Fields: " + ", ".join(fields),
    )


# --------------------------------------------------------------------------------------
# Admin: site settings
# --------------------------------------------------------------------------------------
class SiteSettingsAdminView(AdminAPIMixin, APIView):
    """The single settings row (environment defaults until first saved)."""

    http_method_names = ["get", "patch", "options"]

    @extend_schema(responses=SiteSettingsAdminSerializer)
    def get(self, request):
        return Response(SiteSettingsAdminSerializer(selectors.current_settings()).data)

    @extend_schema(request=SiteSettingsAdminSerializer, responses=SiteSettingsAdminSerializer)
    def patch(self, request):
        serializer = SiteSettingsAdminSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        row = _write(request, services.update_site_settings, serializer.validated_data)
        return Response(SiteSettingsAdminSerializer(row).data)


# --------------------------------------------------------------------------------------
# Admin: announcements, FAQ, pages (one pattern)
# --------------------------------------------------------------------------------------
class ContentListCreateView(AdminAPIMixin, generics.ListCreateAPIView):
    model = None
    ordering_fields: tuple = ()
    default_ordering: tuple = ()
    search_fields: tuple = ()
    http_method_names = ["get", "post", "head", "options"]

    def filter_queryset_by_params(self, queryset):
        return queryset

    def get_queryset(self):
        queryset = self.filter_queryset_by_params(self.model.objects.all())
        search = query_search(self.request)
        if search:
            condition = Q()
            for field in self.search_fields:
                condition |= Q(**{f"{field}__icontains": search})
            queryset = queryset.filter(condition)
        return queryset.order_by(
            *query_ordering(self.request, self.ordering_fields, self.default_ordering)
        )

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        instance = _write(request, services.create_content, self.model(**serializer.validated_data))
        return Response(self.get_serializer(instance).data, status=status.HTTP_201_CREATED)


class ContentDetailView(AdminAPIMixin, generics.RetrieveUpdateDestroyAPIView):
    model = None
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return self.model.objects.all()

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        updated = _write(
            request, services.update_content, self.model, instance.pk, serializer.validated_data
        )
        return Response(self.get_serializer(updated).data)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        _write(request, services.delete_content, self.model, instance.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)


ANNOUNCEMENT_ORDERING = ("id", "published_at", "expires_at", "created_at", "updated_at")


@extend_schema_view(
    get=extend_schema(
        parameters=[
            OpenApiParameter("audience", OpenApiTypes.STR, enum=Audience.values),
            OpenApiParameter("published", OpenApiTypes.BOOL, description="false = drafts"),
            OpenApiParameter("is_pinned", OpenApiTypes.BOOL),
            OpenApiParameter("exam", OpenApiTypes.INT, description="Exam id."),
            OpenApiParameter("search", OpenApiTypes.STR, description="Bangla/English title."),
            _ordering_parameter(ANNOUNCEMENT_ORDERING),
        ]
    )
)
class AnnouncementListCreateView(ContentListCreateView):
    model = Announcement
    serializer_class = AnnouncementAdminSerializer
    ordering_fields = ANNOUNCEMENT_ORDERING
    default_ordering = ("-created_at",)
    search_fields = ("title_bn", "title_en")

    def filter_queryset_by_params(self, queryset):
        audience = query_choice(self.request, "audience", Audience.values)
        if audience:
            queryset = queryset.filter(audience=audience)
        published = query_bool(self.request, "published")
        if published is not None:
            queryset = queryset.filter(published_at__isnull=not published)
        pinned = query_bool(self.request, "is_pinned")
        if pinned is not None:
            queryset = queryset.filter(is_pinned=pinned)
        exam = self.request.query_params.get("exam", "")
        if exam.isdigit():
            queryset = queryset.filter(exam_id=int(exam))
        return queryset.select_related("exam")


class AnnouncementDetailView(ContentDetailView):
    model = Announcement
    serializer_class = AnnouncementAdminSerializer


FAQ_ORDERING = ("id", "sort_order", "created_at", "updated_at")


@extend_schema_view(
    get=extend_schema(
        parameters=[
            OpenApiParameter("is_active", OpenApiTypes.BOOL),
            OpenApiParameter("search", OpenApiTypes.STR, description="Bangla/English question."),
            _ordering_parameter(FAQ_ORDERING),
        ]
    )
)
class FaqListCreateView(ContentListCreateView):
    model = Faq
    serializer_class = FaqAdminSerializer
    ordering_fields = FAQ_ORDERING
    default_ordering = ("sort_order",)
    search_fields = ("question_bn", "question_en")

    def filter_queryset_by_params(self, queryset):
        is_active = query_bool(self.request, "is_active")
        return queryset if is_active is None else queryset.filter(is_active=is_active)


class FaqDetailView(ContentDetailView):
    model = Faq
    serializer_class = FaqAdminSerializer


PAGE_ORDERING = ("id", "slug", "created_at", "updated_at")


@extend_schema_view(
    get=extend_schema(
        parameters=[
            OpenApiParameter("is_active", OpenApiTypes.BOOL),
            OpenApiParameter("search", OpenApiTypes.STR, description="Slug or title."),
            _ordering_parameter(PAGE_ORDERING),
        ]
    )
)
class PageListCreateView(ContentListCreateView):
    model = Page
    serializer_class = PageAdminSerializer
    ordering_fields = PAGE_ORDERING
    default_ordering = ("slug",)
    search_fields = ("slug", "title_bn", "title_en")

    def filter_queryset_by_params(self, queryset):
        is_active = query_bool(self.request, "is_active")
        return queryset if is_active is None else queryset.filter(is_active=is_active)


class PageDetailView(ContentDetailView):
    model = Page
    serializer_class = PageAdminSerializer


# --------------------------------------------------------------------------------------
# Admin: contact inbox
# --------------------------------------------------------------------------------------
CONTACT_ORDERING = ("id", "created_at", "updated_at", "status")


@extend_schema_view(
    get=extend_schema(
        parameters=[
            OpenApiParameter("status", OpenApiTypes.STR, enum=ContactStatus.values),
            OpenApiParameter("language", OpenApiTypes.STR, enum=LanguageChoice.values),
            OpenApiParameter(
                "search", OpenApiTypes.STR, description="Name, e-mail, phone or subject."
            ),
            _ordering_parameter(CONTACT_ORDERING),
        ]
    )
)
class ContactMessageListView(AdminAPIMixin, generics.ListAPIView):
    serializer_class = ContactMessageAdminSerializer

    def get_queryset(self):
        request = self.request
        queryset = ContactMessage.objects.select_related("handled_by")
        for name, choices in (
            ("status", ContactStatus.values),
            ("language", LanguageChoice.values),
        ):
            value = query_choice(request, name, choices)
            if value:
                queryset = queryset.filter(**{name: value})
        search = query_search(request)
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search)
                | Q(email__icontains=search)
                | Q(phone__icontains=search)
                | Q(subject__icontains=search)
            )
        return queryset.order_by(*query_ordering(request, CONTACT_ORDERING, ("-created_at",)))


class ContactMessageDetailView(AdminAPIMixin, generics.RetrieveAPIView):
    """Read a message; ``PATCH {"status": "new|read|resolved"}`` is the only change."""

    serializer_class = ContactMessageAdminSerializer
    http_method_names = ["get", "patch", "head", "options"]

    def get_queryset(self):
        return ContactMessage.objects.select_related("handled_by")

    @extend_schema(request=ContactStatusSerializer, responses=ContactMessageAdminSerializer)
    def patch(self, request, pk):
        message = self.get_object()
        serializer = ContactStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _write(
            request, services.set_contact_status, message.pk, serializer.validated_data["status"]
        )
        return Response(self.get_serializer(self.get_queryset().get(pk=message.pk)).data)


# --------------------------------------------------------------------------------------
# Public
# --------------------------------------------------------------------------------------
class PublicSettingsView(PublicAPIMixin, APIView):
    http_method_names = ["get", "options"]

    @extend_schema(responses=PublicSettingsSerializer)
    def get(self, request):
        data = PublicSettingsSerializer(
            selectors.current_settings(), context={"request": request}
        ).data
        return Response(data)


class PublicAppLinksView(PublicAPIMixin, APIView):
    """Links for the website's "Download App" / "Open App" buttons."""

    http_method_names = ["get", "options"]

    @extend_schema(responses=PublicAppLinksSerializer)
    def get(self, request):
        return Response(PublicAppLinksSerializer(selectors.current_settings()).data)


class PublicAppUpdateView(PublicAPIMixin, APIView):
    """What the running app should do about updates. The app sends its own version
    (``?version=1.2.3``); the answer says whether an update is available or required, with
    the download link (an APK now, the Google Play page after launch) and a short note.
    Nothing is offered while no download link is set, so a notice can never lead nowhere."""

    http_method_names = ["get", "options"]

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "version", OpenApiTypes.STR, description="The app's version, e.g. 1.2.3."
            )
        ],
        responses=PublicAppUpdateSerializer,
    )
    def get(self, request):
        current = selectors.current_settings()
        state = update_state(
            request.query_params.get("version", ""),
            current.app_latest_version,
            current.app_min_version,
        )
        if not current.app_download_url:
            state = {"update_available": False, "update_required": False}
        notice = SimpleNamespace(
            latest_version=current.app_latest_version,
            min_version=current.app_min_version,
            download_url=current.app_download_url,
            app_update_note_bn=current.app_update_note_bn,
            app_update_note_en=current.app_update_note_en,
            **state,
        )
        return Response(PublicAppUpdateSerializer(notice, context={"request": request}).data)


EXAM_SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def _for_exam(request, queryset):
    """``?exam=<slug>``: only the notices about that exam (a malformed slug matches nothing)."""
    slug = request.query_params.get("exam")
    if slug is None:
        return queryset
    if len(slug) > 140 or not EXAM_SLUG.fullmatch(slug):
        return queryset.none()
    return selectors.for_exam(queryset, slug)


class PublicAnnouncementListView(PublicAPIMixin, generics.ListAPIView):
    """Website notices: published, not expired, audience public or everyone."""

    serializer_class = PublicAnnouncementSerializer

    def get_queryset(self):
        return _for_exam(self.request, selectors.public_announcements())


class StudentAnnouncementListView(generics.ListAPIView):
    """App notices (student JWT): published, not expired, audience students or everyone."""

    serializer_class = PublicAnnouncementSerializer

    def get_queryset(self):
        return _for_exam(self.request, selectors.student_announcements())

    @extend_schema(tags=["announcements"], operation_id="student_announcements_list")
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)


class PublicFaqListView(PublicAPIMixin, generics.ListAPIView):
    serializer_class = PublicFaqSerializer

    def get_queryset(self):
        return selectors.active_faqs()


class PublicPageView(PublicAPIMixin, generics.RetrieveAPIView):
    """An active page by slug; inactive or unknown → 404."""

    serializer_class = PublicPageSerializer
    lookup_field = "slug"

    def get_queryset(self):
        return selectors.active_pages()


class ContactFormThrottle(SecurityThrottle):
    """``contact_form``: per client IP (docs/API_PLAN.md §5)."""

    scope = "contact_form"


class ContactAcceptedSerializer(serializers.Serializer):
    status = serializers.CharField()


class PublicContactView(PublicAPIMixin, APIView):
    """Website contact form. Valid submissions (and honeypot hits, silently discarded)
    get the same ``202 {"status": "received"}``."""

    http_method_names = ["post", "options"]
    throttle_classes = [ContactFormThrottle]

    @extend_schema(request=ContactFormSerializer, responses={202: ContactAcceptedSerializer})
    def post(self, request):
        data = ContactFormSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        if data.validated_data.get("website"):
            logger.info("Contact form honeypot triggered")  # nothing stored, nothing echoed
        else:
            language = request.LANGUAGE_CODE
            if language not in LanguageChoice.values:
                language = LanguageChoice.BN
            services.submit_contact_message(
                data.validated_data, language=language, ip_address=get_client_ip(request)
            )
        return Response({"status": "received"}, status=status.HTTP_202_ACCEPTED)


# --------------------------------------------------------------------------------------
# Notice PDF
# --------------------------------------------------------------------------------------
class NoticePdfUploadSerializer(serializers.Serializer):
    file = serializers.FileField()


class AnnouncementPdfAdminView(AdminAPIMixin, APIView):
    """``POST`` (multipart ``file``) attaches or replaces the notice's PDF; ``DELETE`` removes
    it. The answer is the notice."""

    parser_classes = [MultiPartParser]
    throttle_classes = [DocumentUploadThrottle]
    http_method_names = ["post", "delete", "options"]

    @extend_schema(
        operation_id="admin_announcements_pdf_set",
        request=NoticePdfUploadSerializer,
        responses=AnnouncementAdminSerializer,
    )
    def post(self, request, pk):
        limit = settings.DOCUMENT_MAX_BYTES + 64 * 1024
        if int(request.META.get("CONTENT_LENGTH") or 0) > limit:
            raise ApiError(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="file_too_large",
                message="The file is too large.",
            )
        data = NoticePdfUploadSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            notice = services.set_announcement_pdf(
                pk, data.validated_data["file"], ctx=AuditContext.from_request(request)
            )
        except documents.DocumentError as exc:
            raise ApiError(
                status_code=status.HTTP_400_BAD_REQUEST, code=exc.code, message=exc.message
            ) from exc
        return Response(AnnouncementAdminSerializer(notice).data)

    @extend_schema(
        operation_id="admin_announcements_pdf_remove", responses=AnnouncementAdminSerializer
    )
    def delete(self, request, pk):
        notice = services.remove_announcement_pdf(pk, ctx=AuditContext.from_request(request))
        return Response(AnnouncementAdminSerializer(notice).data)


def _pdf_of(queryset, pk):
    """The notice's stored PDF, or a 404 (no notice, not visible to this audience, no PDF)."""
    notice = queryset.filter(pk=pk).first()
    if notice is None or not notice.pdf:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND, code="not_found", message="No PDF is available."
        )
    return notice


class PublicAnnouncementPdfView(PublicAPIMixin, APIView):
    """The PDF of a website notice (published, not expired, audience public or everyone)."""

    @extend_schema(
        operation_id="public_announcement_pdf",
        responses={(200, "application/pdf"): OpenApiTypes.BINARY},
    )
    def get(self, request, pk):
        notice = _pdf_of(selectors.public_announcements(), pk)
        return documents.pdf_response(request, notice.pdf, notice.pdf_sha256, "notice.pdf")


NOTICE_LINK_SALT = "cms.notice-pdf"
NOTICE_LINK_SECONDS = 600


class NoticeLinkSerializer(serializers.Serializer):
    path = serializers.CharField(
        help_text="API-relative address of the file (open it in a browser)."
    )
    expires_in = serializers.IntegerField()


class StudentAnnouncementPdfLinkView(APIView):
    """App notices (student JWT): a short-lived signed address for the notice's PDF. The app
    hands it to the phone's browser or PDF viewer, which cannot send the student's token."""

    @extend_schema(
        operation_id="student_announcement_pdf_link",
        tags=["announcements"],
        responses=NoticeLinkSerializer,
    )
    def get(self, request, pk):
        notice = _pdf_of(selectors.student_announcements(), pk)
        token = signing.dumps(notice.pk, salt=NOTICE_LINK_SALT, compress=False)
        return Response(
            {"path": f"/public/notice-files/{token}/", "expires_in": NOTICE_LINK_SECONDS}
        )


class PublicNoticeFileView(PublicAPIMixin, APIView):
    """Opens a notice PDF from a signed address (see above). The address expires after
    ``NOTICE_LINK_SECONDS`` and the notice must still be visible to students."""

    @extend_schema(
        operation_id="public_notice_file",
        responses={(200, "application/pdf"): OpenApiTypes.BINARY},
    )
    def get(self, request, token):
        try:
            pk = signing.loads(token, salt=NOTICE_LINK_SALT, max_age=NOTICE_LINK_SECONDS)
        except signing.BadSignature:
            raise ApiError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="not_found",
                message="This link is not valid or has expired.",
            ) from None
        notice = _pdf_of(selectors.student_announcements(), pk)
        return documents.pdf_response(request, notice.pdf, notice.pdf_sha256, "notice.pdf")
