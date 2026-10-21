"use client";

import { useEffect, useRef, useState } from "react";

import { ListRowsLoading } from "@/components/content/list-skeleton";
import { MaskedValue } from "@/components/users/user-cells";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/filter-bar";
import { Modal } from "@/components/ui/modal";
import { apiFetch } from "@/lib/api/client";
import { describeError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import type { Paginated } from "@/types/content";
import type { AdminUser } from "@/types/users";

/** How many students one search shows. The panel never downloads the user list: each
 * search is one small server query (latest wins; older requests are aborted). */
export const STUDENT_PICKER_SIZE = 10;

type Load = { status: "loading" | "idle" | "error"; rows: AdminUser[] | null; error?: string };

export function StudentPicker({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (user: AdminUser) => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [load, setLoad] = useState<Load>({ status: "idle", rows: null });
  const [retry, setRetry] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (!open) return;
    const request = ++latest.current;
    const controller = new AbortController();
    const query = new URLSearchParams({ role: "student", page_size: String(STUDENT_PICKER_SIZE), ordering: "full_name" });
    if (search) query.set("search", search);
    setLoad((current) => ({ status: "loading", rows: current.rows }));
    apiFetch<Paginated<AdminUser>>(`/admin/users/?${query.toString()}`, { signal: controller.signal })
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
    <Modal open={open} onOpenChange={onOpenChange} title={t("studentPicker.title")} description={t("studentPicker.description")} size="md">
      <div className="space-y-4">
        <SearchInput id="student-picker-search" label={t("studentPicker.search")} placeholder={t("studentPicker.search")} value={search} onChange={setSearch} />
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
              {t("studentPicker.loading")}
            </p>
          )}
          {load.rows === null ? (
            load.status === "error" ? null : <ListRowsLoading label={t("studentPicker.loading")} rows={3} />
          ) : load.rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-muted">{t("studentPicker.noResults")}</p>
          ) : (
            <ul className={busy ? "divide-y divide-line opacity-60" : "divide-y divide-line"}>
              {load.rows.map((user) => (
                <li key={user.id} className="flex items-center gap-3 px-3 py-3 sm:px-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium break-words text-ink">{user.full_name}</p>
                    <p className="mt-1 text-xs text-ink-subtle">
                      <MaskedValue value={user.mobile_display} />
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    aria-label={t("studentPicker.selectLabel", { name: user.full_name })}
                    onClick={() => onSelect(user)}
                  >
                    {t("studentPicker.select")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
