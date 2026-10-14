"""Basic site content (docs/DATABASE_DESIGN.md §4.10) — Milestone 6A. Not a full CMS.

- ``SiteSettings``: one row (pk = 1). Typed, validated fields — no free key/value store and
  no secrets (credentials and business rules stay in environment settings).
- ``Announcement``: bilingual notices for the website and/or the app; ``published_at``
  null = draft, optional ``expires_at``.
- ``Faq``: bilingual question/answer, admin order.
- ``Page``: simple bilingual pages addressed by an ASCII slug (``about``, ``terms`` …).
- ``ContactMessage``: the website contact form inbox.

All content is **plain text** (NFC-normalized, control characters removed) and is never
interpreted as HTML: clients render it escaped (docs/SECURITY_PLAN.md §3.6). Bilingual
pairs (title + body, question + answer) must be complete in at least one language, and a
language is either complete or empty — never a title without its body.
"""

import re
import unicodedata

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import EmailValidator, MaxLengthValidator, RegexValidator
from django.db import models
from django.db.models.functions import Length
from django.db.models.lookups import LessThanOrEqual
from django.utils.translation import gettext_lazy as _

from apps.catalog.models import SLUG_INVALID_MESSAGE, SLUG_MAX_LENGTH, SLUG_REGEX
from apps.core.i18n import (
    clean_multiline,
    clean_single_line,
    has_meaningful_text,
    normalize_digits,
)
from apps.core.models import TimeStampedModel

LANGUAGES = ("bn", "en")
TITLE_MAX_LENGTH = 200
ANNOUNCEMENT_BODY_MAX_LENGTH = 5000
FAQ_QUESTION_MAX_LENGTH = 300
FAQ_ANSWER_MAX_LENGTH = 3000
PAGE_BODY_MAX_LENGTH = 20000
URL_MAX_LENGTH = 500

PAIR_REQUIRED_MESSAGE = _(
    "Fill in both %(first)s and %(second)s in at least one language (Bangla or English)."
)
PAIR_INCOMPLETE_MESSAGE = _("Fill in both %(first)s and %(second)s for this language, or neither.")
PAGE_SLUG_TAKEN_MESSAGE = _("A page with this slug already exists.")
EXPIRY_BEFORE_PUBLISH_MESSAGE = _("The end time must be after the publish time.")
HTTPS_URL_MESSAGE = _("Enter a full https:// address.")
APP_URL_MESSAGE = _("Enter an https:// address or a link with this app's own scheme.")
PHONE_INVALID_MESSAGE = _(
    "Enter a phone number of 6 to 15 digits; only +, spaces, brackets and - may be added."
)

slug_validator = RegexValidator(SLUG_REGEX, SLUG_INVALID_MESSAGE, code="invalid_slug")

# Schemes that can execute code, embed content or downgrade to cleartext: never allowed,
# not even as the configured app scheme.
FORBIDDEN_SCHEMES = ("javascript", "data", "vbscript", "file", "blob", "about", "http", "https")
SCHEME_REGEX = r"^[a-z][a-z0-9+.-]{1,30}$"
_SCHEME = re.compile(r"^([a-z][a-z0-9+.-]*):", re.IGNORECASE)
_APP_URL = re.compile(r"^[a-z][a-z0-9+.-]*://\S+$")
_HTTPS_URL = re.compile(r"^https://[^\s/?#]+\.[^\s/?#]+(?:[/?#]\S*)?$", re.IGNORECASE)
# Phone (contact form/site settings): not country-specific, not E.164. Optional leading +,
# then digits with spaces, brackets or hyphens; 6–15 digits in total (ITU maximum).
PHONE_MAX_LENGTH = 20
_PHONE = re.compile(r"^\+?[0-9()][0-9() \-]*[0-9]$")
PHONE_MIN_DIGITS, PHONE_MAX_DIGITS = 6, 15


def normalize_line(value: str | None) -> str:
    text = clean_single_line(value)
    return text if has_meaningful_text(text, allow_symbols=True) else ""


def normalize_body(value: str | None) -> str:
    text = clean_multiline(value)
    return text if has_meaningful_text(text, allow_symbols=True) else ""


def validate_https_url(value: str) -> None:
    if value and not _HTTPS_URL.fullmatch(value):
        raise ValidationError(HTTPS_URL_MESSAGE, code="invalid_url")


