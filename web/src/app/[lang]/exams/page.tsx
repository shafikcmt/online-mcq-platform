import { SlidersHorizontal } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyNote, ExamCard, PageIntro, UnavailableNote } from "@/components/cards";
import { Pager } from "@/components/pager";
import { publicFetch, publicGet, type Category, type Exam, type Page } from "@/lib/api";
import { cn } from "@/lib/cn";
import { ACCESSES, apiPath, PAGE_SIZE, pageHref, parseFilters, TYPES, WHENS, type ExamFilters } from "@/lib/exam-filters";
import { digits } from "@/lib/format";
import { isLang, translator, type Lang, type T } from "@/lib/i18n";
import { alternates } from "@/lib/site";

type Props = { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = translator(lang);
  const filters = parseFilters(await searchParams);
  // Filtered views are useful to share but are not separate pages for search engines:
  // the canonical address is the plain list.
  const filtered = filters.when !== "open" || filters.type || filters.access || filters.category || filters.page > 1;
  return {
    title: t("meta.examsTitle"),
    description: t("meta.examsDescription"),
    alternates: alternates(lang, "/exams"),
    robots: filtered ? { index: false, follow: true } : undefined,
  };
}

/** Exams: Open now / Upcoming / Ended tabs, filters (category, type, free/paid) and pages
 * — all in the address, rendered on the server, working without JavaScript. */
export default async function ExamsPage({ params, searchParams }: Props) {
  const lang = (await params).lang as Lang;
  const t = translator(lang);
  const filters = parseFilters(await searchParams);
  const [fetched, categories] = await Promise.all([
    publicFetch<Page<Exam>>(apiPath(filters), lang),
    publicGet<Page<Category>>("categories/?page_size=100", lang),
  ]);
  // A page past the end (an old link) is a 404 from the API: show it as an empty list.
  const page = fetched.state === "ok" ? fetched.data : fetched.state === "missing" ? { count: 0, next: null, previous: null, results: [] } : null;
  const pages = page ? Math.max(1, Math.ceil(page.count / PAGE_SIZE)) : 1;
  const filtered = Boolean(filters.type || filters.access || filters.category);

  return (
    <>
      <PageIntro title={t("exams.title")} body={t("exams.body")} />
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <nav aria-label={t("exams.tabs.label")} className="flex gap-1 overflow-x-auto border-b border-line">
          {WHENS.map((when) => (
            <Link
              key={when}
              href={pageHref(lang, { ...filters, when, page: 1 })}
              aria-current={when === filters.when ? "page" : undefined}
              className={cn(
                "-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold",
                when === filters.when ? "border-brand-600 text-brand-700" : "border-transparent text-ink-muted hover:text-ink",
              )}
            >
              {t(`exams.tabs.${when}`)}
            </Link>
          ))}
        </nav>

        <Filters lang={lang} t={t} filters={filters} categories={categories?.results ?? []} />

        <section aria-label={t(`exams.tabs.${filters.when}`)} className="mt-6">
          {page === null ? (
            <UnavailableNote text={t("exams.unavailable")} />
          ) : page.results.length === 0 ? (
            <EmptyNote text={filtered ? t("exams.filteredEmpty") : t(`exams.empty.${filters.when}`)} />
          ) : (
            <>
              <p className="mb-4 text-sm text-ink-muted">{t("exams.count", { n: digits(page.count, lang) })}</p>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {page.results.map((exam) => (
                  <li key={exam.slug}>
                    <ExamCard exam={exam} lang={lang} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {page ? <Pager lang={lang} t={t} page={filters.page} pages={pages} href={(n) => pageHref(lang, { ...filters, page: n })} /> : null}
      </div>
    </>
  );
}

function Filters({ lang, t, filters, categories }: { lang: Lang; t: T; filters: ExamFilters; categories: Category[] }) {
  const select = "mt-1 block w-full min-h-11 rounded-control border border-line-strong bg-surface px-3 text-sm text-ink";
  return (
    <form action={`/${lang}/exams`} aria-label={t("exams.filters.label")} className="mt-6 grid gap-3 rounded-card border border-line bg-surface p-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
      {filters.when !== "open" ? <input type="hidden" name="when" value={filters.when} /> : null}
      <label className="text-sm font-medium text-ink">
        {t("exams.filters.category")}
        <select name="category" defaultValue={filters.category ?? ""} className={select}>
          <option value="">{t("exams.filters.all")}</option>
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium text-ink">
        {t("exams.filters.type")}
        <select name="type" defaultValue={filters.type ?? ""} className={select}>
          <option value="">{t("exams.filters.all")}</option>
          {TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`exam.type.${type}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium text-ink">
        {t("exams.filters.access")}
        <select name="access" defaultValue={filters.access ?? ""} className={select}>
          <option value="">{t("exams.filters.all")}</option>
          {ACCESSES.map((access) => (
            <option key={access} value={access}>
              {t(`exam.access.${access}`)}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-2">
        <button type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-control bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
          <SlidersHorizontal className="size-4" aria-hidden />
          {t("exams.filters.apply")}
        </button>
        {filters.type || filters.access || filters.category ? (
          <Link href={pageHref(lang, { when: filters.when })} className="inline-flex min-h-11 items-center rounded-control px-3 text-sm font-semibold text-brand-700 hover:bg-brand-50">
            {t("exams.filters.reset")}
          </Link>
        ) : null}
      </div>
    </form>
  );
}
