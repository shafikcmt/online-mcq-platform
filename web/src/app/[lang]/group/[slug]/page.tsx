import { Archive, CalendarDays, ChevronLeft, PlayCircle, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyNote, PageIntro, UnavailableNote } from "@/components/cards";
import { ExamCards } from "@/components/exam-card";
import { GroupRows } from "@/components/group-rows";
import { publicGet, type Exam, type GroupDetail, type Page } from "@/lib/api";
import { apiPath, pageHref, type When } from "@/lib/exam-filters";
import { digits, tidyName } from "@/lib/format";
import { isLang, translator, type Lang } from "@/lib/i18n";
import { materialsHref } from "@/lib/materials";
import { alternates } from "@/lib/site";

export const revalidate = 60;

type Props = { params: Promise<{ lang: string; slug: string }> };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WHENS: When[] = ["open", "upcoming", "ended"];

async function findGroup(slug: string, lang: Lang) {
  if (slug.length > 140 || !SLUG.test(slug)) return { state: "missing" as const };
  const group = await publicGet<GroupDetail>(`groups/${slug}/`, lang);
  return group ? { state: "ok" as const, group } : { state: "missing" as const };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!isLang(lang)) return {};
  const t = translator(lang);
  const found = await findGroup(slug, lang);
  if (found.state !== "ok") return { title: t("meta.examsTitle"), robots: { index: false } };
  const name = tidyName(found.group.name);
  return {
    title: name,
    description: found.group.description.slice(0, 200) || t("category.groupMeta", { name }),
    alternates: alternates(lang, `/group/${slug}`),
  };
}

/** One group of a category: its sub-groups as rows, then the exams sitting directly in it (running first,
 * then upcoming, then past ones marked "Archived"), then the shortcuts a student needs next. */
export default async function GroupPage({ params }: Props) {
  const { lang: raw, slug } = await params;
  if (!isLang(raw)) notFound();
  const lang = raw as Lang;
  const t = translator(lang);
  const found = await findGroup(slug, lang);
  if (found.state === "missing") notFound();

  const { group } = found;
  const children = group.children.filter((child) => child.exam_count > 0);
  const pages = await Promise.all(WHENS.map((when) => publicGet<Page<Exam>>(apiPath({ when, page: 1 }, { group: slug }), lang)));
  const rows = WHENS.flatMap((when, index) => (pages[index]?.results ?? []).map((exam) => ({ exam, when })));
  const total = pages.reduce((sum, page) => sum + (page?.count ?? 0), 0);
  const up = group.parent ?? group.category;
  const upHref = group.parent ? `/${lang}/group/${group.parent.slug}` : `/${lang}/category/${group.category.slug}`;
  const shortcuts = [
    { label: t("category.archive"), href: pageHref(lang, { when: "ended", category: group.category.slug }), Icon: Archive },
    { label: t("category.merit"), href: `/${lang}/leaderboard`, Icon: Trophy },
    { label: t("category.routine"), href: `/${lang}/routine?category=${group.category.slug}`, Icon: CalendarDays },
    { label: t("category.materials"), href: materialsHref(lang, { category: group.category.slug }), Icon: PlayCircle },
  ];

  return (
    <>
      <PageIntro title={tidyName(group.name)} body={group.description || t("category.count", { n: digits(group.exam_count, lang) })}>
        <Link href={upHref} className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
          <ChevronLeft className="size-4" aria-hidden />
          {t("category.groupBack", { name: tidyName(up.name) })}
        </Link>
      </PageIntro>
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 pb-16 sm:px-6">
        {pages.every((page) => page === null) ? (
          <UnavailableNote text={t("category.unavailable")} />
        ) : children.length === 0 && rows.length === 0 ? (
          <EmptyNote text={t("category.groupEmpty")} />
        ) : (
          <>
            {children.length ? <GroupRows groups={children} lang={lang} t={t} /> : null}
            {children.length && rows.length ? <h2 className="-mb-4 text-lg font-bold text-ink">{t("category.examsHeading")}</h2> : null}
            {rows.length ? <ExamCards rows={rows} lang={lang} t={t} /> : null}
          </>
        )}
        {total > rows.length ? (
          <Link href={pageHref(lang, { category: group.category.slug })} className="self-start font-semibold text-brand-700 hover:underline">
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
