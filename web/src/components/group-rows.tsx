import { ChevronRight, FolderOpen } from "lucide-react";
import Link from "next/link";

import type { Group } from "@/lib/api";
import { digits, tidyName } from "@/lib/format";
import type { Lang, T } from "@/lib/i18n";

/** The groups of a category (or the sub-groups of a group) as full-width rows: an icon, the name, a
 * quiet line with the exam count (and sub-groups), and a red dot with "Live" when a scheduled exam in
 * it is running now. Each opens the group's own page. */
export function GroupRows({ groups, lang, t }: { groups: Group[]; lang: Lang; t: T }) {
  return (
    <ul className="flex flex-col gap-3">
      {groups.map((group) => {
        const live = group.live_count > 0;
        return (
          <li key={group.slug}>
            <Link
              href={`/${lang}/group/${group.slug}`}
              className="flex min-h-16 items-center gap-3 rounded-[1rem] border border-line-strong bg-surface px-4 py-3 shadow-sm transition hover:border-brand-600 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-600"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-card bg-brand-50 text-brand-700">
                <FolderOpen className="size-6" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold break-words text-ink">{tidyName(group.name)}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                  {[t("category.groupExams", { n: digits(group.exam_count, lang) }), group.child_count > 0 ? t("category.subGroups", { n: digits(group.child_count, lang) }) : null].filter(Boolean).join(" · ")}
                  {live ? (
                    <span className="flex items-center gap-1 font-bold text-danger-700">
                      <span className="size-1.5 rounded-full bg-danger-700" aria-hidden />
                      {t("category.live")}
                    </span>
                  ) : null}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-ink-subtle" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
