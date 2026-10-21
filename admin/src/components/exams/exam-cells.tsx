"use client";

import { Star } from "lucide-react";
import Link from "next/link";

import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { localized } from "@/lib/localized";
import type { Exam, ExamStatus } from "@/types/exams";

export function ExamStatusBadge({ status }: { status: ExamStatus }) {
  const { t } = useI18n();
  return <StatusBadge status={status} label={t(`examStatus.${status}`)} />;
}

export function examTitle(exam: Pick<Exam, "title_bn" | "title_en">, locale: "bn" | "en") {
  return localized(locale, exam.title_bn, exam.title_en);
}

/** Title in the UI language (falls back to the other), linked to the editor. */
export function ExamTitle({ exam }: { exam: Exam }) {
  const { locale, t } = useI18n();
  const title = examTitle(exam, locale);
  return (
    <Link href={`/exams/${exam.id}`} className="group block min-w-0 rounded-control">
      <span lang={title.lang} className="line-clamp-2 font-medium break-words text-ink group-hover:text-brand-700 group-hover:underline">
        {title.text || t("exams.untitled")}
      </span>
      <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-subtle">
        <span className="break-all">{exam.slug}</span>
        {exam.is_featured && (
          <span className="inline-flex items-center gap-1 text-warning-700">
            <Star className="size-3.5" aria-hidden />
            {t("exams.featured")}
          </span>
        )}
      </span>
    </Link>
  );
}

export function ScheduleCell({ exam }: { exam: Pick<Exam, "start_at" | "end_at"> }) {
  const { locale, t } = useI18n();
  if (!exam.start_at && !exam.end_at) return <span className="text-ink-subtle">{t("exams.noSchedule")}</span>;
  return (
    <span className="block text-[13px] text-ink-muted">
      {exam.start_at && <span className="block">{t("exams.startsAt", { start: formatDateTime(exam.start_at, locale) })}</span>}
      {exam.end_at && <span className="block">{t("exams.endsAt", { end: formatDateTime(exam.end_at, locale) })}</span>}
    </span>
  );
}

/** "Assigned of planned": `question_count` is what is assigned now, `total_questions` the
 * number publishing requires. A mismatch is shown in text, not colour alone. */
export function QuestionCountCell({ exam }: { exam: Pick<Exam, "question_count" | "total_questions"> }) {
  const { locale, t } = useI18n();
  const complete = exam.question_count === exam.total_questions;
  return (
    <span className={complete ? "tabular-nums text-ink" : "tabular-nums text-warning-700"}>
      {t("exams.questionsOf", {
        n: formatNumber(exam.question_count, locale),
        total: formatNumber(exam.total_questions, locale),
      })}
    </span>
  );
}
