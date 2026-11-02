import { ArrowRight, CalendarClock, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Chip, EmptyNote, PageIntro, UnavailableNote } from "@/components/cards";
import { Pager, pageParam } from "@/components/pager";
import { publicFetch, type LeaderboardExam, type Page } from "@/lib/api";
import { date, digits } from "@/lib/format";
import { isLang, translator, type Lang } from "@/lib/i18n";
import { alternates } from "@/lib/site";

const PAGE_SIZE = 12;

type Props = { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = translator(lang);
  const page = pageParam((await searchParams).page);
  return {
    title: t("meta.leaderboardTitle"),
    description: t("meta.leaderboardDescription"),
    alternates: alternates(lang, "/leaderboard"),
    robots: page > 1 ? { index: false, follow: true } : undefined,
  };
}

/** Leaderboard: the exams whose merit list is public (merit enabled, results out, list
 * generated), most recently ended first; each opens its merit list. */
export default async function LeaderboardPage({ params, searchParams }: Props) {
  const lang = (await params).lang as Lang;
  const t = translator(lang);
  const page = pageParam((await searchParams).page);
  const fetched = await publicFetch<Page<LeaderboardExam>>(`leaderboards/?page=${page}&page_size=${PAGE_SIZE}`, lang);
  const list = fetched.state === "ok" ? fetched.data : fetched.state === "missing" ? { count: 0, next: null, previous: null, results: [] } : null;

  return (
    <>
      <PageIntro title={t("leaderboard.title")} body={t("leaderboard.body")} />
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {list === null ? (
          <UnavailableNote text={t("leaderboard.unavailable")} />
        ) : list.results.length === 0 ? (
          <EmptyNote text={t("leaderboard.empty")} />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.results.map((exam) => (
              <li key={exam.slug}>
                <article className="relative flex h-full flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-sm transition hover:border-brand-600 hover:shadow-md focus-within:ring-2 focus-within:ring-brand-600">
                  <div className="flex flex-wrap gap-1.5">
                    <Chip tone={exam.exam_type === "live" ? "danger" : "info"}>{t(`exam.type.${exam.exam_type}`)}</Chip>
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-ink">
                      <Link href={`/${lang}/exams/${exam.slug}/leaderboard`} className="outline-none after:absolute after:inset-0 after:rounded-card">
                        {exam.title}
                      </Link>
                    </h2>
                    <p className="text-sm text-ink-subtle">{[exam.category.name, exam.subject?.name].filter(Boolean).join(" · ")}</p>
                  </div>
                  <ul className="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
                    <li className="flex items-center gap-1.5">
                      <Trophy className="size-4 text-ink-subtle" aria-hidden />
                      {t("leaderboard.ranked", { n: digits(exam.ranked_count, lang) })}
                    </li>
                    {exam.end_at ? (
                      <li className="flex items-center gap-1.5">
                        <CalendarClock className="size-4 text-ink-subtle" aria-hidden />
                        <time dateTime={exam.end_at}>{date(exam.end_at, lang)}</time>
                      </li>
                    ) : null}
                  </ul>
                  <span aria-hidden className="flex items-center gap-1 text-sm font-semibold text-brand-700">
                    {t("leaderboard.view")}
                    <ArrowRight className="size-4" />
                  </span>
                </article>
              </li>
            ))}
          </ul>
        )}
        {list ? <Pager lang={lang} t={t} page={page} pages={Math.max(1, Math.ceil(list.count / PAGE_SIZE))} href={(n) => `/${lang}/leaderboard${n > 1 ? `?page=${n}` : ""}`} /> : null}
      </div>
    </>
  );
}
