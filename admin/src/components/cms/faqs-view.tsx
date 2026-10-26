"use client";

import { Plus } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { ActiveBadge, BilingualName, RowActions, statusFilterOptions } from "@/components/content/catalog-cells";
import { ListRowsLoading } from "@/components/content/list-skeleton";
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
import { FAQ_LIST } from "@/lib/content-specs";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { activeFilterCount, type ListState } from "@/lib/list-params";
import { localized } from "@/lib/localized";
import { useListData } from "@/lib/use-list-data";
import { useListUrl } from "@/lib/use-list-url";
import type { Faq } from "@/types/cms";
import type { Paginated } from "@/types/content";

import { CmsFormDialog } from "./cms-form-dialog";

/** FAQ entries for the website: URL-driven list (search, active filter, sort order);
 * create/edit in a dialog, delete after a confirmation. Only active entries are public. */
export function FaqsView({ data, state: serverState }: { data: Paginated<Faq>; state: ListState }) {
  const { locale, t } = useI18n();
  const { notify } = useToast();
  const { state, key: urlKey, update, pending: navigating } = useListUrl(FAQ_LIST);
  const goToFirstPage = useCallback(() => update({ page: 1 }, { replace: true }), [update]);
  const { data: list, reload, reloading, identity } = useListData({
    serverData: data,
    serverState,
    urlKey,
    apiPath: "/admin/faqs/",
    onPageGone: goToFirstPage,
  });
  const rows = list?.results ?? [];
  const pending = navigating || reloading;
  const createRef = useRef<HTMLButtonElement>(null);
  const rememberDeleted = useDeleteFocus(rows, rowId, createRef);
  const [editing, setEditing] = useState<Faq | "new" | null>(null);
  const [deleting, setDeleting] = useState<Faq | null>(null);
  const filtered = Boolean(state.search) || activeFilterCount(state) > 0;
  const nameOf = (row: Faq) => localized(locale, row.question_bn, row.question_en).text || `#${row.id}`;
  const title = (row: Faq) => <BilingualName bn={row.question_bn} en={row.question_en} />;

  const columns: Column<Faq>[] = [
    { key: "title", header: t("faqs.colQuestion"), hideOnMobile: true, className: "min-w-64", cell: title },
    {
      key: "sort_order",
      header: t("field.sortOrder"),
      sortField: "sort_order",
      cell: (row) => <span className="tabular-nums">{formatNumber(row.sort_order, locale)}</span>,
    },
    { key: "status", header: t("field.status"), cell: (row) => <ActiveBadge active={row.is_active} /> },
    {
      key: "updated",
      header: t("field.updated"),
      sortField: "updated_at",
      sortFirst: "desc",
      className: "whitespace-nowrap",
      cell: (row) => <span className="text-ink-muted">{formatDateTime(row.updated_at, locale)}</span>,
    },
  ];

  async function remove(row: Faq) {
    await apiFetch(`/admin/faqs/${row.id}/`, { method: "DELETE" });
    rememberDeleted(row);
    setDeleting(null);
    notify(t("faqs.deleted"));
    void reload();
  }

  const createButton = (ref?: React.Ref<HTMLButtonElement>) => (
    <Button ref={ref} onClick={() => setEditing("new")}>
      <Plus aria-hidden />
      {t("faqs.new")}
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t("faqs.title")} subtitle={t("faqs.subtitle")} actions={createButton(createRef)} />
      <Card {...identity}>
        <FilterBar
          search={
            <SearchInput
              id="faqs-search"
              label={t("list.search")}
              placeholder={t("faqs.search")}
              value={state.search}
              onChange={(search) => update({ search }, { replace: true })}
            />
          }
          activeCount={activeFilterCount(state)}
          onClear={() => update({ search: "", filters: { is_active: "" } })}
          filters={(prefix) => (
            <FilterSelect
              id={`${prefix}-status`}
              label={t("field.status")}
              value={state.filters.is_active ?? ""}
              onChange={(value) => update({ filters: { is_active: value } })}
              options={statusFilterOptions(t)}
              className="md:w-44"
            />
          )}
        />
        {list === null ? (
          <ListRowsLoading label={t("list.updating")} />
        ) : list.results.length ? (
          <DataTable
            caption={t("faqs.title")}
            rows={rows}
            rowKey={rowId}
            columns={columns}
            ordering={state.ordering}
            onSort={(ordering) => update({ ordering })}
            busy={pending}
            mobileTitle={title}
            actions={(row) => (
              <RowActions
                editLabel={t("faqs.editLabel", { name: nameOf(row) })}
                deleteLabel={t("faqs.deleteLabel", { name: nameOf(row) })}
                onEdit={() => setEditing(row)}
                onDelete={() => setDeleting(row)}
              />
            )}
          />
        ) : filtered ? (
          <EmptyState title={t("faqs.noMatch")} description={t("faqs.noMatchHint")} />
        ) : (
          <EmptyState title={t("faqs.empty")} description={t("faqs.emptyHint")} action={createButton()} />
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

      {editing && (
        <CmsFormDialog
          key={editing === "new" ? "new" : editing.id}
          kind="faq"
          entry={editing === "new" ? null : editing}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          onSaved={(_, created) => {
            setEditing(null);
            notify(t(created ? "faqs.created" : "faqs.saved"));
            void reload();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title={t("faqs.deleteTitle")}
          description={t("faqs.deleteBody", { name: nameOf(deleting) })}
          confirmLabel={t("common.delete")}
          pendingLabel={t("common.deleting")}
          onConfirm={() => remove(deleting)}
          describe={(error) => describeDeleteError(error, t)}
        />
      )}
    </div>
  );
}

const rowId = (row: { id: number }) => row.id;
