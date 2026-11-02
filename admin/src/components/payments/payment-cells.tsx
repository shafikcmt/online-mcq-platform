"use client";

import { StatusBadge } from "@/components/ui/status-badge";
import { en, type MessageKey } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/provider";
import type { PaymentStatus } from "@/types/payments";

type T = ReturnType<typeof useI18n>["t"];

/** Label of a server code (`payReason.*`, `payEvent.*`, …). An unknown code is shown as
 * the code itself — never guessed, never dropped. */
export function codeLabel(t: T, prefix: "payReason" | "payEvent" | "payOutcome" | "paySource" | "payProvider", code: string): string {
  const key = `${prefix}.${code}`;
  return key in en ? t(key as MessageKey) : t("payments.code", { code });
}

/** The server's payment status (icon + text), exactly as returned. */
export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const { t } = useI18n();
  const key = `paymentStatus.${status}`;
  return <StatusBadge status={status} label={key in en ? t(key as MessageKey) : status} className="whitespace-nowrap" />;
}

/** Status plus the server's reason code underneath (a pending payment may carry one,
 * e.g. held for the provider's risk review) — the reason never becomes a new status. */
export function PaymentState({ status, reason }: { status: PaymentStatus; reason: string }) {
  const { t } = useI18n();
  return (
    <span className="block space-y-1">
      <PaymentStatusBadge status={status} />
      {reason && (
        <span className="block text-xs break-words text-ink-muted" data-reason={reason}>
          {t("payments.reasonLabel", { reason: codeLabel(t, "payReason", reason) })}
        </span>
      )}
    </span>
  );
}
