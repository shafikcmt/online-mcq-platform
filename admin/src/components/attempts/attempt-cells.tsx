"use client";

import { AlarmClockOff } from "lucide-react";

import { Marks, OutcomeBadge } from "@/components/results/result-cells";
import { StatusBadge } from "@/components/ui/status-badge";
import { useI18n } from "@/lib/i18n/provider";
import type { AttemptStatus } from "@/types/results";
import type { AdminAttempt } from "@/types/attempts";

const STATUS_STYLE: Record<AttemptStatus, string> = {
  in_progress: "initiated",
  submitted: "success",
  auto_submitted: "published",
};

/** Attempt status as icon + text. */
export function AttemptStatusBadge({ status }: { status: AttemptStatus }) {
  const { t } = useI18n();
  return <StatusBadge status={STATUS_STYLE[status]} label={t(`resultStatus.${status}`)} className="whitespace-nowrap" />;
}

/** The server's overdue flag (open past deadline + grace) — never computed here. Shown as
 * a notice, not an error: the server finalizes the attempt. */
export function OverdueBadge() {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full whitespace-nowrap bg-warning-50 px-2.5 py-0.5 text-xs font-medium text-warning-700 ring-1 ring-warning-700/15 ring-inset">
      <AlarmClockOff className="size-3.5" aria-hidden />
      {t("attempts.overdue")}
    </span>
  );
}

/** Status, plus the overdue notice when the server says so. */
export function AttemptState({ attempt }: { attempt: Pick<AdminAttempt, "status" | "is_overdue"> }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <AttemptStatusBadge status={attempt.status} />
      {attempt.is_overdue && <OverdueBadge />}
    </span>
  );
}

/** The stored result summary, or "No result yet" as text. */
export function ResultState({ attempt }: { attempt: AdminAttempt }) {
  const { t } = useI18n();
  if (!attempt.has_result || attempt.obtained_marks === null || attempt.total_marks === null) {
    return <span className="text-ink-muted">{t("attempts.noResultYet")}</span>;
  }
  return (
    <span className="block space-y-1">
      <span className="block">
        <Marks result={{ obtained_marks: attempt.obtained_marks, total_marks: attempt.total_marks }} />
      </span>
      <span className="block text-[13px] text-ink-muted tabular-nums">{attempt.percentage}%</span>
      <OutcomeBadge passed={attempt.is_passed} />
    </span>
  );
}
