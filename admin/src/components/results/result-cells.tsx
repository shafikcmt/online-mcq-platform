"use client";

import { Trophy } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { durationParts } from "@/lib/results";
import type { AdminResult } from "@/types/results";

/** Pass/fail as icon + text (null: the exam has no pass mark). */
export function OutcomeBadge({ passed }: { passed: boolean | null }) {
  const { t } = useI18n();
  if (passed === null) return <StatusBadge status="cancelled" label={t("outcome.noPassMark")} />;
  return <StatusBadge status={passed ? "success" : "failed"} label={t(passed ? "outcome.passed" : "outcome.failed")} />;
}

export function Duration({ seconds }: { seconds: number }) {
  const { locale, t } = useI18n();
  const { minutes, seconds: rest } = durationParts(seconds);
  const s = formatNumber(rest, locale);
  return (
    <span className="whitespace-nowrap tabular-nums">
      {minutes ? t("results.duration", { m: formatNumber(minutes, locale), s }) : t("results.durationSeconds", { s })}
    </span>
  );
}

/** Merit position as stored by the server (never computed here) and whether this result
 * counts for the merit list. */
export function MeritCell({ result }: { result: Pick<AdminResult, "merit_position" | "is_merit_counted"> }) {
  const { locale, t } = useI18n();
  return (
    <span className="block whitespace-nowrap">
      {result.merit_position !== null ? (
        <span className="inline-flex items-center gap-1 font-medium text-ink">
          <Trophy className="size-3.5 text-ink-subtle" aria-hidden />
          {t("meritState.position", { n: formatNumber(result.merit_position, locale) })}
        </span>
      ) : (
        <span className="text-ink-muted">{t("meritState.unranked")}</span>
      )}
      <span className="block text-[13px] text-ink-subtle">
        {t(result.is_merit_counted ? "meritState.counted" : "meritState.notCounted")}
      </span>
    </span>
  );
}

export function Marks({ result }: { result: Pick<AdminResult, "obtained_marks" | "total_marks"> }) {
  return (
    <span className="whitespace-nowrap tabular-nums">
      {result.obtained_marks} <span className="text-ink-subtle">/ {result.total_marks}</span>
    </span>
  );
}
