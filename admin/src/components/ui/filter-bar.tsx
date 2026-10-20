"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useI18n } from "@/lib/i18n/provider";
import { SEARCH_MAX_LENGTH } from "@/lib/list-params";
import { cn } from "@/lib/utils";

import { Button } from "./button";
import { Modal } from "./modal";

export const SEARCH_DEBOUNCE_MS = 350;

/** Search box that reports changes after the admin pauses typing (one request per pause,
 * not per key). Enter applies at once; external changes (e.g. "Clear filters") flow back. */
export function SearchInput({
  id,
  value,
  onChange,
  label,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(value);
  const latest = useRef(onChange);
  // The last value this box reported. A different incoming `value` is an outside change
  // (Clear filters, Back button) and replaces the text; our own value coming back after
  // navigation must not overwrite what the admin has typed since.
  const sent = useRef(value);

  useEffect(() => {
    latest.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (value !== sent.current) {
      sent.current = value;
      setText(value);
    }
  }, [value]);

  function send(next: string) {
    if (next === sent.current) return;
    sent.current = next;
    latest.current(next);
  }

  useEffect(() => {
    const timer = setTimeout(() => send(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <div className="relative min-w-0 flex-1">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
      <input
        id={id}
        type="search"
        value={text}
        maxLength={SEARCH_MAX_LENGTH}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            send(text.trim());
          }
        }}
        className="h-9 w-full rounded-control border border-line-strong bg-surface pr-9 pl-9 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus-visible:border-brand-600 focus-visible:ring-2 focus-visible:ring-brand-600/25 [&::-webkit-search-cancel-button]:hidden"
      />
      {text && (
        <button
          type="button"
          onClick={() => {
            setText("");
            send("");
          }}
          className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-control text-ink-subtle hover:bg-neutral-50 hover:text-ink"
          aria-label={t("list.clearSearch")}
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Compact labelled select for a filter. */
export function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
  disabled,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={id} className="text-xs font-medium text-ink-muted">
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "h-9 w-full min-w-0 rounded-control border bg-surface pr-8 pl-3 text-sm text-ink focus:outline-none focus-visible:border-brand-600 focus-visible:ring-2 focus-visible:ring-brand-600/25 disabled:opacity-60",
          value ? "border-brand-600/60" : "border-line-strong",
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Search + filters for a list. From `md` up the filters sit in a row; on phones they move
 * into a sheet behind a "Filters (n)" button so the list stays visible. `filters` is called
 * with an id prefix, because both layouts are rendered (ids must stay unique). */
export function FilterBar({
  search,
  filters,
  activeCount,
  onClear,
}: {
  search: ReactNode;
  filters?: (idPrefix: string) => ReactNode;
  activeCount: number;
  onClear: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-line px-4 py-3">
      <div className="flex items-center gap-2">
        {search}
        {filters && (
          <Button
            variant="secondary"
            className="md:hidden"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
          >
            <SlidersHorizontal aria-hidden />
            {activeCount ? t("list.filtersActive", { n: activeCount }) : t("list.filters")}
          </Button>
        )}
      </div>
      {filters && (
        <div className="mt-3 hidden flex-wrap items-end gap-3 md:flex">
          {filters("filter")}
          {activeCount > 0 && (
            <Button variant="ghost" size="sm" className="mb-0.5" onClick={onClear}>
              <X aria-hidden />
              {t("list.clearFilters")}
            </Button>
          )}
        </div>
      )}
      {filters && (
        <Modal
          open={open}
          onOpenChange={setOpen}
          title={t("list.filters")}
          size="sm"
          footer={
            <>
              {activeCount > 0 && (
                <Button variant="secondary" onClick={onClear}>
                  {t("list.clearFilters")}
                </Button>
              )}
              <Button onClick={() => setOpen(false)}>{t("list.showResults")}</Button>
            </>
          }
        >
          <div className="flex flex-col gap-4 [&>*]:w-full">{filters("sheet-filter")}</div>
        </Modal>
      )}
    </div>
  );
}
