"use client";

import { useEffect, useRef, useState } from "react";

import { ListRowsLoading } from "@/components/content/list-skeleton";
import { PackageStatusBadge, packageName } from "@/components/packages/package-cells";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/filter-bar";
import { Modal } from "@/components/ui/modal";
import { apiFetch } from "@/lib/api/client";
import { describeError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import type { Paginated } from "@/types/content";
import type { Package } from "@/types/packages";

/** How many packages one search shows. The panel never downloads the package catalogue:
 * each search is one small server query (latest wins; older requests are aborted). */
export const PACKAGE_PICKER_SIZE = 10;

type Load = { status: "loading" | "idle" | "error"; rows: Package[] | null; error?: string };

export function PackagePicker({
  open,
  onOpenChange,
  onSelect,
  selectText,
  selectLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (pkg: Package) => void;
  /** Button text and accessible name for the screen using the picker (default: the
   * subscriptions wording). */
  selectText?: string;
  selectLabel?: (name: string) => string;
}) {
  const { locale, t } = useI18n();
  const [search, setSearch] = useState("");
  const [load, setLoad] = useState<Load>({ status: "idle", rows: null });
  const [retry, setRetry] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (!open) return;
    const request = ++latest.current;
    const controller = new AbortController();
    const query = new URLSearchParams({ page_size: String(PACKAGE_PICKER_SIZE), ordering: "sort_order" });
    if (search) query.set("search", search);
    setLoad((current) => ({ status: "loading", rows: current.rows }));
    apiFetch<Paginated<Package>>(`/admin/packages/?${query.toString()}`, { signal: controller.signal })
      .then((page) => {
        if (request === latest.current) setLoad({ status: "idle", rows: page.results });
      })
      .catch((error) => {
        if (request !== latest.current || controller.signal.aborted) return;
        setLoad((current) => ({ status: "error", rows: current.rows, error: describeError(error, t) }));
      });
    return () => controller.abort();
  }, [open, search, retry, t]);

  const busy = load.status === "loading";

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("packagePicker.title")} description={t("packagePicker.description")} size="md">
      <div className="space-y-4">
        <SearchInput id="package-picker-search" label={t("packagePicker.search")} placeholder={t("packagePicker.search")} value={search} onChange={setSearch} />
        {load.status === "error" && (
          <Alert tone="danger" live>
            <span className="flex flex-wrap items-center gap-3">
              {load.error}
              <Button variant="secondary" size="sm" onClick={() => setRetry((value) => value + 1)}>
                {t("common.retry")}
              </Button>
            </span>
          </Alert>
        )}
        <div className="rounded-card border border-line" aria-busy={busy || undefined}>
          {busy && (
            <p className="sr-only" role="status">
              {t("packagePicker.loading")}
            </p>
          )}
          {load.rows === null ? (
            load.status === "error" ? null : <ListRowsLoading label={t("packagePicker.loading")} rows={3} />
          ) : load.rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-muted">{t("packagePicker.noResults")}</p>
          ) : (
            <ul className={busy ? "divide-y divide-line opacity-60" : "divide-y divide-line"}>
              {load.rows.map((pkg) => {
                const title = packageName(pkg, locale);
                const name = title.text || pkg.slug;
                return (
                  <li key={pkg.id} className="flex items-center gap-3 px-3 py-3 sm:px-4">
                    <div className="min-w-0 flex-1">
                      <p lang={title.lang} className="text-sm font-medium break-words text-ink">
                        {name}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
                        <span className="break-all">{pkg.slug}</span>
                        <PackageStatusBadge status={pkg.status} />
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="shrink-0"
                      aria-label={selectLabel ? selectLabel(name) : t("packagePicker.selectLabel", { name })}
                      onClick={() => onSelect(pkg)}
                    >
                      {selectText ?? t("packagePicker.select")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
