"use client";

import { ArrowLeft, Eye, EyeOff, Info } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { formatDateTime, formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { localized } from "@/lib/localized";
import type { Exam } from "@/types/exams";
import type { AdminResult } from "@/types/results";

import { Duration, OutcomeBadge } from "./result-cells";

/** One result as the admin results API returns it: scores, timing, merit and the exam's
 * visibility as computed by the server. No answers — the admin API has none. */
export function ResultDetail({ result, exam }: { result: AdminResult; exam: Exam | null }) {
  const { locale, t } = useI18n();
  const title = localized(locale, result.exam_title_bn, result.exam_title_en);
  const examName = title.text || `#${result.exam_id}`;
  const n = (value: number) => formatNumber(value, locale);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link
          href={`/results?exam=${result.exam_id}`}
          className="inline-flex items-center gap-1.5 rounded-control text-sm text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("resultDetail.back")}
        </Link>
        <header className="space-y-2">
          <p className="text-sm font-medium text-ink-muted">{t("resultDetail.title")}</p>
          <h1 className="text-2xl font-semibold tracking-tight break-words text-ink">{result.user_full_name}</h1>
          <p className="text-sm break-words text-ink-muted">
            <Link href={`/exams/${result.exam_id}`} lang={title.lang} className="rounded-control text-brand-700 hover:underline">
              {examName}
            </Link>
            {" · "}
            {t("results.attemptNo", { n: n(result.attempt_no) })}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <OutcomeBadge passed={result.is_passed} />
          </div>
        </header>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section id="result-score" title={t("resultDetail.sectionScore")}>
          <Item label={t("resultDetail.obtained")}>
            <span className="tabular-nums">{t("resultDetail.marksOf", { n: result.obtained_marks, total: result.total_marks })}</span>
          </Item>
          <Item label={t("resultDetail.percentage")}>
            <span className="tabular-nums">{result.percentage}%</span>
          </Item>
          <Item label={t("resultDetail.outcome")}>
            <OutcomeBadge passed={result.is_passed} />
          </Item>
          <Item label={t("resultDetail.correct")}>{n(result.correct_count)}</Item>
          <Item label={t("resultDetail.wrong")}>{n(result.wrong_count)}</Item>
          <Item label={t("resultDetail.unanswered")}>{n(result.unanswered_count)}</Item>
        </Section>

        <Section id="result-attempt" title={t("resultDetail.sectionAttempt")}>
          <Item label={t("resultDetail.attempt")}>{n(result.attempt_no)}</Item>
          <Item label={t("resultDetail.status")}>{t(`resultStatus.${result.status}`)}</Item>
          {result.submit_source && <Item label={t("resultDetail.submitSource")}>{t(`submitSource.${result.submit_source}`)}</Item>}
          <Item label={t("resultDetail.submittedAt")}>{formatDateTime(result.submitted_at, locale)}</Item>
          <Item label={t("resultDetail.timeUsed")}>
            <Duration seconds={result.time_used_seconds} />
          </Item>
        </Section>

        <Section id="result-merit" title={t("resultDetail.sectionMerit")}>
          <Item label={t("resultDetail.meritCounted")}>
            {t(result.is_merit_counted ? "meritState.counted" : "meritState.notCounted")}
          </Item>
          <Item label={t("resultDetail.meritPosition")}>
            {result.merit_position !== null ? n(result.merit_position) : t("meritState.unranked")}
          </Item>
        </Section>

        <Section
          id="result-visibility"
          title={t("resultDetail.sectionVisibility")}
          footer={
            <Link
              href={`/results?exam=${result.exam_id}`}
              className="rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-600"
            >
              {t("resultDetail.manage")}
            </Link>
          }
        >
          {exam && (
            <>
              <Item label={t("resultDetail.setting")}>{t(`visibility.${exam.result_visibility}`)}</Item>
              <Item label={t("examResults.effective")}>
                <span className="inline-flex items-center gap-1.5 font-medium" data-results-visible={exam.results_visible}>
                  {exam.results_visible ? <Eye className="size-4" aria-hidden /> : <EyeOff className="size-4" aria-hidden />}
                  {t(exam.results_visible ? "examResults.visibleNow" : "examResults.hiddenNow")}
                </span>
              </Item>
            </>
          )}
        </Section>
      </div>

      <div className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="inline-flex items-center gap-1.5 text-ink-subtle">
          <Info className="size-4" aria-hidden />
          {t("resultDetail.noAnswers")}
        </p>
        <span className="flex flex-wrap gap-x-4 gap-y-2">
          <Link
            href={`/attempts/${result.attempt_id}`}
            className="rounded-control font-medium text-brand-700 underline underline-offset-2 hover:text-brand-600"
          >
            {t("resultDetail.openAttempt")}
          </Link>
          <Link
            href={`/results?user=${result.user_id}`}
            className="rounded-control font-medium text-brand-700 underline underline-offset-2 hover:text-brand-600"
          >
            {t("resultDetail.studentResults")}
          </Link>
        </span>
      </div>
    </div>
  );
}

/** A titled card of label/value pairs. Only `Item`s go inside the `<dl>`; a link or note
 * that is not a pair goes in `footer`, below the list. */
function Section({ id, title, children, footer }: { id: string; title: string; children?: ReactNode; footer?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-card border border-line bg-surface">
      <h2 id={id} className="border-b border-line px-5 py-3.5 text-[15px] font-semibold text-ink">
        {title}
      </h2>
      {children && <dl className="grid gap-x-6 gap-y-4 px-5 py-5 sm:grid-cols-2">{children}</dl>}
      {footer && <div className={children ? "px-5 pb-5" : "px-5 py-5"}>{footer}</div>}
    </section>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-sm break-words text-ink">{children}</dd>
    </div>
  );
}
