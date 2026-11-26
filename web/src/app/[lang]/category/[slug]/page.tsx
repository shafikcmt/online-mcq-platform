import { Archive, CalendarDays, ChevronLeft, PlayCircle, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyNote, PageIntro, UnavailableNote } from "@/components/cards";
import { ExamRows } from "@/components/exam-rows";
import { GroupRows } from "@/components/group-rows";
import { publicGet, type Category, type Exam, type Group, type Page } from "@/lib/api";
import { apiPath, pageHref, type When } from "@/lib/exam-filters";
import { digits, tidyName } from "@/lib/format";
import { isLang, translator, type Lang } from "@/lib/i18n";
import { materialsHref } from "@/lib/materials";
import { alternates } from "@/lib/site";

export const revalidate = 60;

type Props = { params: Promise<{ lang: string; slug: string }> };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WHENS: When[] = ["open", "upcoming", "ended"];

async function findCategory(slug: string, lang: Lang) {
  if (slug.length > 140 || !SLUG.test(slug)) return { state: "missing" as const };
  const categories = await publicGet<Page<Category>>("categories/?page_size=100", lang);
  if (categories === null) return { state: "unavailable" as const };
  const category = categories.results.find((row) => row.slug === slug);
  return category ? { state: "ok" as const, category } : { state: "missing" as const };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!isLang(lang)) return {};
  const t = translator(lang);
  const found = await findCategory(slug, lang);
  if (found.state !== "ok") return { title: t("meta.examsTitle"), robots: { index: false } };
  return {
    title: found.category.name,
    description: found.category.description.slice(0, 200) || t("category.metaDescription", { name: found.category.name }),
    alternates: alternates(lang, `/category/${slug}`),
  };
}

/** One category: its exams as a clear list, running ones first (a red "Live" mark on a scheduled
 * exam that is running now), then upcoming, then past ones marked "Archived"; then the shortcuts a
 * student needs next: past exams, merit lists, the routine and study materials. The first page of
 * each group is shown; "See all" opens the Exams page for the rest. */
export default async function CategoryPage({ params }: Props) {
  const { lang: raw, slug } = await params;
  if (!isLang(raw)) notFound();
  const lang = raw as Lang;
  const t = translator(lang);
  const found = await findCategory(slug, lang);
  if (found.state === "missing") notFound();

  const back = (
    <Link href={`/${lang}#categories`} className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
      <ChevronLeft className="size-4" aria-hidden />
      {t("category.back")}
    </Link>
  );
  if (found.state === "unavailable") {
    return (
      <>
        <PageIntro title={t("exams.title")}>{back}</PageIntro>
        <div className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
          <UnavailableNote text={t("category.unavailable")} />
        </div>
      </>
    );
  }

  const { category } = found;
  // The groups of the category come first; the exams that sit in no group list under them. An older server
  // without groups answers nothing: the category then lists every exam as before.
  const groupPage = await publicGet<Page<Group>>(`groups/?category=${slug}&page_size=50`, lang);
  const groups = (groupPage?.results ?? []).filter((group) => group.exam_count > 0);
  const shelf = { ungrouped: groups.length > 0 };
  const pages = await Promise.all(WHENS.map((when) => publicGet<Page<Exam>>(apiPath({ when, category: slug, page: 1 }, shelf), lang)));
  const rows = WHENS.flatMap((when, index) => (pages[index]?.results ?? []).map((exam) => ({ exam, when })));
  const total = pages.reduce((sum, page) => sum + (page?.count ?? 0), 0) + groups.reduce((sum, group) => sum + group.exam_count, 0);
  const shortcuts = [
    { label: t("category.archive"), href: pageHref(lang, { when: "ended", category: slug }), Icon: Archive },
    { label: t("category.merit"), href: `/${lang}/leaderboard`, Icon: Trophy },
    { label: t("category.routine"), href: `/${lang}/routine?category=${slug}`, Icon: CalendarDays },
    { label: t("category.materials"), href: materialsHref(lang, { category: slug }), Icon: PlayCircle },
  ];

  return (
    <>
      <PageIntro title={tidyName(category.name)} body={category.description || t("category.count", { n: digits(total, lang) })}>
        {back}
      </PageIntro>
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 pb-16 sm:px-6">
        {pages.every((page) => page === null) ? (
          <UnavailableNote text={t("category.unavailable")} />
        ) : rows.length === 0 && groups.length === 0 ? (
          <EmptyNote text={t("category.empty")} />
        ) : (
          <>
            {groups.length ? <GroupRows groups={groups} lang={lang} t={t} /> : null}
            {groups.length && rows.length ? <h2 className="-mb-4 text-lg font-bold text-ink">{t("category.examsHeading")}</h2> : null}
            {rows.length ? <ExamRows rows={rows} lang={lang} t={t} /> : null}
          </>
        )}
        {total > rows.length && groups.length === 0 ? (
          <Link href={pageHref(lang, { category: slug })} className="self-start font-semibold text-brand-700 hover:underline">
            {t("category.seeAll")}
          </Link>
        ) : null}
        <nav aria-label={t("category.shortcuts")}>
          <ul className="grid grid-cols-4 gap-2">
            {shortcuts.map(({ label, href, Icon }) => (
              <li key={label}>
                <Link href={href} className="group flex flex-col items-center gap-1.5 text-center text-xs font-medium text-ink-muted sm:text-sm">
                  <span className="flex size-12 items-center justify-center rounded-full border border-line-strong bg-surface text-brand-700 transition group-hover:border-brand-600 group-hover:bg-brand-50">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </>
  );
}
