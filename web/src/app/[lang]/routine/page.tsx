import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyNote, PageIntro, UnavailableNote } from "@/components/cards";
import { RoutineSchedule } from "@/components/routine-schedule";
import { publicGet } from "@/lib/api";
import { isLang, translator, type Lang } from "@/lib/i18n";
import type { RoutineResponse } from "@/lib/routine";
import { alternates } from "@/lib/site";

// Rendered per request: the `?category=` filter is read from the address (a cached page would
// ignore it). The routine itself still comes from the API cache (`publicGet`, 60 s).
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = translator(lang);
  return { title: t("meta.routineTitle"), description: t("meta.routineDescription"), alternates: alternates(lang, "/routine") };
}

/** The exam routine: every scheduled exam that has not ended, by day, with the routine PDF
 * when the admin has published one. The PDF is served by the API on this same address. */
export default async function RoutinePage({ params, searchParams }: Props) {
  const lang = (await params).lang;
  if (!isLang(lang)) notFound();
  const t = translator(lang as Lang);
  const routine = await publicGet<RoutineResponse>("routine/", lang as Lang);
  // `?category=slug` (from a category page): that category's exams only, with chips to switch.
  const asked = (await searchParams).category;
  const wanted = typeof asked === "string" && asked.length <= 140 && SLUG.test(asked) ? asked : "";
  const all = routine?.exams ?? [];
  const categories = [...new Map(all.map((exam) => [exam.category.slug, exam.category.name]))];
  const selected = categories.some(([slug]) => slug === wanted) ? wanted : "";
  const exams = selected ? all.filter((exam) => exam.category.slug === selected) : all;
  const chip = (active: boolean) =>
    `inline-flex min-h-9 items-center rounded-full border px-4 text-sm font-semibold ${active ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong bg-surface text-ink hover:border-brand-600"}`;
  return (
    <>
      <PageIntro title={t("routine.title")} body={t("routine.body")}>
        {routine?.pdf.available ? (
          <a
            href="/api/v1/public/routine/pdf/"
            target="_blank"
            rel="noopener"
            className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-control bg-brand-600 px-5 font-semibold text-white shadow-sm hover:bg-brand-700"
          >
            <Download className="size-5" aria-hidden />
            {t("routine.download")}
          </a>
        ) : null}
      </PageIntro>
      <div className="mx-auto max-w-4xl px-4 pb-16 sm:px-6">
        {routine === null ? (
          <UnavailableNote text={t("routine.unavailable")} />
        ) : routine.exams.length === 0 ? (
          <EmptyNote text={t("routine.empty")} />
        ) : (
          <>
            {categories.length > 1 ? (
              <nav aria-label={t("routine.filter")} className="mb-6 flex flex-wrap gap-2">
                <Link href={`/${lang}/routine`} aria-current={selected ? undefined : "page"} className={chip(!selected)}>
                  {t("routine.all")}
                </Link>
                {categories.map(([slug, name]) => (
                  <Link key={slug} href={`/${lang}/routine?category=${slug}`} aria-current={selected === slug ? "page" : undefined} className={chip(selected === slug)}>
                    {name}
                  </Link>
                ))}
              </nav>
            ) : null}
            <RoutineSchedule exams={exams} lang={lang as Lang} t={t} now={Date.now()} />
          </>
        )}
      </div>
    </>
  );
}
