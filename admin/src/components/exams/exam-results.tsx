"use client";

import { Eye, EyeOff, Trophy } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormSection } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { describeExamError } from "@/lib/exam-errors";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import type { Exam } from "@/types/exams";

type Action = "publish" | "hide" | "merit";

/** Result controls for an exam that has been published at least once — used by the exam
 * editor (7C) and the Results screen (7D), so both share one implementation. Publishing
 * and hiding results are idempotent on the server and return the exam; merit generation
 * returns the number of ranked students. All buttons wait for the server. Whether
 * students can see the results right now is the server's `results_visible`, never
 * derived here from the setting, the schedule or the publication time. */
export function ExamResults({
  exam,
  onExamChange,
  onMeritGenerated,
  title,
  link,
}: {
  exam: Exam;
  onExamChange: (exam: Exam) => void;
  /** After the server ranked the results (e.g. the Results list re-reads its rows). */
  onMeritGenerated?: (rankedCount: number) => void;
  title?: string;
  /** Shown next to the actions (the editor links to the results, the results to the exam). */
  link?: ReactNode;
}) {
  const { locale, t } = useI18n();
  const { notify } = useToast();
  const [pending, setPending] = useState<Action | null>(null);
  const [failure, setFailure] = useState<{ title?: string; message: string } | null>(null);

  async function run(action: Action) {
    setPending(action);
    setFailure(null);
    try {
      if (action === "merit") {
        const result = await apiFetch<{ ranked_count: number }>(`/admin/exams/${exam.id}/merit/generate/`, { method: "POST" });
        notify(t("examResults.meritGenerated", { n: formatNumber(result.ranked_count, locale) }));
        onMeritGenerated?.(result.ranked_count);
      } else {
        const updated = await apiFetch<Exam>(`/admin/exams/${exam.id}/results/${action}/`, { method: "POST" });
        onExamChange(updated);
        notify(t(action === "publish" ? "examResults.published" : "examResults.hidden"));
      }
    } catch (error) {
      setFailure(describeExamError(error, t));
    }
    setPending(null);
  }

  const published = exam.result_published_at !== null;

  return (
    <FormSection title={title ?? t("examResults.title")} description={t("examResults.hint")} aside={link}>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-xs font-medium text-ink-subtle">{t("exam.resultVisibility")}</dt>
          <dd className="mt-0.5 text-ink">{t(`visibility.${exam.result_visibility}`)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-medium text-ink-subtle">{t("examResults.effective")}</dt>
          <dd
            className={
              exam.results_visible
                ? "mt-0.5 flex items-center gap-1.5 font-medium text-success-700"
                : "mt-0.5 flex items-center gap-1.5 font-medium text-ink"
            }
            data-results-visible={exam.results_visible}
          >
            {exam.results_visible ? <Eye className="size-4 shrink-0" aria-hidden /> : <EyeOff className="size-4 shrink-0" aria-hidden />}
            {t(exam.results_visible ? "examResults.visibleNow" : "examResults.hiddenNow")}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-medium text-ink-subtle">{t("examResults.title")}</dt>
          <dd className="mt-0.5 text-ink-muted">
            {published
              ? t("examResults.publishedAt", { date: formatDateTime(exam.result_published_at as string, locale) })
              : t("examResults.notPublished")}
          </dd>
        </div>
      </dl>
      {failure && (
        <Alert tone="danger" title={failure.title} live>
          {failure.message}
        </Alert>
      )}
      <p className="text-[13px] text-ink-muted">{t("examResults.appliesToAll")}</p>
      <div className="flex flex-wrap gap-2">
        {published ? (
          <Button variant="secondary" onClick={() => run("hide")} disabled={pending !== null} aria-busy={pending === "hide" || undefined}>
            <EyeOff aria-hidden />
            {pending === "hide" ? t("exam.working") : t("examResults.hide")}
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => run("publish")} disabled={pending !== null} aria-busy={pending === "publish" || undefined}>
            <Eye aria-hidden />
            {pending === "publish" ? t("exam.working") : t("examResults.publish")}
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={() => run("merit")}
          disabled={pending !== null || !exam.merit_enabled}
          aria-busy={pending === "merit" || undefined}
          aria-describedby={exam.merit_enabled ? undefined : "exam-merit-off"}
        >
          <Trophy aria-hidden />
          {pending === "merit" ? t("exam.working") : t("examResults.generateMerit")}
        </Button>
      </div>
      {!exam.merit_enabled && (
        <p id="exam-merit-off" className="text-[13px] text-ink-subtle">
          {t("examResults.meritOff")}
        </p>
      )}
    </FormSection>
  );
}
