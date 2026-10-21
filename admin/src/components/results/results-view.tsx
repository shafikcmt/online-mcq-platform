"use client";

import { BookOpenCheck, ExternalLink, Trophy, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { examTitle } from "@/components/exams/exam-cells";
import { ExamResults } from "@/components/exams/exam-results";
import { ListRowsLoading } from "@/components/content/list-skeleton";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar, FilterSelect, SearchInput } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { RESULT_LIST } from "@/lib/content-specs";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { activeFilterCount, type ListState } from "@/lib/list-params";
import { localized } from "@/lib/localized";
import { useListData } from "@/lib/use-list-data";
import { useListUrl } from "@/lib/use-list-url";
import type { Paginated } from "@/types/content";
import type { Exam } from "@/types/exams";
import type { AdminResult } from "@/types/results";

import { ExamPicker } from "./exam-picker";
import { Duration, Marks, MeritCell, OutcomeBadge } from "./result-cells";

/** The exam named by `?exam=` as the server page read it: `null` = it does not exist. */
export type ServerExam = { id: number; exam: Exam | null };

/** Results list. Same URL-driven list state as the content and exam lists (7B/7C): the
 * server filters, searches (student name), sorts and pages; the URL is the identity.
 * With an exam chosen, its result controls appear above the list (exam-level actions,
 * the same component as in the exam editor). Filtered by "counted for merit" and sorted
 * by merit position, the list is the admin merit view (no separate leaderboard API). */
