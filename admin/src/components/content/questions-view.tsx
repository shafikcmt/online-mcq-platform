"use client";

import { ImageIcon, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";

import { DateTimeText } from "@/components/ui/date-time";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, useDeleteFocus, type Column } from "@/components/ui/data-table";
import { FilterBar, FilterSelect, SearchInput } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { describeDeleteError } from "@/lib/content-errors";
import { QUESTION_LIST } from "@/lib/content-specs";
import { formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { activeFilterCount, type ListState } from "@/lib/list-params";
import { localized } from "@/lib/localized";
import { useListData } from "@/lib/use-list-data";
import { useListUrl } from "@/lib/use-list-url";
import { CONTENT_LANGUAGES, DIFFICULTIES, type Category, type Paginated, type Question, type Subject } from "@/types/content";

import { ListRowsLoading } from "./list-skeleton";
import { ActiveBadge, RowActions, statusFilterOptions } from "./catalog-cells";
import { DifficultyLabel, LanguageBadge } from "./question-cells";

export function QuestionsView({
  data,
  state: serverState,
  categories,
  subjects,
  lookupTruncated,
}: {
  data: Paginated<Question>;
  state: ListState;
  categories: Category[];
  subjects: Subject[];
  lookupTruncated: boolean;
}) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const { notify } = useToast();
  const { state, key: urlKey, update, pending: navigating } = useListUrl(QUESTION_LIST);
  const goToFirstPage = useCallback(() => update({ page: 1 }, { replace: true }), [update]);
  const { data: list, reload, reloading, identity } = useListData({
    serverData: data,
    serverState,
    urlKey,
    apiPath: "/admin/questions/",
    onPageGone: goToFirstPage,
  });
  const rows = list?.results ?? [];
  const pending = navigating || reloading;
  const createRef = useRef<HTMLButtonElement>(null);
  const rememberDeleted = useDeleteFocus(rows, rowId, createRef);
  const [deleting, setDeleting] = useState<Question | null>(null);
  const filtered = Boolean(state.search) || activeFilterCount(state) > 0;
  const categoryById = useMemo(() => new Map(categories.map((row) => [row.id, row])), [categories]);
  const subjectById = useMemo(() => new Map(subjects.map((row) => [row.id, row])), [subjects]);

  const name = (row: { name_bn: string; name_en: string } | undefined, fallback: string) =>
    row ? localized(locale, row.name_bn, row.name_en) : { text: fallback, lang: locale };

  const columns: Column<Question>[] = [
    {
      key: "id",
      header: t("field.id"),
      sortField: "id",
      sortFirst: "desc",
      className: "w-16 tabular-nums text-ink-muted",
      cell: (row) => `#${row.id}`,
    },
    {
      key: "text",
      header: t("questions.question"),
      hideOnMobile: true,
      className: "min-w-60",
      cell: (row) => <QuestionText question={row} />,
    },
    {
      key: "subject",
      header: t("questions.subjectCol"),
      className: "min-w-32",
      cell: (row) => {
        const subject = name(subjectById.get(row.subject), `#${row.subject}`);
        const category = name(categoryById.get(row.category), `#${row.category}`);
        return (
          <span className="block min-w-0">
            <span lang={subject.lang} className="block break-words">
              {subject.text}
            </span>
            <span lang={category.lang} className="block text-[13px] break-words text-ink-subtle">
              {category.text}
            </span>
          </span>
        );
      },
    },
    { key: "languages", header: t("questions.languages"), cell: (row) => <LanguageBadge language={row.available_languages} /> },
    {
      key: "difficulty",
      header: t("questions.difficulty"),
      sortField: "difficulty",
      cell: (row) => <DifficultyLabel difficulty={row.difficulty} />,
    },
    { key: "status", header: t("field.status"), cell: (row) => <ActiveBadge active={row.is_active} /> },
    {
      key: "updated",
      header: t("field.updated"),
      sortField: "updated_at",
      sortFirst: "desc",
      className: "min-w-28",
      cell: (row) => <span className="text-ink-muted"><DateTimeText iso={row.updated_at} /></span>,
    },
  ];

  const selectedCategory = state.filters.category ? Number(state.filters.category) : null;
  const subjectChoices = selectedCategory ? subjects.filter((row) => row.category === selectedCategory) : subjects;

  async function remove(question: Question) {
    await apiFetch(`/admin/questions/${question.id}/`, { method: "DELETE" });
    rememberDeleted(question); // focus moves to a neighbouring row once the new page renders
    setDeleting(null);
    notify(t("questions.deleted"));
    void reload();
  }

  const newHref = selectedCategory ? `/questions/new?category=${selectedCategory}` : "/questions/new";

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("questions.title")}
        subtitle={t("questions.subtitle")}
        actions={
          <Button asChild ref={createRef}>
            <Link href={newHref}>
              <Plus aria-hidden />
              {t("questions.new")}
            </Link>
          </Button>
        }
      />
      {lookupTruncated && <Alert tone="warning">{t("subjects.lookupTruncated", { n: formatNumber(subjects.length, locale) })}</Alert>}
      <Card {...identity}>
        <FilterBar
          search={
            <SearchInput
              id="questions-search"
              label={t("list.search")}
              placeholder={t("questions.search")}
              value={state.search}
              onChange={(search) => update({ search }, { replace: true })}
            />
          }
          activeCount={activeFilterCount(state)}
          onClear={() =>
            update({ search: "", filters: { category: "", subject: "", difficulty: "", language: "", is_active: "" } })
          }
          filters={(prefix) => (
            <>
              <FilterSelect
                id={`${prefix}-category`}
                label={t("questions.category")}
                value={state.filters.category ?? ""}
                // A subject from another category would match nothing: clear it too.
                onChange={(value) => update({ filters: { category: value, subject: "" } })}
                options={[
                  { value: "", label: t("subjects.allCategories") },
                  ...categories.map((row) => ({ value: String(row.id), label: name(row, "").text })),
                ]}
                className="md:w-52"
              />
              <FilterSelect
                id={`${prefix}-subject`}
                label={t("questions.subject")}
                value={state.filters.subject ?? ""}
                onChange={(value) => update({ filters: { subject: value } })}
                options={[
                  { value: "", label: t("common.all") },
                  ...subjectChoices.map((row) => ({ value: String(row.id), label: name(row, "").text })),
                ]}
                className="md:w-52"
              />
              <FilterSelect
                id={`${prefix}-difficulty`}
                label={t("questions.difficulty")}
                value={state.filters.difficulty ?? ""}
                onChange={(value) => update({ filters: { difficulty: value } })}
                options={[
                  { value: "", label: t("questions.allDifficulties") },
                  ...DIFFICULTIES.map((value) => ({ value, label: t(`difficulty.${value}`) })),
                ]}
                className="md:w-40"
              />
              <FilterSelect
                id={`${prefix}-language`}
                label={t("questions.language")}
                value={state.filters.language ?? ""}
                onChange={(value) => update({ filters: { language: value } })}
                options={[
                  { value: "", label: t("questions.allLanguages") },
                  ...CONTENT_LANGUAGES.map((value) => ({ value, label: t(`language.${value}`) })),
                ]}
                className="md:w-44"
              />
              <FilterSelect
                id={`${prefix}-status`}
                label={t("field.status")}
                value={state.filters.is_active ?? ""}
                onChange={(value) => update({ filters: { is_active: value } })}
                options={statusFilterOptions(t)}
                className="md:w-36"
              />
            </>
          )}
        />
        {list === null ? (
          <ListRowsLoading label={t("list.updating")} />
        ) : list.results.length ? (
          <DataTable
            caption={t("questions.title")}
            rows={rows}
            rowKey={rowId}
            columns={columns}
            ordering={state.ordering}
            onSort={(ordering) => update({ ordering })}
            busy={pending}
            mobileTitle={(row) => <QuestionText question={row} />}
            actions={(row) => (
              <RowActions
                editLabel={t("questions.editLabel", { id: row.id })}
                deleteLabel={t("questions.deleteLabel", { id: row.id })}
                onEdit={() => router.push(`/questions/${row.id}`)}
                onDelete={() => setDeleting(row)}
              />
            )}
          />
        ) : filtered ? (
          <EmptyState title={t("questions.noMatch")} description={t("questions.noMatchHint")} />
        ) : (
          <EmptyState
            title={t("questions.empty")}
            description={t("questions.emptyHint")}
            action={
              <Button asChild>
                <Link href="/questions/new">
                  <Plus aria-hidden />
                  {t("questions.new")}
                </Link>
              </Button>
            }
          />
        )}
        {list && (
          <Pagination
            page={state.page}
            pageSize={state.pageSize}
            count={list.count}
            disabled={pending}
            onPage={(page) => update({ page })}
            onPageSize={(pageSize) => update({ pageSize })}
          />
        )}
      </Card>

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title={t("questions.deleteTitle")}
          description={t("questions.deleteBody", { id: deleting.id })}
          confirmLabel={t("common.delete")}
          pendingLabel={t("common.deleting")}
          onConfirm={() => remove(deleting)}
          describe={(error) => describeDeleteError(error, t)}
        />
      )}
    </div>
  );
}

/** Question text in the UI language (falls back to the other), two lines at most, linked
 * to its edit page. */
function QuestionText({ question }: { question: Question }) {
  const { locale, t } = useI18n();
  const text = localized(locale, question.text_bn, question.text_en);
  return (
    <Link href={`/questions/${question.id}`} className="group block min-w-0 rounded-control">
      <span lang={text.lang} className="line-clamp-2 break-words text-ink group-hover:text-brand-700 group-hover:underline">
        {text.text || t("questions.noText")}
      </span>
      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-subtle">
        <span>{t("questions.optionCount", { n: formatNumber(question.options.length, locale) })}</span>
        {question.image && (
          <span className="inline-flex items-center gap-1">
            <ImageIcon className="size-3.5" aria-hidden />
            {t("questions.sectionImage")}
          </span>
        )}
      </span>
    </Link>
  );
}

const rowId = (row: { id: number }) => row.id;
