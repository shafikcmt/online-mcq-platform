"use client";

import { BookOpenCheck, ExternalLink, UserRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { examTitle } from "@/components/exams/exam-cells";
import { ListRowsLoading } from "@/components/content/list-skeleton";
import { ExamPicker } from "@/components/results/exam-picker";
import type { ServerExam, ServerStudent } from "@/components/results/results-view";
import { StudentPicker } from "@/components/results/student-picker";
import { DateTimeText } from "@/components/ui/date-time";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar, FilterSelect } from "@/components/ui/filter-bar";
import { FilterChip } from "@/components/ui/filter-chip";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/states";
import { ATTEMPT_LIST } from "@/lib/content-specs";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { activeFilterCount, type ListState } from "@/lib/list-params";
import { localized } from "@/lib/localized";
import { useListData } from "@/lib/use-list-data";
import { useListUrl } from "@/lib/use-list-url";
import type { AdminAttempt } from "@/types/attempts";
import type { Paginated } from "@/types/content";

import { AttemptState, ResultState } from "./attempt-cells";

/** Attempts list (read-only monitoring). Same URL-driven list state as the other lists:
 * the server filters, sorts and pages. Exams and students are chosen with the bounded
 * pickers (never a full catalogue); the chips name them from the server's reads. Status,
 * overdue and result state are the server's — never derived here. No answers. */
