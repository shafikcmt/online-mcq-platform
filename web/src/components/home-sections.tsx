import { BookOpenCheck, Briefcase, Building2, FileText, GraduationCap, Landmark, PlayCircle, Stethoscope, type LucideIcon } from "lucide-react";
import Link from "next/link";

import type { Category } from "@/lib/api";
import { digits, tidyName } from "@/lib/format";
import type { Lang, T } from "@/lib/i18n";
import { materialsHref } from "@/lib/materials";

/** Neutral icons in turn (categories are admin-defined, so no icon is tied to a name). */
const CATEGORY_ICONS: LucideIcon[] = [GraduationCap, Stethoscope, BookOpenCheck, Landmark, Building2, Briefcase];

const TILE =
  "flex min-h-[4.25rem] items-center gap-3 rounded-card border border-line bg-surface p-3 text-sm font-semibold text-ink transition hover:border-brand-600 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-600";
const ICON = "flex size-10 shrink-0 items-center justify-center rounded-card bg-brand-50 text-brand-700";

/** A titled block of the home page: a brand-coloured band with the section name, then its tiles.
 * The exam section and the study section share it, so both read as one family (as in the app). */
function Panel({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="overflow-hidden rounded-[1rem] border border-brand-100 bg-surface shadow-sm">
      <h2 id={id} className="bg-brand-600 px-4 py-3 text-center text-lg font-bold text-white">
        {title}
      </h2>
      <div className="bg-brand-50 p-3 sm:p-4">{children}</div>
    </section>
  );
}

/** Every category that has exams: icon, name and a quiet line with the exam count. A category with a
 * scheduled exam running right now adds a red dot and the word "Live" on that line (never on top of
 * the name, and never colour alone). Each opens the category's own page. */
export function ExamSection({ categories, lang, t }: { categories: Category[]; lang: Lang; t: T }) {
  return (
    <Panel id="categories" title={t("home.categories.title")}>
      <ul className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
        {categories.map((category, index) => {
          const Icon = CATEGORY_ICONS[index % CATEGORY_ICONS.length];
          const live = (category.live_count ?? 0) > 0;
          return (
            <li key={category.slug}>
              <Link href={`/${lang}/category/${category.slug}`} className={TILE}>
                <span className={ICON}>
                  <Icon className="size-6" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words">{tidyName(category.name)}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs font-normal text-ink-muted">
                    {t("home.categories.exams", { n: digits(category.exam_count, lang) })}
                    {live ? (
                      <span className="flex items-center gap-1 font-bold text-danger-700">
                        <span className="size-1.5 rounded-full bg-danger-700" aria-hidden />
                        {t("home.categories.liveShort")}
                      </span>
                    ) : null}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** Video lessons and PDF notes. A part with nothing published yet says "Coming soon" and is not a
 * link; it becomes one by itself as soon as the admin publishes something. */
export function StudySection({ counts, lang, t }: { counts: { video: number; pdf: number }; lang: Lang; t: T }) {
  const tiles = [
    { kind: "video" as const, Icon: PlayCircle },
    { kind: "pdf" as const, Icon: FileText },
  ];
  return (
    <Panel id="study" title={t("home.study.title")}>
      <ul className="grid grid-cols-2 gap-2 sm:gap-3">
        {tiles.map(({ kind, Icon }) => {
          const ready = counts[kind] > 0;
          const inner = (
            <>
              <span className={`${ICON} ${ready ? "" : "!bg-line !text-ink-subtle"}`}>
                <Icon className="size-6" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block ${ready ? "" : "text-ink-muted"}`}>{t(`home.study.${kind}`)}</span>
                {ready ? null : <span className="mt-0.5 block text-xs font-semibold whitespace-nowrap text-warning-700">{t("home.study.soon")}</span>}
              </span>
            </>
          );
          return (
            <li key={kind}>
              {ready ? (
                <Link href={materialsHref(lang, { kind })} className={TILE}>
                  {inner}
                </Link>
              ) : (
                <div className="flex min-h-[4.25rem] items-center gap-3 rounded-card border border-line bg-canvas p-3 text-sm font-semibold">{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