export function ResultsView({
  data,
  state: serverState,
  exam: serverExam,
}: {
  data: Paginated<AdminResult>;
  state: ListState;
  exam: ServerExam | null;
}) {
  const { locale, t } = useI18n();
  const { state, key: urlKey, update, pending: navigating } = useListUrl(RESULT_LIST);
  const goToFirstPage = useCallback(() => update({ page: 1 }, { replace: true }), [update]);
  const { data: list, reload, reloading, identity } = useListData({
    serverData: data,
    serverState,
    urlKey,
    apiPath: "/admin/results/",
    onPageGone: goToFirstPage,
  });
  const [picking, setPicking] = useState(false);
  const rows = list?.results ?? [];
  const pending = navigating || reloading;
  const filtered = Boolean(state.search) || activeFilterCount(state) > 0;

  const examId = state.filters.exam ? Number(state.filters.exam) : null;
  // The exam context belongs to the URL's exam only (never shows the previous exam while
  // the server page for a new one is on its way).
  const examContext = examId !== null && serverExam?.id === examId ? serverExam : null;
  const userId = state.filters.user ? Number(state.filters.user) : null;
  const studentName = userId === null ? null : (rows.find((row) => row.user_id === userId)?.user_full_name ?? null);
  const meritView = state.filters.merit_counted === "true" && state.ordering === "merit_position";

  const examName = (row: Pick<AdminResult, "exam_title_bn" | "exam_title_en" | "exam_id">) => {
    const title = localized(locale, row.exam_title_bn, row.exam_title_en);
    return { text: title.text || `#${row.exam_id}`, lang: title.lang };
  };

  const allColumns: Column<AdminResult>[] = [
    {
      key: "student",
      header: t("results.colStudent"),
      hideOnMobile: true,
      className: "min-w-44",
      cell: (row) => <StudentCell row={row} />,
    },
    {
      key: "exam",
      header: t("results.colExam"),
      className: "min-w-40",
      cell: (row) => {
        const name = examName(row);
        return examId === row.exam_id ? (
          <span lang={name.lang} className="block break-words">
            {name.text}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => update({ filters: { exam: String(row.exam_id) } })}
            className="block rounded-control text-left break-words text-ink hover:text-brand-700 hover:underline"
            aria-label={t("results.examResults", { name: name.text })}
          >
            <span lang={name.lang}>{name.text}</span>
          </button>
        );
      },
    },
    {
      key: "submitted",
      header: t("results.colSubmitted"),
      sortField: "submitted_at",
      sortFirst: "desc",
      className: "min-w-28",
      cell: (row) => <span className="text-ink-muted">{formatDateTime(row.submitted_at, locale)}</span>,
    },
    { key: "marks", header: t("results.colScore"), cell: (row) => <Marks result={row} /> },
    {
      key: "percentage",
      header: t("results.colPercentage"),
      sortField: "percentage",
      sortFirst: "desc",
      cell: (row) => <span className="tabular-nums">{row.percentage}%</span>,
    },
    { key: "outcome", header: t("results.colOutcome"), cell: (row) => <OutcomeBadge passed={row.is_passed} /> },
    { key: "time", header: t("results.colTime"), cell: (row) => <Duration seconds={row.time_used_seconds} /> },
    {
      key: "merit",
      header: t("results.colMerit"),
      sortField: "merit_position",
      cell: (row) => <MeritCell result={row} />,
    },
  ];
  // Filtered by one exam, every row has that exam (named in the chip and the exam panel).
  const columns = examId === null ? allColumns : allColumns.filter((column) => column.key !== "exam");

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("results.title")}
        subtitle={t("results.subtitle")}
        actions={
          <Button
            variant={meritView ? "primary" : "secondary"}
            aria-pressed={meritView}
            onClick={() => update({ filters: { merit_counted: "true" }, ordering: "merit_position" })}
            title={t("results.meritViewHint")}
          >
            <Trophy aria-hidden />
            {t("results.meritView")}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2" aria-label={t("list.filters")} role="group">
        {examId === null ? (
          <Button variant="secondary" onClick={() => setPicking(true)} aria-haspopup="dialog">
            <BookOpenCheck aria-hidden />
            {t("results.chooseExam")}
          </Button>
        ) : (
          <FilterChip
            label={
              examContext?.exam
                ? examTitle(examContext.exam, locale).text || `#${examId}`
                : `${t("results.examFilter")} #${examId}`
            }
            prefix={t("results.examFilter")}
            clearLabel={t("results.clearExam")}
            onClear={() => update({ filters: { exam: "" } })}
            extra={
              <Button variant="ghost" size="sm" onClick={() => setPicking(true)} aria-haspopup="dialog">
                {t("results.changeExam")}
              </Button>
            }
          />
        )}
        {userId !== null && (
          <FilterChip
            label={studentName ?? t("results.studentUnknown", { id: userId })}
            prefix={t("results.studentFilter")}
            clearLabel={t("results.clearStudent")}
            onClear={() => update({ filters: { user: "" } })}
          />
        )}
      </div>

      {examId !== null &&
        (examContext === null ? (
          <div aria-busy="true" className="space-y-3 rounded-card border border-line bg-surface p-5">
            <p className="sr-only" role="status">
              {t("resultsExam.loading")}
            </p>
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-16" />
          </div>
        ) : examContext.exam === null ? (
          <Alert tone="warning">{t("resultsExam.notFound", { id: examId })}</Alert>
        ) : (
          <ExamContext
            // A new server read of the exam starts fresh; actions update it in place.
            key={`${examContext.exam.id}:${examContext.exam.updated_at}`}
            exam={examContext.exam}
            onMeritGenerated={() => void reload()}
          />
        ))}

      <Card {...identity}>
        <FilterBar
          search={
            <SearchInput
              id="results-search"
              label={t("list.search")}
              placeholder={t("results.search")}
              value={state.search}
              onChange={(search) => update({ search }, { replace: true })}
            />
          }
          activeCount={activeFilterCount(state)}
          onClear={() => update({ search: "", filters: { exam: "", user: "", is_passed: "", merit_counted: "" } })}
          filters={(prefix) => (
            <>
              <FilterSelect
                id={`${prefix}-outcome`}
                label={t("results.outcomeFilter")}
                value={state.filters.is_passed ?? ""}
                onChange={(value) => update({ filters: { is_passed: value } })}
                options={[
                  { value: "", label: t("results.allOutcomes") },
                  { value: "true", label: t("results.passedOnly") },
                  { value: "false", label: t("results.failedOnly") },
                ]}
                className="md:w-52"
              />
              <FilterSelect
                id={`${prefix}-merit`}
                label={t("results.meritFilter")}
                value={state.filters.merit_counted ?? ""}
                onChange={(value) => update({ filters: { merit_counted: value } })}
                options={[
                  { value: "", label: t("results.allResults") },
                  { value: "true", label: t("results.meritCountedOnly") },
                  { value: "false", label: t("results.notMeritCounted") },
                ]}
                className="md:w-52"
              />
              <FilterSelect
                id={`${prefix}-ordering`}
                label={t("list.sort")}
                value={state.ordering}
                onChange={(ordering) => update({ ordering })}
                options={[
                  { value: "-submitted_at", label: t("results.newestFirst") },
                  { value: "submitted_at", label: t("results.oldestFirst") },
                  { value: "-percentage", label: t("results.highestFirst") },
                  { value: "percentage", label: t("results.lowestFirst") },
                  { value: "merit_position", label: t("results.rankAsc") },
                  { value: "-merit_position", label: t("results.rankDesc") },
                ]}
                className="md:w-56"
              />
            </>
          )}
        />
        {list === null ? (
          <ListRowsLoading label={t("list.updating")} />
        ) : list.results.length ? (
          <DataTable
            caption={t("results.title")}
            rows={rows}
            rowKey={rowKey}
            columns={columns}
            ordering={state.ordering}
            onSort={(ordering) => update({ ordering })}
            busy={pending}
            mobileTitle={(row) => <StudentCell row={row} />}
            actions={(row) => (
              <span className="inline-flex gap-1">
                {userId !== row.user_id && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => update({ filters: { user: String(row.user_id) } })}
                    aria-label={t("results.studentResults", { name: row.user_full_name })}
                    title={t("results.studentResults", { name: row.user_full_name })}
                    data-row-action="student"
                  >
                    <UserRound aria-hidden />
                  </Button>
                )}
                <Button asChild variant="ghost" size="icon">
                  <Link
                    href={`/results/${row.attempt_id}`}
                    aria-label={t("results.openLabel", { name: row.user_full_name })}
                    title={t("results.openLabel", { name: row.user_full_name })}
                    data-row-action="open"
                  >
                    <ExternalLink aria-hidden />
                  </Link>
                </Button>
              </span>
            )}
          />
        ) : filtered ? (
          <EmptyState title={t("results.noMatch")} description={t("results.noMatchHint")} />
        ) : (
          <EmptyState title={t("results.empty")} description={t("results.emptyHint")} />
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

      <ExamPicker
        open={picking}
        onOpenChange={setPicking}
        onSelect={(exam) => {
          setPicking(false);
          update({ filters: { exam: String(exam.id) } });
        }}
      />
    </div>
  );
}

