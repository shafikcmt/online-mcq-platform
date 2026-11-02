"use client";

import { Check, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ListRowsLoading } from "@/components/content/list-skeleton";
import { DifficultyLabel, LanguageBadge } from "@/components/content/question-cells";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FilterSelect, SearchInput } from "@/components/ui/filter-bar";
import { Modal } from "@/components/ui/modal";
import { Pagination } from "@/components/ui/pagination";
import { apiFetch } from "@/lib/api/client";
import { describeError } from "@/lib/api/errors";
import { QUESTION_LIST } from "@/lib/content-specs";
import { addQuestion, fromBankQuestion, isAssigned, removeQuestion, type AssignedQuestion } from "@/lib/exam-questions";
import { formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { DEFAULT_PAGE_SIZE, toApiQuery, updateListState, type ListState } from "@/lib/list-params";
import { localized } from "@/lib/localized";
import { CONTENT_LANGUAGES, DIFFICULTIES, type Category, type Paginated, type Question, type Subject } from "@/types/content";

export type PickerQuery = ListState;

/** Initial picker query: the exam's own category/subject and language, active questions
 * only — all visible filters the admin can change or clear. */
export function initialPickerQuery(exam: { category: number; subject: number | null; content_language: string }): PickerQuery {
  const filters: Record<string, string> = {
    category: String(exam.category),
    language: exam.content_language,
    is_active: "true",
  };
  if (exam.subject !== null) filters.subject = String(exam.subject);
  return { page: 1, pageSize: DEFAULT_PAGE_SIZE, search: "", ordering: QUESTION_LIST.defaultOrdering, filters };
}

type Load = { status: "idle" | "loading" | "error"; data: Paginated<Question> | null; error?: string };

/** Question-bank search for the exam builder. The bank is never fetched whole: each
 * search/filter/page is one server request, and only the latest response is applied (an
 * older, slower one is aborted and ignored). The selection is the editor's assigned list
 * (`items`), so it survives paging, filtering and closing/reopening the picker; the
 * picker's query is kept by the parent for the same reason. */
export function QuestionPicker({
  open,
  onOpenChange,
  query,
  onQueryChange,
  items,
  onItemsChange,
  categories,
  subjects,
  announce,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: PickerQuery;
  onQueryChange: (query: PickerQuery) => void;
  items: AssignedQuestion[];
  onItemsChange: (items: AssignedQuestion[]) => void;
  categories: Category[];
  subjects: Subject[];
  announce: (message: string) => void;
}) {
  const { locale, t } = useI18n();
  const [load, setLoad] = useState<Load>({ status: "idle", data: null });
  const [retry, setRetry] = useState(0);
  const latest = useRef(0);
  const apiQuery = toApiQuery(query);

  useEffect(() => {
    if (!open) return;
    const request = ++latest.current;
    const controller = new AbortController();
    setLoad((current) => ({ status: "loading", data: current.data }));
    apiFetch<Paginated<Question>>(`/admin/questions/${apiQuery}`, { signal: controller.signal })
      .then((data) => {
        if (request === latest.current) setLoad({ status: "idle", data });
      })
      .catch((error) => {
        if (request !== latest.current || controller.signal.aborted) return;
        setLoad((current) => ({ status: "error", data: current.data, error: describeError(error, t) }));
      });
    return () => controller.abort();
  }, [open, apiQuery, retry, t]);

  const change = (next: Parameters<typeof updateListState>[1]) => onQueryChange(updateListState(query, next));
  const name = (row: { name_bn: string; name_en: string }) => localized(locale, row.name_bn, row.name_en).text;
  const categoryId = query.filters.category ? Number(query.filters.category) : null;
  const subjectChoices = useMemo(
    () => (categoryId ? subjects.filter((row) => row.category === categoryId) : subjects),
    [categoryId, subjects],
  );
  const rows = load.data?.results ?? [];
  const busy = load.status === "loading";

  function add(question: Question) {
    onItemsChange(addQuestion(items, fromBankQuestion(question)));
    announce(t("examQuestions.addedAnnounce", { id: question.id, n: formatNumber(items.length + 1, locale) }));
    // The Add button is replaced by "Added" + remove: keep the keyboard on this row.
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[data-picker-row="${question.id}"] [data-picker-remove]`)?.focus(),
    );
  }

  function remove(question: Question) {
    onItemsChange(removeQuestion(items, question.id));
    announce(t("examQuestions.removed", { id: question.id }));
    // Keep the keyboard on this row: its Add button replaces the remove button.
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[data-picker-row="${question.id}"] [data-picker-add]`)?.focus(),
    );
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("picker.title")}
      description={t("picker.description")}
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <p className="text-sm text-ink-muted" aria-live="polite">
            {t("picker.selected", { n: formatNumber(items.length, locale) })}
          </p>
          <Button onClick={() => onOpenChange(false)}>{t("picker.done")}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-3">
          <SearchInput
            id="picker-search"
            label={t("list.search")}
            placeholder={t("questions.search")}
            value={query.search}
            onChange={(search) => change({ search })}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <FilterSelect
              id="picker-category"
              label={t("questions.category")}
              value={query.filters.category ?? ""}
              onChange={(value) => change({ filters: { category: value, subject: "" } })}
              options={[
                { value: "", label: t("subjects.allCategories") },
                ...categories.map((row) => ({ value: String(row.id), label: name(row) })),
              ]}
            />
            <FilterSelect
              id="picker-subject"
              label={t("questions.subject")}
              value={query.filters.subject ?? ""}
              onChange={(value) => change({ filters: { subject: value } })}
              options={[
                { value: "", label: t("picker.allSubjects") },
                ...subjectChoices.map((row) => ({ value: String(row.id), label: name(row) })),
              ]}
            />
            <FilterSelect
              id="picker-difficulty"
              label={t("questions.difficulty")}
              value={query.filters.difficulty ?? ""}
              onChange={(value) => change({ filters: { difficulty: value } })}
              options={[
                { value: "", label: t("questions.allDifficulties") },
                ...DIFFICULTIES.map((value) => ({ value, label: t(`difficulty.${value}`) })),
              ]}
            />
            <FilterSelect
              id="picker-language"
              label={t("questions.language")}
              value={query.filters.language ?? ""}
              onChange={(value) => change({ filters: { language: value } })}
              options={[
                { value: "", label: t("questions.allLanguages") },
                ...CONTENT_LANGUAGES.map((value) => ({ value, label: t(`language.${value}`) })),
              ]}
            />
            <FilterSelect
              id="picker-status"
              label={t("field.status")}
              value={query.filters.is_active ?? ""}
              onChange={(value) => change({ filters: { is_active: value } })}
              options={[
                { value: "", label: t("common.all") },
                { value: "true", label: t("status.active") },
                { value: "false", label: t("status.inactive") },
              ]}
            />
          </div>
        </div>

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
              {t("picker.loading")}
            </p>
          )}
          {load.data === null ? (
            load.status === "error" ? null : <ListRowsLoading label={t("picker.loading")} rows={4} />
          ) : rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-muted">{t("picker.noResults")}</p>
          ) : (
            <ul className={busy ? "divide-y divide-line opacity-60 transition-opacity" : "divide-y divide-line"}>
              {rows.map((question) => {
                const text = localized(locale, question.text_bn, question.text_en);
                const assigned = isAssigned(items, question.id);
                return (
                  <li key={question.id} data-picker-row={question.id} className="flex items-start gap-3 px-3 py-3 sm:px-4">
                    <div className="min-w-0 flex-1">
                      <p lang={text.lang} className="line-clamp-2 text-sm break-words text-ink">
                        {text.text || t("questions.noText")}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-subtle">
                        <span className="tabular-nums">#{question.id}</span>
                        <LanguageBadge language={question.available_languages} />
                        <DifficultyLabel difficulty={question.difficulty} />
                        {!question.is_active && <span className="text-ink-muted">{t("status.inactive")}</span>}
                      </div>
                    </div>
                    {assigned ? (
                      <span className="inline-flex shrink-0 items-center gap-1">
                        <span className="inline-flex h-8 items-center gap-1 rounded-control bg-success-50 px-2.5 text-xs font-medium text-success-700 ring-1 ring-success-700/15 ring-inset">
                          <Check className="size-3.5" aria-hidden />
                          {t("picker.added")}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 hover:bg-danger-50 hover:text-danger-700"
                          onClick={() => remove(question)}
                          aria-label={t("picker.removeLabel", { id: question.id })}
                          title={t("picker.removeLabel", { id: question.id })}
                          data-picker-remove
                        >
                          <X aria-hidden />
                        </Button>
                      </span>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="shrink-0"
                        onClick={() => add(question)}
                        aria-label={t("picker.addLabel", { id: question.id })}
                        data-picker-add
                      >
                        <Plus aria-hidden />
                        {t("picker.add")}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {load.data && (
            <Pagination
              page={query.page}
              pageSize={query.pageSize}
              count={load.data.count}
              disabled={busy}
              onPage={(page) => change({ page })}
              onPageSize={(pageSize) => change({ pageSize })}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}
