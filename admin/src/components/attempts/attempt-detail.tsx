"use client";

import { AlarmClockOff, ArrowLeft, ArrowRight, Clock3, Info } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Duration, MeritCell, Marks, OutcomeBadge } from "@/components/results/result-cells";
import { Alert } from "@/components/ui/alert";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { localized } from "@/lib/localized";
import type { AdminAttemptDetail } from "@/types/attempts";

import { AttemptState } from "./attempt-cells";

/** One attempt as the admin attempts API returns it: status, the server's timing (server
 * time, deadline, submit cutoff, remaining seconds — read once, no client countdown) and
 * the stored result summary. No answers — the admin API has none. */
export function AttemptDetail({ attempt }: { attempt: AdminAttemptDetail }) {
  const { locale, t } = useI18n();
  const title = localized(locale, attempt.exam_title_bn, attempt.exam_title_en);
  const examName = title.text || `#${attempt.exam_id}`;
  const n = (value: number) => formatNumber(value, locale);
  const when = (iso: string) => formatDateTime(iso, locale);
  const open = attempt.status === "in_progress";

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link href="/attempts" className="inline-flex items-center gap-1.5 rounded-control text-sm text-ink-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden />
          {t("attemptDetail.back")}
        </Link>
        <header className="space-y-2">
          <p className="text-sm font-medium text-ink-muted">{t("attemptDetail.title")}</p>
          <h1 className="text-2xl font-semibold tracking-tight break-words text-ink">
            <Link href={`/users/${attempt.user_id}`} className="rounded-control hover:text-brand-700 hover:underline">
              {attempt.user_full_name}
            </Link>
          </h1>
          <p className="text-sm break-words text-ink-muted">
            <Link href={`/exams/${attempt.exam_id}`} lang={title.lang} className="rounded-control text-brand-700 hover:underline">
              {examName}
            </Link>
            {" · "}
            {t("results.attemptNo", { n: n(attempt.attempt_no) })}
          </p>
          <AttemptState attempt={attempt} />
        </header>
      </div>

      {attempt.is_overdue ? (
        // A notice, not an error: the server finalizes overdue attempts on its own.
        <Alert tone="warning">
          <span className="flex items-start gap-2">
            <AlarmClockOff className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <strong className="block font-semibold">{t("attemptDetail.overdueTitle")}</strong>
              {t("attemptDetail.overdueBody")}
            </span>
          </span>
        </Alert>
      ) : (
        open && (
          <p className="flex items-start gap-2 rounded-card border border-line bg-neutral-50/70 px-4 py-3 text-sm text-ink-muted">
            <Clock3 className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t("attemptDetail.inProgressNote")}
          </p>
        )
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section id="attempt-timeline" title={t("attemptDetail.sectionTimeline")}>
          <Item label={t("attemptDetail.started")}>{when(attempt.started_at)}</Item>
          <Item label={t("attemptDetail.deadline")}>{when(attempt.deadline_at)}</Item>
          <Item label={t("attemptDetail.cutoff")}>{when(attempt.can_submit_until)}</Item>
          <Item label={t("attemptDetail.submitted")}>
            {attempt.submitted_at ? when(attempt.submitted_at) : <span className="text-ink-subtle">{t("attempts.notSubmitted")}</span>}
          </Item>
          {attempt.submit_source && <Item label={t("attemptDetail.submitSource")}>{t(`submitSource.${attempt.submit_source}`)}</Item>}
          <Item label={t("attemptDetail.serverTime")}>{when(attempt.server_time)}</Item>
          <Item label={t("attemptDetail.remaining")}>
            {!open ? (
              <span className="text-ink-subtle">{t("attemptDetail.finished")}</span>
            ) : attempt.remaining_seconds > 0 ? (
              <Duration seconds={attempt.remaining_seconds} />
            ) : (
              t("attemptDetail.remainingNone")
            )}
          </Item>
        </Section>

        <Section id="attempt-info" title={t("attemptDetail.sectionAttempt")}>
          <Item label={t("attemptDetail.status")}>{t(`resultStatus.${attempt.status}`)}</Item>
          <Item label={t("attemptDetail.attemptNo")}>{n(attempt.attempt_no)}</Item>
          <Item label={t("attemptDetail.language")}>{t(attempt.content_language === "bn" ? "language.bn" : "language.en")}</Item>
          <Item label={t("attemptDetail.created")}>{when(attempt.created_at)}</Item>
        </Section>

        <Section id="attempt-result" title={t("attemptDetail.sectionResult")} wide>
          {attempt.has_result && attempt.obtained_marks !== null && attempt.total_marks !== null ? (
            <>
              <Item label={t("resultDetail.obtained")}>
                <Marks result={{ obtained_marks: attempt.obtained_marks, total_marks: attempt.total_marks }} />
              </Item>
              <Item label={t("resultDetail.percentage")}>
                <span className="tabular-nums">{attempt.percentage}%</span>
              </Item>
              <Item label={t("resultDetail.outcome")}>
                <OutcomeBadge passed={attempt.is_passed} />
              </Item>
              {attempt.time_used_seconds !== null && (
                <Item label={t("resultDetail.timeUsed")}>
                  <Duration seconds={attempt.time_used_seconds} />
                </Item>
              )}
              <Item label={t("resultDetail.meritPosition")}>
                <MeritCell result={{ merit_position: attempt.merit_position, is_merit_counted: Boolean(attempt.is_merit_counted) }} />
              </Item>
              <div className="sm:col-span-2">
                <Link
                  href={`/results/${attempt.attempt_id}`}
                  className="inline-flex items-center gap-1 rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-600"
                >
                  {t("attemptDetail.openResult")}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </div>
            </>
          ) : (
            // Plain text, not a disabled link: there is no result to open yet.
            <div className="sm:col-span-2" data-no-result>
              <p className="text-sm font-medium text-ink">{t("attemptDetail.noResult")}</p>
              <p className="mt-0.5 text-sm text-ink-muted">{t("attemptDetail.noResultHint")}</p>
            </div>
          )}
        </Section>
      </div>

      <div className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="inline-flex items-center gap-1.5 text-ink-subtle">
          <Info className="size-4" aria-hidden />
          {t("attemptDetail.noAnswers")}
        </p>
        <span className="flex flex-wrap gap-x-4 gap-y-2">
          <Link href={`/attempts?user=${attempt.user_id}`} className="rounded-control font-medium text-brand-700 underline underline-offset-2 hover:text-brand-600">
            {t("attemptDetail.studentAttempts")}
          </Link>
          <Link href={`/attempts?exam=${attempt.exam_id}`} className="rounded-control font-medium text-brand-700 underline underline-offset-2 hover:text-brand-600">
            {t("attemptDetail.examAttempts")}
          </Link>
        </span>
      </div>
    </div>
  );
}

function Section({ id, title, children, wide = false }: { id: string; title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section aria-labelledby={id} className={wide ? "rounded-card border border-line bg-surface lg:col-span-2" : "rounded-card border border-line bg-surface"}>
      <h2 id={id} className="border-b border-line px-5 py-3.5 text-[15px] font-semibold text-ink">
        {title}
      </h2>
      <dl className="grid gap-x-6 gap-y-4 px-5 py-5 sm:grid-cols-2">{children}</dl>
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