/** The chosen exam's result controls. Publish/hide answer with the exam (so its server
 * `results_visible` updates in place); merit generation re-reads the result rows. */
function ExamContext({ exam: initial, onMeritGenerated }: { exam: Exam; onMeritGenerated: () => void }) {
  const { locale, t } = useI18n();
  const [exam, setExam] = useState(initial);
  const title = examTitle(exam, locale);
  return (
    <ExamResults
      exam={exam}
      onExamChange={setExam}
      onMeritGenerated={onMeritGenerated}
      title={`${t("resultsExam.title")}: ${title.text || `#${exam.id}`}`}
      link={
        <Link
          href={`/exams/${exam.id}`}
          className="rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-600"
        >
          {t("resultsExam.openExam")}
        </Link>
      }
    />
  );
}

function FilterChip({
  prefix,
  label,
  clearLabel,
  onClear,
  extra,
}: {
  prefix: string;
  label: string;
  clearLabel: string;
  onClear: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-brand-600/40 bg-brand-50 py-0.5 pr-1 pl-3 text-sm text-ink">
      <span className="min-w-0 truncate">
        <span className="text-ink-muted">{prefix}: </span>
        <span className="font-medium">{label}</span>
      </span>
      {extra}
      <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={onClear} aria-label={clearLabel} title={clearLabel}>
        <X aria-hidden />
      </Button>
    </span>
  );
}

/** Student name (linked to the result) and attempt number. */
function StudentCell({ row }: { row: AdminResult }) {
  const { locale, t } = useI18n();
  return (
    <Link href={`/results/${row.attempt_id}`} className="group block min-w-0 rounded-control">
      <span className="block font-medium break-words text-ink group-hover:text-brand-700 group-hover:underline">
        {row.user_full_name}
      </span>
      <span className="block text-xs text-ink-subtle">
        {t("results.attemptNo", { n: formatNumber(row.attempt_no, locale) })}
      </span>
    </Link>
  );
}

const rowKey = (row: AdminResult) => row.attempt_id;
