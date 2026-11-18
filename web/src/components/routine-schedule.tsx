import { ArrowRight, BookOpen, CalendarClock, Clock3, FileQuestion, Trophy } from "lucide-react";
import Link from "next/link";

import { Chip } from "@/components/cards";
import { decimal, digits, tidyName } from "@/lib/format";
import type { Lang, T } from "@/lib/i18n";
import { materialsHref } from "@/lib/materials";
import { dayLabel, groupByDay, routineState, syllabusText, timeRange, type RoutineExam } from "@/lib/routine";

const COLLAPSED_LINES = 2;

/** The routine: one block per day (a clear coloured date band), each exam on a card with what a
 * student plans by: when it runs and whether it is live, marks / time / questions, the topics (two
 * lines, the rest behind "Show more"), its study materials, and the way to the exam's own page.
 * Server-rendered; "Show more" is a native `<details>`, so it works without JavaScript. */
export function RoutineSchedule({ exams, lang, t, now }: { exams: RoutineExam[]; lang: Lang; t: T; now: number }) {
  const days = groupByDay(exams);
  return (
    <div className="flex flex-col gap-8">
      {days.map((day) => (
        <section key={day.key} aria-labelledby={`day-${day.key}`}>
          <h2 id={`day-${day.key}`} className="flex items-center gap-2 rounded-card bg-brand-700 px-4 py-2.5 text-base font-bold text-white sm:text-lg">
            <CalendarClock className="size-5" aria-hidden />
            <time dateTime={day.key}>{dayLabel(day.key, lang)}</time>
          </h2>
          <ul className="mt-3 grid gap-3">
            {day.exams.map((exam) => (
              <li key={exam.slug}>
                <RoutineCard exam={exam} lang={lang} t={t} live={routineState(exam, now) === "live"} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function RoutineCard({ exam, lang, t, live }: { exam: RoutineExam; lang: Lang; t: T; live: boolean }) {
  const topics = (exam.syllabus ?? []).map(syllabusText).filter(Boolean);
  const materials = exam.material_count ?? 0;
  const facts = [
    { Icon: Trophy, text: t("routine.marks", { n: decimal(exam.total_marks, lang) }) },
    { Icon: Clock3, text: t("routine.minutes", { n: digits(exam.duration_minutes, lang) }) },
    { Icon: FileQuestion, text: t("routine.questions", { n: digits(exam.total_questions, lang) }) },
  ];
  const line = (text: string, index: number) => (
    <li key={index}>
      {digits(index + 1, lang)}. {text}
    </li>
  );
  return (
    <article className={`flex flex-col gap-3 rounded-[1rem] border bg-surface p-4 shadow-sm sm:p-5 ${live ? "border-danger-700 border-l-4" : "border-line-strong"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto flex items-center gap-2 text-sm font-bold text-brand-800">
          <Clock3 className="size-4" aria-hidden />
          {timeRange(exam, lang)}
        </span>
        {live ? (
          <span className="flex items-center gap-1.5 text-xs font-bold text-danger-700">
            <span className="size-2 rounded-full bg-danger-700" aria-hidden />
            {t("routine.live")}
          </span>
        ) : (
          <Chip tone="info">{t("routine.upcoming")}</Chip>
        )}
        <Chip tone={exam.access_type === "free" ? "success" : "accent"}>{t(`exam.access.${exam.access_type}`)}</Chip>
      </div>
      <div>
        <h3 className="text-lg font-bold break-words text-ink">{exam.title}</h3>
        <p className="mt-0.5 text-sm text-ink-muted">{[tidyName(exam.category.name), exam.subject?.name].filter(Boolean).join(" · ")}</p>
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold text-ink">
        {facts.map(({ Icon, text }) => (
          <li key={text} className="flex items-center gap-1.5">
            <Icon className="size-4 text-ink-subtle" aria-hidden />
            {text}
          </li>
        ))}
      </ul>
      {topics.length ? (
        <div className="rounded-card bg-canvas p-3 text-sm text-ink-muted">
          <p className="font-bold text-ink">{t("routine.topics")}</p>
          <ol className="mt-1 flex flex-col gap-0.5">{topics.slice(0, COLLAPSED_LINES).map(line)}</ol>
          {topics.length > COLLAPSED_LINES ? (
            <details className="group">
              <summary className="mt-1 cursor-pointer list-none font-bold text-brand-700 hover:underline group-open:hidden">{t("routine.more")}</summary>
              <ol className="flex flex-col gap-0.5">{topics.slice(COLLAPSED_LINES).map((text, index) => line(text, index + COLLAPSED_LINES))}</ol>
            </details>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {materials > 0 ? (
          <Link href={materialsHref(lang, { exam: exam.slug })} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-accent-50 px-3 text-sm font-semibold text-warning-700 hover:underline">
            <BookOpen className="size-4" aria-hidden />
            {t("routine.materials", { n: digits(materials, lang) })}
          </Link>
        ) : null}
        <Link
          href={`/${lang}/exams/${exam.slug}`}
          aria-label={`${t("routine.view")}: ${exam.title}`}
          className={`ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-control px-4 text-sm font-semibold ${live ? "bg-brand-600 text-white hover:bg-brand-700" : "border border-line-strong text-brand-700 hover:border-brand-600 hover:bg-brand-50"}`}
        >
          {t("routine.view")}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </article>
  );
}
