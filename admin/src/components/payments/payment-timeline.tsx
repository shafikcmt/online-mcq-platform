"use client";

import { formatDateTime } from "@/lib/format";
import { en, type MessageKey } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/provider";
import type { PaymentEvent } from "@/types/payments";

import { codeLabel } from "./payment-cells";

/** The payment's events as an ordered list (oldest first, as the server sends them).
 * Each event shows only the server's allow-listed short codes — no provider payloads,
 * IP addresses or identifiers. */
export function PaymentTimeline({ events }: { events: PaymentEvent[] }) {
  const { locale, t } = useI18n();
  const statusText = (code: string) => {
    const key = `paymentStatus.${code}`;
    return key in en ? t(key as MessageKey) : code;
  };

  return (
    <ol className="relative space-y-4 border-l border-line pl-5" data-timeline>
      {events.map((event, index) => {
        const s = event.summary;
        const facts: { label: string; value: string }[] = [];
        if (s.outcome) facts.push({ label: t("payTimeline.outcome"), value: codeLabel(t, "payOutcome", s.outcome) });
        if (s.source) facts.push({ label: t("payTimeline.source"), value: codeLabel(t, "paySource", s.source) });
        else if (s.kind) facts.push({ label: t("payTimeline.source"), value: codeLabel(t, "paySource", s.kind) });
        if (s.reason) facts.push({ label: t("payTimeline.reason"), value: codeLabel(t, "payReason", s.reason) });
        if (s.previous_reason) facts.push({ label: t("payTimeline.previousReason"), value: codeLabel(t, "payReason", s.previous_reason) });
        if (s.error) facts.push({ label: t("payTimeline.error"), value: codeLabel(t, "payReason", s.error) });
        if (s.signature_valid !== undefined)
          facts.push({ label: t("payTimeline.signature"), value: s.signature_valid ? t("payTimeline.signatureValid") : t("payTimeline.signatureInvalid") });
        return (
          <li key={`${event.created_at}-${index}`} className="relative" data-event-type={event.event_type}>
            <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-surface bg-brand-600" aria-hidden />
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <p className="text-sm font-medium text-ink">{codeLabel(t, "payEvent", event.event_type)}</p>
              <time dateTime={event.created_at} className="text-xs text-ink-subtle">
                {formatDateTime(event.created_at, locale)}
              </time>
            </div>
            {s.from && s.to && (
              <p className="mt-0.5 text-sm text-ink-muted">{t("payTimeline.statusChange", { from: statusText(s.from), to: statusText(s.to) })}</p>
            )}
            {facts.length > 0 && (
              <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink-muted">
                {facts.map((fact) => (
                  <div key={fact.label} className="flex min-w-0 gap-1">
                    <dt className="text-ink-subtle">{`${fact.label}: `}</dt>
                    <dd className="break-words">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        );
      })}
    </ol>
  );
}
