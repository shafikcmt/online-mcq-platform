import { ChevronRight } from "lucide-react";
import Link from "next/link";

import type { Exam } from "@/lib/api";
import type { When } from "@/lib/exam-filters";
import { dateTime, tidyName } from "@/lib/format";
import type { Lang, T } from "@/lib/i18n";

export type ExamRow = { exam: Exam; when: When };

/** A category's or group's exams as clear rows, running ones first: a red "Live" mark on a scheduled
 * exam that is running now (never colour alone), "Upcoming", and "Archived" for past ones. */
export function ExamRows({ rows, lang, t }: { rows: ExamRow[]; lang: Lang; t: T }) {
  return (
    <ul className="flex flex-col gap-3">
      {rows.map(({ exam, when }) => {
        // "Live" is a scheduled exam that is running now; an exam with no schedule is simply open.
        const live = when === "open" && exam.start_at !== null;
        const mark = live ? "live" : when === "upcoming" ? "upcoming" : when === "ended" ? "archived" : null;
        const time =
          when === "upcoming" && exam.start_at
            ? t("exam.starts", { date: dateTime(exam.start_at, lang) })
            : when === "open" && exam.end_at
              ? t("exam.ends", { date: dateTime(exam.end_at, lang) })
              : null;
        return (
          <li key={exam.slug}>
            <Link
              href={`/${lang}/exams/${exam.slug}`}
              className={`flex min-h-14 items-center gap-3 rounded-[1rem] border px-5 py-3 shadow-sm transition hover:border-brand-600 hover:bg-brand-50 ${when === "ended" ? "border-line bg-canvas" : "border-line-strong bg-surface"}`}
            >
              <span className="min-w-0 flex-1">
                <span className={`block font-semibold break-words ${when === "ended" ? "text-ink-muted" : "text-ink"}`}>{tidyName(exam.title)}</span>
                {time ? <span className="block text-xs text-ink-muted">{time}</span> : null}
              </span>
              {mark ? (
                <span className={`flex shrink-0 items-center gap-1.5 text-xs font-bold ${live ? "text-danger-700" : mark === "upcoming" ? "text-info-700" : "text-ink-subtle"}`}>
                  {live ? <span className="size-2 rounded-full bg-danger-700" aria-hidden /> : null}
                  {t(`category.mark.${mark}`)}
                </span>
              ) : null}
              <ChevronRight className="size-4 shrink-0 text-ink-subtle" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
