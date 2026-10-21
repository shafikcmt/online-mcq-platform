"use client";

import { StatusBadge } from "@/components/ui/status-badge";
import { useI18n } from "@/lib/i18n/provider";
import type { AdminSubscription, EffectiveSubscriptionStatus } from "@/types/subscriptions";

const STYLE: Record<EffectiveSubscriptionStatus, string> = {
  active: "active",
  scheduled: "initiated",
  expired: "archived",
  cancelled: "cancelled",
};

/** The server's effective status (icon + text) — never worked out from dates here. */
export function EffectiveStatusBadge({ status }: { status: EffectiveSubscriptionStatus }) {
  const { t } = useI18n();
  return <StatusBadge status={STYLE[status]} label={t(`effective.${status}`)} className="whitespace-nowrap" />;
}

/** Effective status, plus the stored status underneath when the two differ (e.g. a
 * stored "active" subscription that has expired but the expiry job has not marked yet). */
export function SubscriptionState({ subscription }: { subscription: Pick<AdminSubscription, "status" | "effective_status"> }) {
  const { t } = useI18n();
  return (
    <span className="block space-y-1">
      <EffectiveStatusBadge status={subscription.effective_status} />
      {subscription.status !== subscription.effective_status && (
        <span className="block text-xs text-ink-subtle">{t("subscriptions.recorded", { status: t(`stored.${subscription.status}`) })}</span>
      )}
    </span>
  );
}
