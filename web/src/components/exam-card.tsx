import { BookOpen, Clock3, FileQuestion, Trophy } from "lucide-react";
import Link from "next/link";

import { Chip } from "@/components/cards";
import { dateTime, decimal, digits, tidyName } from "@/lib/format";
import type { Lang, T } from "@/lib/i18n";
import { materialsHref } from "@/lib/materials";
import { dayKey, dayLabel, syllabusText } from "@/lib/routine";
import type { Exam } from "@/lib/api";
import type { When } from "@/lib/exam-filters";

export type ExamCardItem = { exam: Exam; when: When };

const COLLAPSED_LINES = 2;

/** A category's or group's exams as cards, in the order given (running first): the day it runs, a mark
 * (a red "Live" for a scheduled exam running now, "Upcoming", "Archived"), marks / minutes / questions,
 * the subject, the syllabus (two lines, the rest behind a native "Show more"), its study materials and a
 * button to the exam's own page. The exam itself is taken in the app. Server-rendered. */
export function ExamCards({ rows, lang, t }: { rows: ExamCardItem[]; lang: Lang; t: T }) {
  const live = rows.some(({ exam, when }) => when === "open" && exam.start_at !== null);
  return (
    <div className="flex flex-col gap-4">
      {live ? <p className="rounded-card bg-brand-100 px-4 py-3 text-center text-sm font-semibold text-brand-950">{t("category.liveToday")}</p> : null}
      <ul className="flex flex-col gap-4">
        {rows.map(({ exam, when }) => (
          <li key={exam.slug}>
            <Card exam={exam} when={when} lang={lang} t={t} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Card({ exam, when, lang, t }: ExamCardItem & { lang: Lang; t: T }) {
  // "Live" is a scheduled exam that is running now; an exam with no schedule is simply open.
  const live = when === "open" && exam.start_at !== null;
  const mark = live ? "live" : when === "upcoming" ? "upcoming" : when === "ended" ? "archived" : null;
  const anchor = exam.start_at ?? exam.end_at;
  const topics = (exam.syllabus ?? []).map(syllabusText).filter(Boolean);
  const materials = exam.material_count ?? 0;
  const href = `/${lang}/exams/${exam.slug}`;
  const line = (text: string, index: number) => (
    <li key={index}>
      {digits(index + 1, lang)}. {text}
    </li>
  );
  const facts = [
    { Icon: Trophy, text: t("routine.marks", { n: decimal(exam.total_marks, lang) }) },
    { Icon: Clock3, text: t("routine.minutes", { n: digits(exam.duration_minutes, lang) }) },
    { Icon: FileQuestion, text: t("routine.questions", { n: digits(exam.total_questions, lang) }) },
  ];
  const button = "inline-flex min-h-11 w-full items-center justify-center rounded-control px-4 text-sm font-semibold";
  return (
    <article className={`flex flex-col gap-3 rounded-[1rem] border p-4 shadow-sm sm:p-5 ${live ? "border-danger-700 border-l-4 bg-surface" : when === "ended" ? "border-line bg-canvas" : "border-line-strong bg-surface"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-lg font-bold text-ink">{anchor ? dayLabel(dayKey(anchor), lang) : t("category.cardAnyTime")}</h3>
        {mark === "live" ? (
          <span className="flex items-center gap-1.5 text-xs font-bold text-danger-700">
            <span className="size-2 rounded-full bg-danger-700" aria-hidden />
            {t("category.mark.live")}
          </span>
        ) : mark ? (
          <Chip tone={mark === "upcoming" ? "info" : "neutral"}>{t(`category.mark.${mark}`)}</Chip>
        ) : null}
        <Chip tone={exam.access_type === "free" ? "success" : "accent"}>{t(exam.access_type === "free" ? "category.cardFree" : "category.cardPaid")}</Chip>
      </div>
      <Link href={href} className={`font-semibold break-words hover:underline ${when === "ended" ? "text-ink-muted" : "text-ink"}`}>
        {tidyName(exam.title)}
      </Link>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-muted">
        {facts.map(({ Icon, text }) => (
          <li key={text} className="flex items-center gap-1.5">
            <Icon className="size-4 text-ink-subtle" aria-hidden />
            {text}
          </li>
        ))}
      </ul>
      {exam.subject ? <p className="text-sm text-ink-muted">{t("category.cardSubject", { name: exam.subject.name })}</p> : null}
      {topics.length ? (
        <div className="rounded-card bg-canvas p-3 text-sm text-ink-muted">
          <p className="font-bold text-ink">{t("category.cardSyllabus")}</p>
          <ol className="mt-1 flex flex-col gap-0.5">{topics.slice(0, COLLAPSED_LINES).map(line)}</ol>
          {topics.length > COLLAPSED_LINES ? (
            <details className="group">
              <summary className="mt-1 cursor-pointer list-none font-bold text-brand-700 hover:underline group-open:hidden">{t("category.cardMore")}</summary>
              <ol className="flex flex-col gap-0.5">{topics.slice(COLLAPSED_LINES).map((text, index) => line(text, index + COLLAPSED_LINES))}</ol>
            </details>
          ) : null}
        </div>
      ) : null}
      {materials > 0 ? (
        <Link href={materialsHref(lang, { exam: exam.slug })} className="inline-flex min-h-9 w-fit items-center gap-1.5 rounded-full bg-accent-50 px-3 text-sm font-semibold text-warning-700 hover:underline">
          <BookOpen className="size-4" aria-hidden />
          {t("routine.materials", { n: digits(materials, lang) })}
        </Link>
      ) : null}
      {live ? (
        <Link href={href} className={`${button} bg-brand-600 text-white hover:bg-brand-700`}>
          {t("category.startLive")}
        </Link>
      ) : when === "upcoming" && exam.start_at ? (
        <span aria-disabled="true" className={`${button} cursor-not-allowed bg-line text-ink-muted`}>
          {t("category.startsOn", { date: dateTime(exam.start_at, lang) })}
        </span>
      ) : (
        <Link href={href} className={`${button} border border-line-strong text-brand-700 hover:border-brand-600 hover:bg-brand-50`}>
          {t(when === "open" ? "category.takeExam" : "category.viewDetails")}
        </Link>
      )}
    </article>
  );
}