def app_deep_link_scheme() -> str:
    """The project's own app scheme (``APP_DEEP_LINK_SCHEME``, e.g. ``mcqapp``), or ``""``
    while none is configured. A misconfigured value counts as none."""
    scheme = (getattr(settings, "APP_DEEP_LINK_SCHEME", "") or "").strip().lower()
    if not re.fullmatch(SCHEME_REGEX, scheme) or scheme in FORBIDDEN_SCHEMES:
        return ""
    return scheme


def validate_app_url(value: str) -> None:
    """Allow-list: ``https://…`` or ``<APP_DEEP_LINK_SCHEME>://…`` only. Every other scheme
    (http, javascript, data, vbscript, file, blob, about, any other app's scheme) is refused."""
    if not value:
        return
    match = _SCHEME.match(value)
    scheme = match.group(1).lower() if match else ""
    if scheme == "https":
        validate_https_url(value)
        return
    allowed = app_deep_link_scheme()
    if not allowed or scheme != allowed or not _APP_URL.fullmatch(value):
        raise ValidationError(APP_URL_MESSAGE, code="invalid_url")


def validate_phone(value: str) -> None:
    """Bounded, character-safe phone check (expects an already normalized value)."""
    if not value:
        return
    digits = sum(ch.isdigit() for ch in value)
    if (
        len(value) > PHONE_MAX_LENGTH
        or any(unicodedata.category(ch)[0] == "C" for ch in value)
        or not _PHONE.fullmatch(value)
        or not PHONE_MIN_DIGITS <= digits <= PHONE_MAX_DIGITS
    ):
        raise ValidationError(PHONE_INVALID_MESSAGE, code="invalid_phone")


def _pair_constraints(prefix: str, first: str, second: str) -> list:
    """Each language complete or empty; at least one language complete."""

    def complete(lang):
        return models.Q(**{f"{first}_{lang}__gt": ""}) & models.Q(**{f"{second}_{lang}__gt": ""})

    def empty(lang):
        return models.Q(**{f"{first}_{lang}": ""}) & models.Q(**{f"{second}_{lang}": ""})

    return [
        models.CheckConstraint(
            condition=(complete("bn") | empty("bn")) & (complete("en") | empty("en")),
            name=f"{prefix}_{first}_{second}_pairs",
        ),
        models.CheckConstraint(
            condition=complete("bn") | complete("en"), name=f"{prefix}_{first}_{second}_required"
        ),
    ]


def _check_pair(instance, first: str, second: str, labels: tuple[str, str]) -> None:
    errors = {}
    params = {"first": labels[0], "second": labels[1]}
    complete = []
    for lang in LANGUAGES:
        a, b = getattr(instance, f"{first}_{lang}"), getattr(instance, f"{second}_{lang}")
        if bool(a) != bool(b):
            missing = f"{second}_{lang}" if a else f"{first}_{lang}"
            errors[missing] = ValidationError(
                PAIR_INCOMPLETE_MESSAGE, code="translation_incomplete", params=params
            )
        elif a:
            complete.append(lang)
    if not complete and not errors:
        for field in (f"{first}_bn", f"{first}_en"):
            errors[field] = ValidationError(
                PAIR_REQUIRED_MESSAGE, code="translation_required", params=params
            )
    if errors:
        raise ValidationError(errors)


class LanguageChoice(models.TextChoices):
    BN = "bn", _("Bangla")
    EN = "en", _("English")


class LeaderboardNameMode(models.TextChoices):
    """The display-name modes the results module supports (phone/email are never shown)."""

    MASKED = "masked", _("Masked")
    INITIALS = "initials", _("Initials")
    DISPLAY_NAME = "display_name", _("Display name")
    FULL_NAME = "full_name", _("Full name")


