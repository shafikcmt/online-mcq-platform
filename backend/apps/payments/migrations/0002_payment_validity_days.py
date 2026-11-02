"""Payment.validity_days: the package validity a payment bought, snapshot at initiation.

Steps: (1) add the column (nullable), (2) backfill existing rows, (3) NOT NULL,
(4) CHECK 1..MAX_VALIDITY_DAYS, (5) a trigger that makes the commercial snapshot
(amount, currency, validity_days) immutable after the row is created.

**Backfill = audit-derived reconstruction with explicit fallback provenance**, not a
claim of exact history. Packages change only through ``subscriptions.services``, which
audit every create/update in the same transaction (the audit log is append-only), so for
each payment we take the package validity in force at ``payment.created_at``:

1. ``audit``          — the last ``package.create`` value / ``package.update``
   ``changes.validity_days.to`` at or before the payment;
2. ``earliest_known`` — no audit event at or before the payment: the value before the
   package's first recorded event (the first validity change's ``from``, or the create
   value);
3. ``current_package`` — the package has no usable validity audit history at all: its
   current ``validity_days``.

Ordering rule (deterministic): audit events are ordered by (``created_at``, ``id``); an
event with ``created_at`` equal to the payment's counts as **before** the payment. Package
edits and payment initiations lock the package row against each other, so their
timestamps are ordered in practice; the timestamps come from the application servers'
clocks, so a large clock skew between servers is a known limitation.

Existing subscriptions, prices and audit events are **never** rewritten. For successful
payments the report counts those where the package validity in force at verification
(what was actually granted before this fix) differs from the checkout value — derived
from the same audit timeline, without guessing which subscription event belongs to which
payment. Counts are printed for the deployment log.
"""

from bisect import bisect_right
from collections import defaultdict

from django.db import migrations, models

MAX_VALIDITY_DAYS = 3650  # subscriptions.models.MAX_VALIDITY_DAYS at the time of writing
PACKAGE_ENTITY = "subscriptions.package"

GUARD_SNAPSHOT_SQL = """
CREATE FUNCTION payments_payment_guard_snapshot() RETURNS trigger AS $$
BEGIN
    IF NEW.amount IS DISTINCT FROM OLD.amount
        OR NEW.currency IS DISTINCT FROM OLD.currency
        OR NEW.validity_days IS DISTINCT FROM OLD.validity_days THEN
        RAISE EXCEPTION 'payment snapshot (amount, currency, validity_days) cannot change'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_payment_snapshot_guard
    BEFORE UPDATE OF amount, currency, validity_days ON payments_payment
    FOR EACH ROW EXECUTE FUNCTION payments_payment_guard_snapshot();
"""

UNGUARD_SNAPSHOT_SQL = """
DROP TRIGGER IF EXISTS payments_payment_snapshot_guard ON payments_payment;
DROP FUNCTION IF EXISTS payments_payment_guard_snapshot();
"""


def _valid(value) -> bool:
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and 1 <= value <= MAX_VALIDITY_DAYS
    )


class PackageTimeline:
    """Validity of one package over time, from its audit events (sorted)."""

    def __init__(self):
        self.times = []  # created_at of each event that sets a validity
        self.values = []  # the validity in force from that event on
        self.before_first = None  # the validity before the first recorded event

    def add(self, created_at, before, after, *, created=False):
        if not self.times:
            # Before the first recorded event: the create value (a payment cannot really
            # precede its package's creation), or the first change's ``from`` — never a
            # guess when that ``from`` is unusable.
            self.before_first = after if created else (before if _valid(before) else None)
        self.times.append(created_at)
        self.values.append(after)

    def at(self, moment):
        """(value, source) at ``moment``: an event at exactly ``moment`` counts."""
        index = bisect_right(self.times, moment)
        if index:
            return self.values[index - 1], "audit"
        if self.before_first is not None:
            return self.before_first, "earliest_known"
        return None, None