export function AttemptsView({
  data,
  state: serverState,
  exam: serverExam,
  student: serverStudent,
}: {
  data: Paginated<AdminAttempt>;
  state: ListState;
  exam: ServerExam | null;
  student: ServerStudent | null;
}) {
  const { locale, t } = useI18n();
  const { state, key: urlKey, update, pending: navigating } = useListUrl(ATTEMPT_LIST);
  const goToFirstPage = useCallback(() => update({ page: 1 }, { replace: true }), [update]);
  const { data: list, reloading, identity } = useListData({
    serverData: data,
    serverState,
    urlKey,
    apiPath: "/admin/attempts/",
    onPageGone: goToFirstPage,
  });
  const [pickingExam, setPickingExam] = useState(false);
  const [pickingStudent, setPickingStudent] = useState(false);
  const rows = list?.results ?? [];
  const pending = navigating || reloading;
  const filtered = activeFilterCount(state) > 0;

  const examId = state.filters.exam ? Number(state.filters.exam) : null;
  const userId = state.filters.user ? Number(state.filters.user) : null;
  // Chip names come from the server page's reads of the URL's ids only (never stale).
  const examContext = examId !== null && serverExam?.id === examId ? serverExam.exam : null;
  const studentName = userId !== null && serverStudent?.id === userId ? (serverStudent.user?.full_name ?? null) : null;

  const examName = (row: AdminAttempt) => {
    const title = localized(locale, row.exam_title_bn, row.exam_title_en);
    return { text: title.text || `#${row.exam_id}`, lang: title.lang };
  };
  const time = (iso: string | null) =>
    iso ? <span className="text-ink-muted"><DateTimeText iso={iso} /></span> : <span className="text-ink-subtle">{t("attempts.notSubmitted")}</span>;

  const allColumns: Column<AdminAttempt>[] = [
    { key: "student", header: t("attempts.colStudent"), hideOnMobile: true, className: "min-w-36", cell: (row) => <StudentCell row={row} /> },
    {
      key: "exam",
      header: t("attempts.colExam"),
      className: "min-w-36",
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
            aria-label={t("attempts.examAttempts", { name: name.text })}
          >
            <span lang={name.lang}>{name.text}</span>
          </button>
        );
      },
    },
    { key: "status", header: t("attempts.colStatus"), cell: (row) => <AttemptState attempt={row} /> },
    {
      key: "started",
      header: t("attempts.colStarted"),
      sortField: "started_at",
      sortFirst: "desc",
      cell: (row) => (
        <span className="block">
          {time(row.started_at)}
          {/* The deadline under the start keeps the table within a laptop screen; sorting
              by deadline is in the Sort menu. */}
          <span className="mt-0.5 block text-[13px] text-ink-subtle">
            {t("attempts.deadlineAt", { time: formatDateTime(row.deadline_at, locale) })}
          </span>
        </span>
      ),
    },
    { key: "submitted", header: t("attempts.colSubmitted"), sortField: "submitted_at", sortFirst: "desc", cell: (row) => time(row.submitted_at) },
    { key: "result", header: t("attempts.colResult"), cell: (row) => <ResultState attempt={row} /> },
  ];
  // Filtered by one exam, every row has that exam (named in the chip).
  const columns = examId === null ? allColumns : allColumns.filter((column) => column.key !== "exam");

  return (
    <div className="space-y-6">
      <PageHeader title={t("attempts.title")} subtitle={t("attempts.subtitle")} />

      <div className="flex flex-wrap items-center gap-2" aria-label={t("list.filters")} role="group">
        {examId === null ? (
          <Button variant="secondary" onClick={() => setPickingExam(true)} aria-haspopup="dialog">
            <BookOpenCheck aria-hidden />
            {t("results.chooseExam")}
          </Button>
        ) : (
          <FilterChip
            label={examContext ? examTitle(examContext, locale).text || `#${examId}` : `#${examId}`}
            prefix={t("results.examFilter")}
            clearLabel={t("results.clearExam")}
            onClear={() => update({ filters: { exam: "" } })}
            extra={
              <Button variant="ghost" size="sm" onClick={() => setPickingExam(true)} aria-haspopup="dialog">
                {t("results.changeExam")}
              </Button>
            }
          />
        )}
        {userId === null ? (
          <Button variant="secondary" onClick={() => setPickingStudent(true)} aria-haspopup="dialog">
            <UserRound aria-hidden />
            {t("results.chooseStudent")}
          </Button>
        ) : (
          <FilterChip
            label={studentName ?? t("results.studentUnknown", { id: userId })}
            prefix={t("results.studentFilter")}
            clearLabel={t("results.clearStudent")}
            onClear={() => update({ filters: { user: "" } })}
            extra={
              <Button variant="ghost" size="sm" onClick={() => setPickingStudent(true)} aria-haspopup="dialog">
                {t("results.changeStudent")}
              </Button>
            }
          />
        )}
      </div>

      <Card {...identity}>
        <FilterBar
          activeCount={activeFilterCount(state)}
          onClear={() => update({ filters: { exam: "", user: "", status: "", overdue: "", has_result: "" } })}
          filters={(prefix) => (
            <>
              <FilterSelect
                id={`${prefix}-status`}
                label={t("attempts.statusFilter")}
                value={state.filters.status ?? ""}
                onChange={(value) => update({ filters: { status: value } })}
                options={[
                  { value: "", label: t("attempts.allStatuses") },
                  { value: "in_progress", label: t("resultStatus.in_progress") },
                  { value: "submitted", label: t("resultStatus.submitted") },
                  { value: "auto_submitted", label: t("resultStatus.auto_submitted") },
                ]}
                className="md:w-52"
              />
              <FilterSelect
                id={`${prefix}-overdue`}
                label={t("attempts.overdueFilter")}
                value={state.filters.overdue ?? ""}
                onChange={(value) => update({ filters: { overdue: value } })}
                options={[
                  { value: "", label: t("attempts.allTiming") },
                  { value: "true", label: t("attempts.overdueOnly") },
                  { value: "false", label: t("attempts.notOverdue") },
                ]}
                className="md:w-44"
              />
              <FilterSelect
                id={`${prefix}-result`}
                label={t("attempts.resultFilter")}
                value={state.filters.has_result ?? ""}
                onChange={(value) => update({ filters: { has_result: value } })}
                options={[
                  { value: "", label: t("attempts.allResults") },
                  { value: "true", label: t("attempts.withResult") },
                  { value: "false", label: t("attempts.withoutResult") },
                ]}
                className="md:w-52"
              />
              <FilterSelect
                id={`${prefix}-ordering`}
                label={t("list.sort")}
                value={state.ordering}
                onChange={(ordering) => update({ ordering })}
                options={[
                  { value: "-started_at", label: t("attempts.newestFirst") },
                  { value: "started_at", label: t("attempts.oldestFirst") },
                  { value: "deadline_at", label: t("attempts.deadlineSoonest") },
                  { value: "-deadline_at", label: t("attempts.deadlineLatest") },
                  { value: "-submitted_at", label: t("attempts.submittedNewest") },
                  { value: "submitted_at", label: t("attempts.submittedOldest") },
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
            caption={t("attempts.title")}
            rows={rows}
            rowKey={(row) => row.attempt_id}
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
                    aria-label={t("attempts.studentAttempts", { name: row.user_full_name })}
                    title={t("attempts.studentAttempts", { name: row.user_full_name })}
                    data-row-action="student"
                  >
                    <UserRound aria-hidden />
                  </Button>
                )}
                <Button asChild variant="ghost" size="icon">
                  <Link
                    href={`/attempts/${row.attempt_id}`}
                    aria-label={t("attempts.openLabel", { name: row.user_full_name })}
                    title={t("attempts.openLabel", { name: row.user_full_name })}
                    data-row-action="open"
                  >
                    <ExternalLink aria-hidden />
                  </Link>
                </Button>
              </span>
            )}
          />
        ) : filtered ? (
          <EmptyState title={t("attempts.noMatch")} description={t("attempts.noMatchHint")} />
        ) : (
          <EmptyState title={t("attempts.empty")} description={t("attempts.emptyHint")} />
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
        open={pickingExam}
        onOpenChange={setPickingExam}
        onSelect={(exam) => {
          setPickingExam(false);
          update({ filters: { exam: String(exam.id) } });
        }}
      />
      <StudentPicker
        open={pickingStudent}
        onOpenChange={setPickingStudent}
        onSelect={(user) => {
          setPickingStudent(false);
          update({ filters: { user: String(user.id) } });
        }}
      />
    </div>
  );
}

/** Student name (linked to the attempt) and attempt number. */
function StudentCell({ row }: { row: AdminAttempt }) {
  const { locale, t } = useI18n();
  return (
    <Link href={`/attempts/${row.attempt_id}`} className="group block min-w-0 rounded-control">
      <span className="block font-medium break-words text-ink group-hover:text-brand-700 group-hover:underline">
        {row.user_full_name}
      </span>
      <span className="block text-xs text-ink-subtle">{t("results.attemptNo", { n: formatNumber(row.attempt_no, locale) })}</span>
    </Link>
  );
}
