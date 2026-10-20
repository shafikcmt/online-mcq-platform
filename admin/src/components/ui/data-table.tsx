"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from "react";

import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** API ordering field; makes the header a sort button. */
  sortField?: string;
  /** Direction of the first click (dates and counts read best newest/largest first). */
  sortFirst?: "asc" | "desc";
  className?: string;
  /** Phone card layout: hide this column there (the card title already shows it). */
  hideOnMobile?: boolean;
};

/** Next ordering after clicking a sortable header. */
export function nextOrdering(current: string, field: string, first: "asc" | "desc" = "asc"): string {
  if (current === field) return `-${field}`;
  if (current === `-${field}`) return field;
  return first === "desc" ? `-${field}` : field;
}

function sortState(current: string, field?: string): "ascending" | "descending" | undefined {
  if (!field) return undefined;
  if (current === field) return "ascending";
  if (current === `-${field}`) return "descending";
  return undefined;
}

/** Responsive data list: a real <table> (caption, column headers, aria-sort) from the
 * `md` breakpoint, and a card list on phones, so nothing scrolls sideways at 390px. The
 * hidden layout is display:none, so assistive tech only meets one of them. Rows are the
 * server's page as-is: no client-side filtering or sorting. */
export function DataTable<T>({
  caption,
  rows,
  rowKey,
  columns,
  ordering,
  onSort,
  actions,
  mobileTitle,
  busy = false,
}: {
  caption: string;
  rows: T[];
  rowKey: (row: T) => string | number;
  columns: Column<T>[];
  ordering?: string;
  onSort?: (ordering: string) => void;
  actions?: (row: T) => ReactNode;
  /** Card heading on phones (usually the name / text cell). */
  mobileTitle: (row: T) => ReactNode;
  busy?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div aria-busy={busy || undefined} className={cn("transition-opacity", busy && "opacity-60")}>
      {busy && <p className="sr-only" role="status">{t("list.updating")}</p>}
      {/* `relative`: keeps absolutely positioned sr-only text inside the scroll box */}
      <div className="relative hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line bg-neutral-50/70">
              {columns.map((column) => {
                const sort = sortState(ordering ?? "", column.sortField);
                const Icon = sort === "ascending" ? ArrowUp : sort === "descending" ? ArrowDown : ArrowUpDown;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={column.sortField ? (sort ?? "none") : undefined}
                    className={cn("px-4 py-2.5 text-xs font-semibold text-ink-muted", column.className)}
                  >
                    {column.sortField && onSort ? (
                      <button
                        type="button"
                        onClick={() => onSort(nextOrdering(ordering ?? "", column.sortField!, column.sortFirst))}
                        className="-mx-1.5 inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 hover:bg-neutral-50 hover:text-ink"
                      >
                        {column.header}
                        <Icon className={cn("size-3.5", sort ? "text-brand-600" : "text-ink-subtle")} aria-hidden />
                        {sort && (
                          <span className="sr-only">
                            , {t(sort === "ascending" ? "list.sortAscending" : "list.sortDescending")}
                          </span>
                        )}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
              {actions && (
                <th scope="col" className="px-2 py-2.5 text-right text-xs font-semibold text-ink-muted">
                  <span className="sr-only">{t("common.actions")}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} data-row-key={rowKey(row)} className="border-b border-line last:border-b-0 hover:bg-neutral-50/60">
                {columns.map((column) => (
                  <td key={column.key} className={cn("px-4 py-3 align-top text-ink", column.className)}>
                    {column.cell(row)}
                  </td>
                ))}
                {actions && <td className="px-2 py-2 text-right align-top whitespace-nowrap">{actions(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-line md:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li key={rowKey(row)} data-row-key={rowKey(row)} className="px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 text-sm font-medium text-ink">{mobileTitle(row)}</div>
              {actions && <div className="-mt-1 -mr-2 flex shrink-0">{actions(row)}</div>}
            </div>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
              {columns
                .filter((column) => !column.hideOnMobile)
                .map((column) => (
                  <div key={column.key} className="contents">
                    <dt className="text-ink-subtle">{column.header}</dt>
                    <dd className="min-w-0 text-ink">{column.cell(row)}</dd>
                  </div>
                ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Focus after a row is deleted: the deleted row's buttons are gone once the server's new
 * page renders, so move to the same action on the next row, else the previous row, else
 * `fallback` (e.g. the "New …" button), else the main region — never <body>.
 * Call `rememberDeleted(row)` after the server confirmed the delete, before refreshing. */
export function useDeleteFocus<T>(
  rows: T[],
  rowKey: (row: T) => string | number,
  fallback: RefObject<HTMLElement | null>,
) {
  const pending = useRef<(string | number)[] | null>(null);

  const rememberDeleted = useCallback(
    (row: T) => {
      const keys = rows.map(rowKey);
      const index = keys.indexOf(rowKey(row));
      pending.current = [keys[index + 1], keys[index - 1]].filter((key) => key !== undefined);
    },
    [rows, rowKey],
  );

  useEffect(() => {
    const candidates = pending.current;
    if (!candidates) return;
    pending.current = null;
    for (const key of candidates) {
      const target = rowAction(key, "delete");
      if (target) return void target.focus();
    }
    const create = fallback.current;
    (create && !create.matches(":disabled") ? create : document.getElementById("main"))?.focus();
  }, [rows, fallback]);

  return rememberDeleted;
}

/** The row's action button in whichever layout is shown (table or phone cards). */
function rowAction(key: string | number, action: string): HTMLElement | null {
  const rows = Array.from(document.querySelectorAll<HTMLElement>(`[data-row-key="${String(key).replace(/["\\]/g, "")}"]`));
  const shown = rows.find((row) => row.getClientRects().length > 0) ?? rows[0];
  return shown?.querySelector<HTMLElement>(`[data-row-action="${action}"]`) ?? shown?.querySelector("button") ?? null;
}