# --------------------------------------------------------------------------------------
# Site settings (one row)
# --------------------------------------------------------------------------------------
class SiteSettings(TimeStampedModel):
    SINGLETON_ID = 1

    id = models.PositiveSmallIntegerField(primary_key=True, default=SINGLETON_ID, editable=False)
    platform_name_bn = models.CharField(_("platform name (Bangla)"), max_length=120, blank=True)
    platform_name_en = models.CharField(_("platform name (English)"), max_length=120, blank=True)
    tagline_bn = models.CharField(_("tagline (Bangla)"), max_length=200, blank=True)
    tagline_en = models.CharField(_("tagline (English)"), max_length=200, blank=True)
    address_bn = models.CharField(_("address (Bangla)"), max_length=300, blank=True)
    address_en = models.CharField(_("address (English)"), max_length=300, blank=True)
    contact_email = models.CharField(
        _("contact e-mail"), max_length=254, blank=True, validators=[EmailValidator()]
    )
    contact_phone = models.CharField(
        _("contact phone"), max_length=20, blank=True, validators=[validate_phone]
    )
    # "Download App" (Play Store) and "Open App" (app link) — docs/API_PLAN.md §3.2.
    app_download_url = models.CharField(
        _("app download link"),
        max_length=URL_MAX_LENGTH,
        blank=True,
        validators=[validate_https_url],
    )
    app_open_url = models.CharField(
        _("app open link"), max_length=URL_MAX_LENGTH, blank=True, validators=[validate_app_url]
    )
    default_language = models.CharField(
        _("default language"), max_length=2, choices=LanguageChoice.choices
    )
    public_leaderboard_name_mode = models.CharField(
        _("website leaderboard names"), max_length=20, choices=LeaderboardNameMode.choices
    )
    app_leaderboard_name_mode = models.CharField(
        _("app leaderboard names"), max_length=20, choices=LeaderboardNameMode.choices
    )

    AUDIT_VALUE_FIELDS = (
        "platform_name_bn",
        "platform_name_en",
        "tagline_bn",
        "tagline_en",
        "address_bn",
        "address_en",
        "contact_email",
        "contact_phone",
        "app_download_url",
        "app_open_url",
        "default_language",
        "public_leaderboard_name_mode",
        "app_leaderboard_name_mode",
    )

    class Meta:
        verbose_name = _("site settings")
        verbose_name_plural = _("site settings")
        constraints = [
            models.CheckConstraint(condition=models.Q(id=1), name="cms_site_settings_singleton"),
            models.CheckConstraint(
                condition=models.Q(default_language__in=LanguageChoice.values),
                name="cms_site_settings_language_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(public_leaderboard_name_mode__in=LeaderboardNameMode.values)
                & models.Q(app_leaderboard_name_mode__in=LeaderboardNameMode.values),
                name="cms_site_settings_name_modes_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(app_download_url="")
                | models.Q(app_download_url__startswith="https://"),
                name="cms_site_settings_download_url_https",
            ),
            # Shape guard: empty, https://… or <scheme>://… with a scheme that is never one
            # of the dangerous ones. The exact app scheme (a setting) is enforced by
            # ``validate_app_url``.
            models.CheckConstraint(
                condition=models.Q(app_open_url="")
                | models.Q(app_open_url__startswith="https://")
                | (
                    models.Q(app_open_url__regex=r"^[a-z][a-z0-9+.-]{1,30}://[^[:space:]]+$")
                    & ~models.Q(
                        app_open_url__iregex=r"^(javascript|data|vbscript|file|blob|about|http):"
                    )
                ),
                name="cms_site_settings_open_url_safe",
            ),
        ]

    def __str__(self) -> str:
        return "site settings"

    @classmethod
    def defaults(cls) -> "SiteSettings":
        """Unsaved settings with the environment defaults (used until an admin saves)."""
        modes = LeaderboardNameMode.values
        public_mode = settings.LEADERBOARD_PUBLIC_NAME_MODE
        app_mode = settings.LEADERBOARD_APP_NAME_MODE
        language = settings.LANGUAGE_CODE
        return cls(
            id=cls.SINGLETON_ID,
            default_language=language if language in LanguageChoice.values else "bn",
            public_leaderboard_name_mode=public_mode if public_mode in modes else "masked",
            app_leaderboard_name_mode=app_mode if app_mode in modes else "masked",
        )

    def normalize(self) -> None:
        for field in ("platform_name", "tagline", "address"):
            for lang in LANGUAGES:
                name = f"{field}_{lang}"
                setattr(self, name, normalize_line(getattr(self, name)))
        self.contact_email = clean_single_line(self.contact_email).lower()
        self.contact_phone = clean_single_line(normalize_digits(self.contact_phone or ""))
        self.app_download_url = clean_single_line(self.app_download_url)
        self.app_open_url = clean_single_line(self.app_open_url)

    def clean_fields(self, exclude=None):
        self.normalize()
        super().clean_fields(exclude=exclude)

    def save(self, *args, **kwargs):
        self.id = self.SINGLETON_ID
        self.normalize()
        super().save(*args, **kwargs)


