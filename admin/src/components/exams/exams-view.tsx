"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";

import { ListRowsLoading } from "@/components/content/list-skeleton";
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
import { EXAM_LIST } from "@/lib/content-specs";
import { describeExamError } from "@/lib/exam-errors";
import { formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { activeFilterCount, type ListState } from "@/lib/list-params";
import { localized } from "@/lib/localized";
import { useListData } from "@/lib/use-list-data";
import { useListUrl } from "@/lib/use-list-url";
import { CONTENT_LANGUAGES, type Category, type Paginated, type Subject } from "@/types/content";
import { ACCESS_TYPES, EXAM_STATUSES, EXAM_TYPES, type Exam } from "@/types/exams";

import { ExamStatusBadge, ExamTitle, QuestionCountCell, ScheduleCell, examTitle } from "./exam-cells";

const NO_FILTERS = {
  status: "",
  exam_type: "",
  content_language: "",
  access_type: "",
  category: "",
  subject: "",
  is_featured: "",
  upcoming: "",
};

/** Exam list: the same URL-driven list state as the content lists (7B) — the server
 * filters, sorts and pages; the URL is the list's identity. */
export function ExamsView({
  data,
  state: serverState,
  categories,
  subjects,
  lookupTruncated,
}: {
  data: Paginated<Exam>;
  state: ListState;
  categories: Category[];
  subjects: Subject[];
  lookupTruncated: boolean;
}) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const { notify } = useToast();
  const { state, key: urlKey, update, pending: navigating } = useListUrl(EXAM_LIST);
  const goToFirstPage = useCallback(() => update({ page: 1 }, { replace: true }), [update]);
  const { data: list, reload, reloading, identity } = useListData({
    serverData: data,
    serverState,
    urlKey,
    apiPath: "/admin/exams/",
    onPageGone: goToFirstPage,
  });
  const rows = list?.results ?? [];
  const pending = navigating || reloading;
  const createRef = useRef<HTMLButtonElement>(null);
  const rememberDeleted = useDeleteFocus(rows, rowId, createRef);
  const [deleting, setDeleting] = useState<Exam | null>(null);
  const filtered = Boolean(state.search) || activeFilterCount(state) > 0;
  const categoryById = useMemo(() => new Map(categories.map((row) => [row.id, row])), [categories]);
  const subjectById = useMemo(() => new Map(subjects.map((row) => [row.id, row])), [subjects]);

  const name = (row: { name_bn: string; name_en: string } | undefined, fallback: string) =>
    row ? localized(locale, row.name_bn, row.name_en) : { text: fallback, lang: locale };

  /** Category › subject under the title (saves a table column). */
  const placement = (exam: Exam) => {
    const category = name(categoryById.get(exam.category), `#${exam.category}`);
    const subject = exam.subject === null ? null : name(subjectById.get(exam.subject), `#${exam.subject}`);
    return (
      <span className="mt-0.5 block text-[13px] break-words text-ink-muted">
        <span lang={category.lang}>{category.text}</span>
        {subject && (
          <>
            {" › "}
            <span lang={subject.lang}>{subject.text}</span>
          </>
        )}
      </span>
    );
  };

  const columns: Column<Exam>[] = [
    {
      key: "id",
      header: t("field.id"),
      sortField: "id",
      sortFirst: "desc",
      className: "w-16 tabular-nums text-ink-muted",
      cell: (row) => `#${row.id}`,
    },
    {
      key: "title",
      header: t("exams.colTitle"),
      hideOnMobile: true,
      className: "min-w-56",
      cell: (row) => (
        <>
          <ExamTitle exam={row} />
          {placement(row)}
        </>
      ),
    },
    {
      key: "type",
      header: t("exams.colType"),
      cell: (row) => (
        <span className="block whitespace-nowrap">
          {t(`examType.${row.exam_type}`)}
          <span className="block text-[13px] text-ink-subtle">
            {t(`access.${row.access_type}`)} · {t(`language.${row.content_language}`)}
          </span>
        </span>
      ),
    },
    { key: "status", header: t("field.status"), cell: (row) => <ExamStatusBadge status={row.status} /> },
    {
      key: "schedule",
      header: t("exams.colSchedule"),
      sortField: "start_at",
      className: "min-w-40",
      cell: (row) => <ScheduleCell exam={row} />,
    },
    { key: "questions", header: t("exams.colQuestions"), cell: (row) => <QuestionCountCell exam={row} /> },
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
  const boolOptions = (all: string, yes: string, no: string) => [
    { value: "", label: all },
    { value: "true", label: yes },
    { value: "false", label: no },
  ];

  async function remove(exam: Exam) {
    await apiFetch(`/admin/exams/${exam.id}/`, { method: "DELETE" });
    rememberDeleted(exam);
    setDeleting(null);
    notify(t("exam.deleted"));
    void reload();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("exams.title")}
        subtitle={t("exams.subtitle")}
        actions={
          <Button asChild ref={createRef}>
            <Link href={selectedCategory ? `/exams/new?category=${selectedCategory}` : "/exams/new"}>
              <Plus aria-hidden />
              {t("exams.new")}
            </Link>
          </Button>
        }
      />
      {lookupTruncated && <Alert tone="warning">{t("subjects.lookupTruncated", { n: formatNumber(subjects.length, locale) })}</Alert>}
      <Card {...identity}>
        <FilterBar
          search={
            <SearchInput
              id="exams-search"
              label={t("list.search")}
              placeholder={t("exams.search")}
              value={state.search}
              onChange={(search) => update({ search }, { replace: true })}
            />
          }
          activeCount={activeFilterCount(state)}
          onClear={() => update({ search: "", filters: NO_FILTERS })}
          filters={(prefix) => (
            <>
              <FilterSelect
                id={`${prefix}-status`}
                label={t("field.status")}
                value={state.filters.status ?? ""}
                onChange={(value) => update({ filters: { status: value } })}
                options={[
                  { value: "", label: t("exams.allStatuses") },
                  ...EXAM_STATUSES.map((value) => ({ value, label: t(`examStatus.${value}`) })),
                ]}
                className="md:w-36"
              />
              <FilterSelect
                id={`${prefix}-type`}
                label={t("exams.colType")}
                value={state.filters.exam_type ?? ""}
                onChange={(value) => update({ filters: { exam_type: value } })}
                options={[
                  { value: "", label: t("exams.allTypes") },
                  ...EXAM_TYPES.map((value) => ({ value, label: t(`examType.${value}`) })),
                ]}
                className="md:w-36"
              />
              <FilterSelect
                id={`${prefix}-category`}
                label={t("exam.category")}
                value={state.filters.category ?? ""}
                // A subject from another category would match nothing: clear it too.
                onChange={(value) => update({ filters: { category: value, subject: "" } })}
                options={[
                  { value: "", label: t("subjects.allCategories") },
                  ...categories.map((row) => ({ value: String(row.id), label: name(row, "").text })),
                ]}
                className="md:w-48"
              />
              <FilterSelect
                id={`${prefix}-subject`}
                label={t("exam.subject")}
                value={state.filters.subject ?? ""}
                onChange={(value) => update({ filters: { subject: value } })}
                options={[
                  { value: "", label: t("common.all") },
                  ...subjectChoices.map((row) => ({ value: String(row.id), label: name(row, "").text })),
                ]}
                className="md:w-48"
              />
              <FilterSelect
                id={`${prefix}-language`}
                label={t("exam.contentLanguage")}
                value={state.filters.content_language ?? ""}
                onChange={(value) => update({ filters: { content_language: value } })}
                options={[
                  { value: "", label: t("questions.allLanguages") },
                  ...CONTENT_LANGUAGES.map((value) => ({ value, label: t(`language.${value}`) })),
                ]}
                className="md:w-40"
              />
              <FilterSelect
                id={`${prefix}-access`}
                label={t("exams.colAccess")}
                value={state.filters.access_type ?? ""}
                onChange={(value) => update({ filters: { access_type: value } })}
                options={[
                  { value: "", label: t("exams.allAccess") },
                  ...ACCESS_TYPES.map((value) => ({ value, label: t(`access.${value}`) })),
                ]}
                className="md:w-40"
              />
              <FilterSelect
                id={`${prefix}-upcoming`}
                label={t("exams.colSchedule")}
                value={state.filters.upcoming ?? ""}
                onChange={(value) => update({ filters: { upcoming: value } })}
                options={boolOptions(t("exams.anyTime"), t("exams.upcomingOnly"), t("exams.notUpcoming"))}
                className="md:w-36"
              />
              <FilterSelect
                id={`${prefix}-featured`}
                label={t("exam.featured")}
                value={state.filters.is_featured ?? ""}
                onChange={(value) => update({ filters: { is_featured: value } })}
                options={boolOptions(t("common.all"), t("exams.featuredOnly"), t("exams.notFeatured"))}
                className="md:w-36"
              />
            </>
          )}
        />
        {list === null ? (
          <ListRowsLoading label={t("list.updating")} />
        ) : list.results.length ? (
          <DataTable
            caption={t("exams.title")}
            rows={rows}
            rowKey={rowId}
            columns={columns}
            ordering={state.ordering}
            onSort={(ordering) => update({ ordering })}
            busy={pending}
            mobileTitle={(row) => (
              <>
                <ExamTitle exam={row} />
                {placement(row)}
              </>
            )}
            actions={(row) => {
              const label = examTitle(row, locale).text || `#${row.id}`;
              return (
                <span className="inline-flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => router.push(`/exams/${row.id}`)}
                    aria-label={t("exams.editLabel", { name: label })}
                    title={t("exams.editLabel", { name: label })}
                    data-row-action="edit"
                  >
                    <Pencil aria-hidden />
                  </Button>
                  {/* Only drafts can be deleted (published history is kept). */}
                  {row.status === "draft" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleting(row)}
                      data-row-action="delete"
                      aria-label={t("exams.deleteLabel", { name: label })}
                      title={t("exams.deleteLabel", { name: label })}
                      className="hover:bg-danger-50 hover:text-danger-700"
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </span>
              );
            }}
          />
        ) : filtered ? (
          <EmptyState title={t("exams.noMatch")} description={t("exams.noMatchHint")} />
        ) : (
          <EmptyState
            title={t("exams.empty")}
            description={t("exams.emptyHint")}
            action={
              <Button asChild>
                <Link href="/exams/new">
                  <Plus aria-hidden />
                  {t("exams.new")}
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
          title={t("exam.deleteTitle")}
          description={t("exam.deleteBody", { name: examTitle(deleting, locale).text || `#${deleting.id}` })}
          confirmLabel={t("common.delete")}
          pendingLabel={t("common.deleting")}
          onConfirm={() => remove(deleting)}
          describe={(error) => describeExamError(error, t)}
        />
      )}
    </div>
  );
}

const rowId = (row: { id: number }) => row.id;
