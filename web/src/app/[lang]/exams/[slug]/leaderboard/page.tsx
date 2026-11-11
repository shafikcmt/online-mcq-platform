import { ChevronLeft, Medal, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyNote, PageIntro, UnavailableNote } from "@/components/cards";
import { SampleBlock } from "@/components/sample-block";
import { publicFetch, type Exam, type LeaderboardRow } from "@/lib/api";
import type { SampleList } from "@/lib/sample";
import { clock, decimal, digits } from "@/lib/format";
import { isLang, translator, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { alternates } from "@/lib/site";

export const revalidate = 60;

type Props = { params: Promise<{ lang: string; slug: string }> };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function load(slug: string, lang: Lang) {
  if (slug.length > 140 || !SLUG.test(slug)) return { exam: { state: "missing" as const }, rows: { state: "missing" as const }, sample: { state: "missing" as const } };
  const [exam, rows, sample] = await Promise.all([
    publicFetch<Exam>(`exams/${slug}/`, lang),
    publicFetch<LeaderboardRow[]>(`exams/${slug}/leaderboard/`, lang),
    publicFetch<SampleList>(`exams/${slug}/sample-participants/`, lang),
  ]);
  return { exam, rows, sample };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!isLang(lang)) return {};
  const t = translator(lang);
  const { exam, rows } = await load(slug, lang);
  if (exam.state !== "ok") return { title: t("meta.leaderboardTitle"), robots: { index: false } };
  return {
    title: t("meta.meritTitle", { title: exam.data.title }),
    description: t("meta.meritDescription", { title: exam.data.title }),
    alternates: alternates(lang, `/exams/${exam.data.slug}/leaderboard`),
    // Only a published merit list is worth indexing.
    robots: rows.state === "ok" ? undefined : { index: false },
  };
}

const MEDALS = ["text-accent-500", "text-ink-subtle", "text-warning-700"]; // gold, silver, bronze

/** An exam's public merit list: the top students (the platform's limit, 100 by default)
 * with names shortened by the privacy setting — never a phone number or an email. */
export default async function MeritPage({ params }: Props) {
  const { lang: raw, slug } = await params;
  const lang = raw as Lang;
  const t = translator(lang);
  const { exam, rows, sample } = await load(slug, lang);
  if (exam.state === "missing") notFound();

  const back = (
    <Link href={`/${lang}/leaderboard`} className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
      <ChevronLeft className="size-4" aria-hidden />
      {t("merit.all")}
    </Link>
  );
  if (exam.state === "unavailable") {
    return (
      <>
        <PageIntro title={t("merit.title")}>{back}</PageIntro>
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <UnavailableNote text={t("merit.unavailable")} />
        </div>
      </>
    );
  }

  const list = rows.state === "ok" ? rows.data : null;
  return (
    <>
      <PageIntro title={exam.data.title} body={t("merit.title")}>
        {back}
      </PageIntro>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-4xl">
        <p className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
          <Link href={`/${lang}/exams/${exam.data.slug}`} className="font-semibold text-brand-700 hover:underline">
            {[exam.data.category.name, exam.data.subject?.name].filter(Boolean).join(" · ")}
          </Link>
          {list?.length ? <span>{t("merit.top", { n: digits(list.length, lang) })}</span> : null}
        </p>

        {rows.state === "unavailable" ? (
          <UnavailableNote text={t("merit.unavailable")} />
        ) : !list || list.length === 0 ? (
          <EmptyNote text={t("merit.notPublic")} />
        ) : (
          <>
            <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-sm">
              <table className="w-full text-sm">
                <caption className="sr-only">{t("meta.meritTitle", { title: exam.data.title })}</caption>
                <thead className="bg-neutral-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  <tr>
                    <th scope="col" className="px-4 py-3">{t("merit.position")}</th>
                    <th scope="col" className="px-4 py-3">{t("merit.name")}</th>
                    <th scope="col" className="px-4 py-3 text-right">{t("merit.marks")}</th>
                    {/* Phones: position, name and marks; percent and time from small tablets on. */}
                    <th scope="col" className="hidden px-4 py-3 text-right sm:table-cell">{t("merit.percent")}</th>
                    <th scope="col" className="hidden px-4 py-3 text-right sm:table-cell">{t("merit.time")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {list.map((row) => (
                    <tr key={row.position} className={cn(row.position <= 3 && "bg-brand-50/40")}>
                      <td className="px-4 py-3 font-semibold text-ink">
                        <span className="inline-flex items-center gap-1.5">
                          {row.position <= 3 ? <Medal className={cn("size-4", MEDALS[row.position - 1])} aria-hidden /> : null}
                          {digits(row.position, lang)}
                        </span>
                      </td>
                      <th scope="row" className="px-4 py-3 text-left font-medium text-ink">{row.name}</th>
                      <td className="px-4 py-3 text-right tabular-nums text-ink">
                        {decimal(row.obtained_marks, lang)} / {decimal(row.total_marks, lang)}
                      </td>
                      <td className="hidden px-4 py-3 text-right tabular-nums text-ink sm:table-cell">{digits(`${decimal(row.percentage, "en")}%`, lang)}</td>
                      <td className="hidden px-4 py-3 text-right tabular-nums text-ink-muted sm:table-cell">{clock(row.time_used_seconds, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 flex items-center gap-2 text-sm text-ink-muted">
              <ShieldCheck className="size-4 text-success-700" aria-hidden />
              {t("merit.privacy")}
            </p>
          </>
        )}
        {sample.state === "ok" ? <SampleBlock data={sample.data} lang={lang} t={t} /> : null}
        </div>
      </div>
    </>
  );
}
