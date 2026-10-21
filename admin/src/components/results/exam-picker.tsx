"use client";

import { useEffect, useRef, useState } from "react";

import { ExamStatusBadge, examTitle } from "@/components/exams/exam-cells";
import { ListRowsLoading } from "@/components/content/list-skeleton";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/filter-bar";
import { Modal } from "@/components/ui/modal";
import { apiFetch } from "@/lib/api/client";
import { describeError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey } from "@/lib/i18n/messages";
import type { Paginated } from "@/types/content";
import type { Exam } from "@/types/exams";

/** How many exams one search shows. The exam catalogue grows without limit, so the
 * picker never downloads it: each search is one small server query (latest wins). */
export const EXAM_PICKER_SIZE = 10;

type Load = { status: "loading" | "idle" | "error"; rows: Exam[] | null; error?: string };

/** Picker texts; the default is the Results screen's ("Show results of …"). */
export type ExamPickerLabels = {
  title: MessageKey;
  description: MessageKey;
  select: MessageKey;
  /** With `{name}`. */
  selectLabel: MessageKey;
};

const RESULTS_LABELS: ExamPickerLabels = {
  title: "examPicker.title",
  description: "examPicker.description",
  select: "examPicker.select",
  selectLabel: "examPicker.selectLabel",
};

export function ExamPicker({
  open,
  onOpenChange,
  onSelect,
  accessType,
  labels = RESULTS_LABELS,
  isChosen,
  chosenLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (exam: Exam) => void;
  /** Server-side filter (e.g. only paid exams for a package's access rules). */
  accessType?: "free" | "paid";
  labels?: ExamPickerLabels;
  /** Exams already chosen: shown, but not selectable again. */
  isChosen?: (exam: Exam) => boolean;
  chosenLabel?: string;
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
    const query = new URLSearchParams({ page_size: String(EXAM_PICKER_SIZE), ordering: "-updated_at" });
    if (search) query.set("search", search);
    if (accessType) query.set("access_type", accessType);
    setLoad((current) => ({ status: "loading", rows: current.rows }));
    apiFetch<Paginated<Exam>>(`/admin/exams/?${query.toString()}`, { signal: controller.signal })
      .then((page) => {
        if (request === latest.current) setLoad({ status: "idle", rows: page.results });
      })
      .catch((error) => {
        if (request !== latest.current || controller.signal.aborted) return;
        setLoad((current) => ({ status: "error", rows: current.rows, error: describeError(error, t) }));
      });
    return () => controller.abort();
  }, [open, search, retry, accessType, t]);

  const busy = load.status === "loading";

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t(labels.title)} description={t(labels.description)} size="md">
      <div className="space-y-4">
        <SearchInput id="exam-picker-search" label={t("examPicker.search")} placeholder={t("examPicker.search")} value={search} onChange={setSearch} />
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
              {t("examPicker.loading")}
            </p>
          )}
          {load.rows === null ? (
            load.status === "error" ? null : <ListRowsLoading label={t("examPicker.loading")} rows={3} />
          ) : load.rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-muted">{t("examPicker.noResults")}</p>
          ) : (
            <ul className={busy ? "divide-y divide-line opacity-60" : "divide-y divide-line"}>
              {load.rows.map((exam) => {
                const title = examTitle(exam, locale);
                const name = title.text || `#${exam.id}`;
                return (
                  <li key={exam.id} className="flex items-center gap-3 px-3 py-3 sm:px-4">
                    <div className="min-w-0 flex-1">
                      <p lang={title.lang} className="line-clamp-2 text-sm font-medium break-words text-ink">
                        {name}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
                        <span className="tabular-nums">#{exam.id}</span>
                        <ExamStatusBadge status={exam.status} />
                      </div>
                    </div>
                    {isChosen?.(exam) ? (
                      <span className="shrink-0 text-[13px] text-ink-muted">{chosenLabel}</span>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="shrink-0"
                        aria-label={t(labels.selectLabel, { name })}
                        onClick={() => onSelect(exam)}
                      >
                        {t(labels.select)}
                      </Button>
                    )}
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
