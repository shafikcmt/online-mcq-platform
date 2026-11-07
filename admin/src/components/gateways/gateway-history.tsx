"use client";

import Link from "next/link";

import { DateTimeText } from "@/components/ui/date-time";
import { FormSection } from "@/components/ui/form";
import { logTypeLabel } from "@/lib/gateway-form";
import { useI18n } from "@/lib/i18n/provider";
import type { GatewayLogEntry } from "@/types/gateways";

/** The gateway's own history (settings, credentials by field name only, mode, switches,
 * connection tests, provider errors) with a link to the admin-wide audit log. */
export function GatewayHistory({ entries }: { entries: GatewayLogEntry[] }) {
  const { t } = useI18n();
  return (
    <FormSection
      title={t("gw.secHistory")}
      description={t("gw.logNote")}
      aside={
        <Link href="/audit-log?entity_type=payments.gateway" className="text-sm font-medium text-brand-700 hover:underline">
          {t("gw.auditLink")}
        </Link>
      }
    >
      {entries.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("gw.logEmpty")}</p>
      ) : (
        <ol className="divide-y divide-line">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-0.5 py-2.5 text-sm sm:flex-row sm:items-baseline sm:justify-between">
              <span className="min-w-0">
                <span className="font-medium text-ink">{logTypeLabel(entry.event_type, t)}</span>
                {entry.summary ? <span className="text-ink-muted"> · {entry.summary}</span> : null}
                <span className="text-ink-subtle"> · {entry.actor ? t("gw.logBy", { name: entry.actor }) : t("gw.logSystem")}</span>
              </span>
              <span className="shrink-0 text-xs text-ink-subtle">
                <DateTimeText iso={entry.created_at} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </FormSection>
  );
}