# --------------------------------------------------------------------------------------
# Bilingual content
# --------------------------------------------------------------------------------------
class BilingualContent(TimeStampedModel):
    """Abstract: a bilingual (first, second) pair, e.g. title + body."""

    PAIR: tuple[str, str] = ("title", "body")
    PAIR_LABELS: tuple = (_("title"), _("body"))

    class Meta:
        abstract = True

    def normalize(self) -> None:
        first, second = self.PAIR
        for lang in LANGUAGES:
            setattr(self, f"{first}_{lang}", normalize_line(getattr(self, f"{first}_{lang}")))
            setattr(self, f"{second}_{lang}", normalize_body(getattr(self, f"{second}_{lang}")))

    def clean_fields(self, exclude=None):
        self.normalize()
        super().clean_fields(exclude=exclude)

    def clean(self):
        super().clean()
        _check_pair(self, *self.PAIR, labels=tuple(str(label) for label in self.PAIR_LABELS))

    def save(self, *args, **kwargs):
        self.normalize()
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        first = self.PAIR[0]
        return getattr(self, f"{first}_en") or getattr(self, f"{first}_bn")


class Audience(models.TextChoices):
    PUBLIC = "public", _("Website (public)")
    STUDENTS = "students", _("Students (app)")
    ALL = "all", _("Everyone")


class Announcement(BilingualContent):
    title_bn = models.CharField(_("title (Bangla)"), max_length=TITLE_MAX_LENGTH, blank=True)
    title_en = models.CharField(_("title (English)"), max_length=TITLE_MAX_LENGTH, blank=True)
    body_bn = models.TextField(
        _("text (Bangla)"),
        blank=True,
        validators=[MaxLengthValidator(ANNOUNCEMENT_BODY_MAX_LENGTH)],
    )
    body_en = models.TextField(
        _("text (English)"),
        blank=True,
        validators=[MaxLengthValidator(ANNOUNCEMENT_BODY_MAX_LENGTH)],
    )
    audience = models.CharField(
        _("audience"), max_length=10, choices=Audience.choices, default=Audience.ALL
    )
    is_pinned = models.BooleanField(_("pinned"), default=False)
    # null = draft; visible from published_at until expires_at (if set).
    published_at = models.DateTimeField(_("published at"), null=True, blank=True)
    expires_at = models.DateTimeField(_("expires at"), null=True, blank=True)

    AUDIT_VALUE_FIELDS = ("title_bn", "title_en", "audience", "is_pinned")
    AUDIT_DATE_FIELDS = ("published_at", "expires_at")
    AUDIT_PRESENCE_FIELDS = ("body_bn", "body_en")

    class Meta:
        verbose_name = _("announcement")
        verbose_name_plural = _("announcements")
        ordering = ("-is_pinned", "-published_at", "-id")
        constraints = [
            *_pair_constraints("cms_announcement", "title", "body"),
            models.CheckConstraint(
                condition=models.Q(audience__in=Audience.values),
                name="cms_announcement_audience_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(expires_at__isnull=True)
                | models.Q(published_at__isnull=True)
                | models.Q(expires_at__gt=models.F("published_at")),
                name="cms_announcement_window_valid",
            ),
        ]
        indexes = [
            models.Index(fields=["audience", "published_at"], name="cms_announcement_visible_idx"),
        ]

    def clean(self):
        super().clean()
        if self.published_at and self.expires_at and self.expires_at <= self.published_at:
            raise ValidationError(
                {
                    "expires_at": ValidationError(
                        EXPIRY_BEFORE_PUBLISH_MESSAGE, code="invalid_window"
                    )
                }
            )


class Faq(BilingualContent):
    PAIR = ("question", "answer")
    PAIR_LABELS = (_("question"), _("answer"))

    question_bn = models.CharField(
        _("question (Bangla)"), max_length=FAQ_QUESTION_MAX_LENGTH, blank=True
    )
    question_en = models.CharField(
        _("question (English)"), max_length=FAQ_QUESTION_MAX_LENGTH, blank=True
    )
    answer_bn = models.TextField(
        _("answer (Bangla)"), blank=True, validators=[MaxLengthValidator(FAQ_ANSWER_MAX_LENGTH)]
    )
    answer_en = models.TextField(
        _("answer (English)"), blank=True, validators=[MaxLengthValidator(FAQ_ANSWER_MAX_LENGTH)]
    )
    is_active = models.BooleanField(_("active"), default=True)
    sort_order = models.PositiveIntegerField(_("sort order"), default=0)

    AUDIT_VALUE_FIELDS = ("question_bn", "question_en", "is_active", "sort_order")
    AUDIT_DATE_FIELDS: tuple = ()
    AUDIT_PRESENCE_FIELDS = ("answer_bn", "answer_en")

    class Meta:
        verbose_name = _("FAQ entry")
        verbose_name_plural = _("FAQ")
        ordering = ("sort_order", "id")
        constraints = [
            *_pair_constraints("cms_faq", "question", "answer"),
            models.CheckConstraint(
                condition=models.Q(sort_order__gte=0), name="cms_faq_sort_order_valid"
            ),
        ]
        indexes = [models.Index(fields=["is_active", "sort_order"], name="cms_faq_active_idx")]


