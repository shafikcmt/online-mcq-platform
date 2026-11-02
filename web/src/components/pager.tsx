import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { digits } from "@/lib/format";
import type { Lang, T } from "@/lib/i18n";

/** Previous / "Page 2 of 5" / Next, as plain links (the page number is in the address). */
export function Pager({ lang, t, page, pages, href }: { lang: Lang; t: T; page: number; pages: number; href: (page: number) => string }) {
  if (pages <= 1) return null;
  const link = "inline-flex min-h-11 items-center gap-1 rounded-control border border-line bg-surface px-4 text-sm font-semibold text-ink hover:border-brand-600";
  const current = Math.min(page, pages);
  return (
    <nav aria-label={t("pages.label")} className="mt-8 flex items-center justify-between gap-3">
      {current > 1 ? (
        <Link href={href(current - 1)} rel="prev" className={link}>
          <ChevronLeft className="size-4" aria-hidden />
          {t("pages.prev")}
        </Link>
      ) : (
        <span />
      )}
      <p className="text-sm text-ink-muted">{t("pages.of", { page: digits(current, lang), pages: digits(pages, lang) })}</p>
      {current < pages ? (
        <Link href={href(current + 1)} rel="next" className={link}>
          {t("pages.next")}
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

/** `?page=` from the address: a whole number from 1 to 1000, else 1. */
export function pageParam(raw: string | string[] | undefined): number {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(value) && value >= 1 && value <= 1000 ? value : 1;
}
