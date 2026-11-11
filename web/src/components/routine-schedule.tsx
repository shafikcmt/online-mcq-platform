import { CalendarClock, Clock3 } from "lucide-react";
import Link from "next/link";

import { Chip } from "@/components/cards";
import { decimal, digits } from "@/lib/format";
import type { Lang, T } from "@/lib/i18n";
import { dayLabel, groupByDay, routineState, timeRange, type RoutineExam } from "@/lib/routine";

/** The routine: one block per day, each exam with its time, title, category and the facts a
 * student plans by. Server-rendered; each exam links to its own page (syllabus, rules). */
export function RoutineSchedule({ exams, lang, t, now }: { exams: RoutineExam[]; lang: Lang; t: T; now: number }) {
  const days = groupByDay(exams);
  return (
    <div className="flex flex-col gap-8">
      {days.map((day) => (
        <section key={day.key} aria-labelledby={`day-${day.key}`}>
          <h2 id={`day-${day.key}`} className="flex items-center gap-2 text-lg font-semibold text-ink">
            <CalendarClock className="size-5 text-brand-700" aria-hidden />
            <time dateTime={day.key}>{dayLabel(day.key, lang)}</time>
          </h2>
          <ul className="mt-3 grid gap-3">
            {day.exams.map((exam) => {
              const live = routineState(exam, now) === "live";
              return (
                <li key={exam.slug}>
                  <Link
                    href={`/${lang}/exams/${exam.slug}`}
                    className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-sm transition-colors hover:border-brand-600 sm:flex-row sm:items-center"
                  >
                    <span className="flex shrink-0 items-center gap-2 text-sm font-semibold text-brand-800 sm:w-52">
                      <Clock3 className="size-4" aria-hidden />
                      {timeRange(exam, lang)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold break-words text-ink">{exam.title}</span>
                      <span className="mt-0.5 block text-sm text-ink-muted">
                        {[exam.category.name, exam.subject?.name].filter(Boolean).join(" · ")}
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-subtle">
                        {t("routine.details", {
                          minutes: digits(exam.duration_minutes, lang),
                          questions: digits(exam.total_questions, lang),
                          marks: decimal(exam.total_marks, lang),
                        })}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <Chip tone={live ? "success" : "brand"}>{live ? t("routine.live") : t("routine.upcoming")}</Chip>
                      <Chip tone={exam.access_type === "free" ? "success" : "accent"}>{t(`exam.access.${exam.access_type}`)}</Chip>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