class Page(BilingualContent):
    slug = models.CharField(
        _("slug"),
        max_length=SLUG_MAX_LENGTH,
        unique=True,
        validators=[slug_validator],
        error_messages={"unique": PAGE_SLUG_TAKEN_MESSAGE},
        help_text=_("Used in web addresses, e.g. about, terms, privacy."),
    )
    title_bn = models.CharField(_("title (Bangla)"), max_length=TITLE_MAX_LENGTH, blank=True)
    title_en = models.CharField(_("title (English)"), max_length=TITLE_MAX_LENGTH, blank=True)
    body_bn = models.TextField(
        _("text (Bangla)"), blank=True, validators=[MaxLengthValidator(PAGE_BODY_MAX_LENGTH)]
    )
    body_en = models.TextField(
        _("text (English)"), blank=True, validators=[MaxLengthValidator(PAGE_BODY_MAX_LENGTH)]
    )
    is_active = models.BooleanField(_("active"), default=True)

    AUDIT_VALUE_FIELDS = ("slug", "title_bn", "title_en", "is_active")
    AUDIT_DATE_FIELDS: tuple = ()
    AUDIT_PRESENCE_FIELDS = ("body_bn", "body_en")

    class Meta:
        verbose_name = _("page")
        verbose_name_plural = _("pages")
        ordering = ("slug",)
        constraints = [
            *_pair_constraints("cms_page", "title", "body"),
            models.CheckConstraint(
                condition=models.Q(slug__regex=SLUG_REGEX), name="cms_page_slug_format"
            ),
        ]

    def normalize(self) -> None:
        super().normalize()
        self.slug = clean_single_line(self.slug).lower()


# --------------------------------------------------------------------------------------
# Contact form inbox
# --------------------------------------------------------------------------------------
CONTACT_NAME_MAX_LENGTH = 120
CONTACT_PHONE_MAX_LENGTH = 20
CONTACT_EMAIL_MAX_LENGTH = 254
CONTACT_SUBJECT_MAX_LENGTH = 150
CONTACT_MESSAGE_MAX_LENGTH = 5000


class ContactStatus(models.TextChoices):
    NEW = "new", _("New")
    READ = "read", _("Read")
    RESOLVED = "resolved", _("Resolved")


class ContactMessage(TimeStampedModel):
    name = models.CharField(_("name"), max_length=CONTACT_NAME_MAX_LENGTH)
    phone = models.CharField(_("phone"), max_length=CONTACT_PHONE_MAX_LENGTH, blank=True)
    email = models.CharField(_("e-mail"), max_length=CONTACT_EMAIL_MAX_LENGTH, blank=True)
    subject = models.CharField(_("subject"), max_length=CONTACT_SUBJECT_MAX_LENGTH)
    message = models.TextField(_("message"))  # plain text, never rendered as HTML
    language = models.CharField(_("language"), max_length=2, choices=LanguageChoice.choices)
    status = models.CharField(
        _("status"), max_length=10, choices=ContactStatus.choices, default=ContactStatus.NEW
    )
    handled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name=_("handled by"),
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="handled_contact_messages",
    )
    # Abuse tracking only (trusted-proxy-aware helper); never shown in the admin API.
    ip_address = models.GenericIPAddressField(_("IP address"), null=True, blank=True)

    class Meta:
        verbose_name = _("contact message")
        verbose_name_plural = _("contact messages")
        ordering = ("-created_at", "-id")
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(phone="") | ~models.Q(email=""),
                name="cms_contact_phone_or_email",
            ),
            models.CheckConstraint(
                condition=models.Q(name__gt="")
                & models.Q(subject__gt="")
                & models.Q(message__gt=""),
                name="cms_contact_required_text",
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=ContactStatus.values),
                name="cms_contact_status_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(language__in=LanguageChoice.values),
                name="cms_contact_language_valid",
            ),
            models.CheckConstraint(
                condition=LessThanOrEqual(Length("message"), CONTACT_MESSAGE_MAX_LENGTH),
                name="cms_contact_message_length",
            ),
        ]
        indexes = [models.Index(fields=["status", "created_at"], name="cms_contact_status_idx")]

    def __str__(self) -> str:
        return f"contact message #{self.pk}"
