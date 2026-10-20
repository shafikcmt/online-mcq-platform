"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { PAGE_SIZES } from "@/lib/list-params";
import { cn } from "@/lib/utils";

import { Button } from "./button";

/** Page numbers to show: first, last, and a window around the current page, with gaps
 * (null) between — e.g. 1 … 4 5 [6] 7 8 … 20. */
export function pageWindow(page: number, pages: number, radius = 1): (number | null)[] {
  const shown = new Set([1, pages]);
  for (let n = page - radius; n <= page + radius; n += 1) if (n >= 1 && n <= pages) shown.add(n);
  const sorted = [...shown].sort((a, b) => a - b);
  const result: (number | null)[] = [];
  sorted.forEach((n, index) => {
    if (index > 0 && n - sorted[index - 1] > 1) result.push(null);
    result.push(n);
  });
  return result;
}

/** Server pagination (`count` from the API). Page-number buttons from `sm` up; phones get
 * previous/next plus "Page x of y". */
export function Pagination({
  page,
  pageSize,
  count,
  onPage,
  onPageSize,
  disabled = false,
}: {
  page: number;
  pageSize: number;
  count: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  disabled?: boolean;
}) {
  const { locale, t } = useI18n();
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const from = count === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, count);
  const n = (value: number) => formatNumber(value, locale);

  return (
    <div className="flex flex-col gap-3 border-t border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-ink-muted">
        <p aria-live="polite">
          {count === 0 ? t("pagination.summaryEmpty") : t("pagination.summary", { from: n(from), to: n(to), total: n(count) })}
        </p>
        <label className="flex items-center gap-2">
          <span>{t("pagination.pageSize")}</span>
          <select
            value={pageSize}
            disabled={disabled}
            onChange={(event) => onPageSize(Number(event.target.value))}
            className="h-8 rounded-control border border-line-strong bg-surface px-2 text-[13px] text-ink"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>
      {pages > 1 && (
        <nav aria-label={t("pagination.label")} className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onPage(page - 1)}
            disabled={disabled || page <= 1}
            aria-label={t("pagination.previous")}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <span className="px-2 text-[13px] text-ink-muted sm:hidden">
            {t("pagination.pageOf", { page: n(page), pages: n(pages) })}
          </span>
          <ul className="hidden items-center gap-1 sm:flex">
            {pageWindow(page, pages).map((number, index) =>
              number === null ? (
                <li key={`gap-${index}`} aria-hidden className="px-1 text-ink-subtle">
                  …
                </li>
              ) : (
                <li key={number}>
                  <button
                    type="button"
                    onClick={() => onPage(number)}
                    disabled={disabled}
                    aria-current={number === page ? "page" : undefined}
                    aria-label={t("pagination.page", { n: n(number) })}
                    className={cn(
                      "h-8 min-w-8 rounded-control px-2 text-[13px] tabular-nums transition-colors disabled:opacity-60",
                      number === page
                        ? "bg-brand-600 font-semibold text-white"
                        : "text-ink-muted hover:bg-neutral-50 hover:text-ink",
                    )}
                  >
                    {n(number)}
                  </button>
                </li>
              ),
            )}
          </ul>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onPage(page + 1)}
            disabled={disabled || page >= pages}
            aria-label={t("pagination.next")}
          >
            <ChevronRight aria-hidden />
          </Button>
        </nav>
      )}
    </div>
  );
}
