"""Read side: which subscriptions are active right now, and may a user open an exam.

Other modules call these (docs/MODULES.md rule 2) — the exam engine in particular calls
``user_can_access_exam`` when an attempt starts; nothing copies this logic.

"Active" is always computed from the server clock, never from ``status`` alone:

    status == active  AND  starts_at <= now  AND  expires_at > now

so a subscription stops granting access the moment it expires, even if the expiry job
(Milestone 5) has not yet changed its status, and a future-dated grant does not open
anything early. Cancelled and expired rows never grant access. A package's own status
does not matter here: deactivating a package stops new sales, not paid access.
"""

from dataclasses import dataclass, field
from datetime import datetime

from django.db.models import Q
from django.utils import timezone

from apps.exams.models import AccessType

from .models import PackageAccessRule, RuleType, Subscription, SubscriptionStatus


class EffectiveStatus:
    """Display status computed at a moment in time (not stored)."""

    ACTIVE = "active"
    SCHEDULED = "scheduled"  # granted, but starts in the future
    EXPIRED = "expired"
    CANCELLED = "cancelled"

    values = (ACTIVE, SCHEDULED, EXPIRED, CANCELLED)


def _now(at: datetime | None) -> datetime:
    return at if at is not None else timezone.now()


def active_window(at: datetime | None = None, prefix: str = "") -> Q:
    """Filter for subscriptions that grant access at ``at`` (default: now)."""
    moment = _now(at)
    return Q(
        **{
            f"{prefix}status": SubscriptionStatus.ACTIVE,
            f"{prefix}starts_at__lte": moment,
            f"{prefix}expires_at__gt": moment,
        }
    )


def effective_status(subscription: Subscription, at: datetime | None = None) -> str:
    moment = _now(at)
    if subscription.status == SubscriptionStatus.CANCELLED:
        return EffectiveStatus.CANCELLED
    if subscription.status == SubscriptionStatus.EXPIRED or subscription.expires_at <= moment:
        return EffectiveStatus.EXPIRED
    if subscription.starts_at > moment:
        return EffectiveStatus.SCHEDULED
    return EffectiveStatus.ACTIVE


def effective_status_filter(value: str, at: datetime | None = None) -> Q:
    """``effective_status`` as a query: the rows whose effective status at ``at`` is
    ``value`` (one of ``EffectiveStatus.values``). Same order of checks as
    ``effective_status``: cancelled, then expired, then scheduled, else active."""
    moment = _now(at)
    cancelled = Q(status=SubscriptionStatus.CANCELLED)
    expired = ~cancelled & (Q(status=SubscriptionStatus.EXPIRED) | Q(expires_at__lte=moment))
    scheduled = ~cancelled & ~expired & Q(starts_at__gt=moment)
    return {
        EffectiveStatus.CANCELLED: cancelled,
        EffectiveStatus.EXPIRED: expired,
        EffectiveStatus.SCHEDULED: scheduled,
        EffectiveStatus.ACTIVE: ~cancelled & ~expired & ~Q(starts_at__gt=moment),
    }[value]


def is_active(subscription: Subscription, at: datetime | None = None) -> bool:
    return effective_status(subscription, at) == EffectiveStatus.ACTIVE


def active_subscriptions(user, at: datetime | None = None):
    return Subscription.objects.filter(active_window(at), user_id=user.pk)


def _is_eligible_user(user) -> bool:
    return bool(
        user is not None
        and getattr(user, "is_authenticated", False)
        and user.is_active
        and getattr(user, "is_student", False)
    )


def _rule_matches(exam) -> Q:
    return (
        Q(rule_type=RuleType.ALL_PAID_EXAMS)
        | Q(rule_type=RuleType.CATEGORY, category_id=exam.category_id)
        | Q(rule_type=RuleType.EXAM, exam_id=exam.pk)
    )


def user_can_access_exam(user, exam, *, at: datetime | None = None) -> bool:
    """Entitlement only: may this user open this exam as far as free/paid access goes?

    - only an authenticated, active **student** is entitled to anything;
    - a free exam needs no subscription;
    - a paid exam needs a currently active subscription whose package has a rule for
      all paid exams, for the exam's category, or for this exam.

    Schedule, publish status, attempt limits and retakes are NOT checked here — the exam
    engine checks those itself. One ``EXISTS`` query for paid exams, none for free ones.
    """
    if not _is_eligible_user(user):
        return False
    if exam.access_type == AccessType.FREE:
        return True
    if exam.access_type != AccessType.PAID:
        return False  # unknown access type: fail closed
    return (
        PackageAccessRule.objects.filter(
            active_window(at, prefix="package__subscriptions__"),
            package__subscriptions__user_id=user.pk,
        )
        .filter(_rule_matches(exam))
        .exists()
    )


@dataclass(frozen=True)
class AccessGrants:
    """Everything a user's active subscriptions open, resolved once (for exam lists:
    check many exams without one query per exam)."""

    all_paid_exams: bool = False
    category_ids: frozenset[int] = field(default_factory=frozenset)
    exam_ids: frozenset[int] = field(default_factory=frozenset)

    def covers(self, exam) -> bool:
        if exam.access_type == AccessType.FREE:
            return True
        if exam.access_type != AccessType.PAID:
            return False
        return (
            self.all_paid_exams or exam.category_id in self.category_ids or exam.pk in self.exam_ids
        )


def active_grants(user, *, at: datetime | None = None) -> AccessGrants | None:
    """The user's combined access right now (one query), or ``None`` if the user is not
    an active student (then nothing is accessible, not even free exams)."""
    if not _is_eligible_user(user):
        return None
    rows = PackageAccessRule.objects.filter(
        active_window(at, prefix="package__subscriptions__"),
        package__subscriptions__user_id=user.pk,
    ).values_list("rule_type", "category_id", "exam_id")
    all_paid, categories, exams = False, set(), set()
    for rule_type, category_id, exam_id in rows:
        if rule_type == RuleType.ALL_PAID_EXAMS:
            all_paid = True
        elif rule_type == RuleType.CATEGORY:
            categories.add(category_id)
        elif rule_type == RuleType.EXAM:
            exams.add(exam_id)
    return AccessGrants(all_paid, frozenset(categories), frozenset(exams))