def build_timelines(AuditLog, package_ids):
    """One query for every package's create/update events, in (created_at, id) order."""
    timelines = defaultdict(PackageTimeline)
    events = (
        AuditLog.objects.filter(
            entity_type=PACKAGE_ENTITY,
            entity_id__in=[str(pk) for pk in package_ids],
            action__in=("package.create", "package.update"),
        )
        .order_by("created_at", "id")
        .values_list("entity_id", "action", "metadata", "created_at")
    )
    for entity_id, action, metadata, created_at in events:
        metadata = metadata if isinstance(metadata, dict) else {}
        if action == "package.create":
            value = (metadata.get("values") or {}).get("validity_days")
            if _valid(value):
                timelines[int(entity_id)].add(created_at, None, value, created=True)
        else:
            change = (metadata.get("changes") or {}).get("validity_days") or {}
            if _valid(change.get("to")):
                timelines[int(entity_id)].add(created_at, change.get("from"), change["to"])
    return timelines


def compute_backfill(apps):
    """``({payment_id: validity_days}, counts)`` for every payment without a snapshot.
    Pure computation (no writes), so tests can check it directly."""
    Payment = apps.get_model("payments", "Payment")
    Package = apps.get_model("subscriptions", "Package")
    AuditLog = apps.get_model("audit", "AuditLog")
    rows = list(
        Payment.objects.filter(validity_days__isnull=True)
        .order_by("id")
        .values_list("id", "package_id", "created_at", "status", "verified_at")
    )
    package_ids = sorted({row[1] for row in rows})
    current = dict(
        Package.objects.filter(pk__in=package_ids).values_list("pk", "validity_days")
    )
    timelines = build_timelines(AuditLog, package_ids)
    counts = {"audit": 0, "earliest_known": 0, "current_package": 0, "success_differs": 0}
    values = {}
    for payment_id, package_id, created_at, status, verified_at in rows:
        timeline = timelines.get(package_id)
        value, source = timeline.at(created_at) if timeline else (None, None)
        if value is None:
            value, source = current[package_id], "current_package"
        values[payment_id] = value
        counts[source] += 1
        if status == "success" and verified_at is not None and timeline:
            at_verification, _source = timeline.at(verified_at)
            if at_verification is not None and at_verification != value:
                counts["success_differs"] += 1
    return values, counts


def report_line(counts) -> str:
    total = counts["audit"] + counts["earliest_known"] + counts["current_package"]
    return (
        f"payments.0002 validity_days backfill: total={total} audit={counts['audit']} "
        f"earliest_known={counts['earliest_known']} current_package={counts['current_package']}"
        f"; successful payments whose checkout validity differs from the package validity "
        f"at verification (reported, not corrected)={counts['success_differs']}"
    )


def backfill(apps, schema_editor):
    values, counts = compute_backfill(apps)
    Payment = apps.get_model("payments", "Payment")
    by_value = defaultdict(list)
    for payment_id, value in values.items():
        by_value[value].append(payment_id)
    for value, ids in sorted(by_value.items()):
        Payment.objects.filter(pk__in=ids).update(validity_days=value)
    if values:
        print(f"\n  {report_line(counts)}")


class Migration(migrations.Migration):
    dependencies = [
        ("audit", "0001_initial"),
        ("payments", "0001_initial"),
        ("subscriptions", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="payment",
            name="validity_days",
            field=models.PositiveIntegerField(
                editable=False, null=True, verbose_name="validity (days)"
            ),
        ),
        migrations.RunPython(backfill, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="payment",
            name="validity_days",
            field=models.PositiveIntegerField(editable=False, verbose_name="validity (days)"),
        ),
        migrations.AddConstraint(
            model_name="payment",
            constraint=models.CheckConstraint(
                condition=models.Q(validity_days__gte=1, validity_days__lte=MAX_VALIDITY_DAYS),
                name="payments_validity_days_valid",
            ),
        ),
        migrations.RunSQL(GUARD_SNAPSHOT_SQL, UNGUARD_SNAPSHOT_SQL),
    ]
