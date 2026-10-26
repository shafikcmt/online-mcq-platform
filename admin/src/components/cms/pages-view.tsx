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
import { PAGE_LIST } from "@/lib/content-specs";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { activeFilterCount, type ListState } from "@/lib/list-params";
import { localized } from "@/lib/localized";
import { useListData } from "@/lib/use-list-data";
import { useListUrl } from "@/lib/use-list-url";
import type { CmsPage } from "@/types/cms";
import type { Paginated } from "@/types/content";

import { CmsFormDialog } from "./cms-form-dialog";

/** Static website pages (/pages/{slug}): URL-driven list (search slug/title, active
 * filter); create/edit in a dialog, delete after a confirmation. */
export function PagesView({ data, state: serverState }: { data: Paginated<CmsPage>; state: ListState }) {
  const { locale, t } = useI18n();
  const { notify } = useToast();
  const { state, key: urlKey, update, pending: navigating } = useListUrl(PAGE_LIST);
  const goToFirstPage = useCallback(() => update({ page: 1 }, { replace: true }), [update]);
  const { data: list, reload, reloading, identity } = useListData({
    serverData: data,
    serverState,
    urlKey,
    apiPath: "/admin/pages/",
    onPageGone: goToFirstPage,
  });
  const rows = list?.results ?? [];
  const pending = navigating || reloading;
  const createRef = useRef<HTMLButtonElement>(null);
  const rememberDeleted = useDeleteFocus(rows, rowId, createRef);
  const [editing, setEditing] = useState<CmsPage | "new" | null>(null);
  const [deleting, setDeleting] = useState<CmsPage | null>(null);
  const filtered = Boolean(state.search) || activeFilterCount(state) > 0;
  const nameOf = (row: CmsPage) => localized(locale, row.title_bn, row.title_en).text || row.slug;
  const title = (row: CmsPage) => <BilingualName bn={row.title_bn} en={row.title_en} />;

  const columns: Column<CmsPage>[] = [
    { key: "title", header: t("pages.colTitle"), hideOnMobile: true, className: "min-w-64", cell: title },
    {
      key: "slug",
      header: t("field.slug"),
      sortField: "slug",
      cell: (row) => <code className="text-[13px] break-all text-ink-muted">/pages/{row.slug}</code>,
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

  async function remove(row: CmsPage) {
    await apiFetch(`/admin/pages/${row.id}/`, { method: "DELETE" });
    rememberDeleted(row);
    setDeleting(null);
    notify(t("pages.deleted"));
    void reload();
  }

  const createButton = (ref?: React.Ref<HTMLButtonElement>) => (
    <Button ref={ref} onClick={() => setEditing("new")}>
      <Plus aria-hidden />
      {t("pages.new")}
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t("pages.title")} subtitle={t("pages.subtitle")} actions={createButton(createRef)} />
      <Card {...identity}>
        <FilterBar
          search={
            <SearchInput
              id="pages-search"
              label={t("list.search")}
              placeholder={t("pages.search")}
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
            caption={t("pages.title")}
            rows={rows}
            rowKey={rowId}
            columns={columns}
            ordering={state.ordering}
            onSort={(ordering) => update({ ordering })}
            busy={pending}
            mobileTitle={title}
            actions={(row) => (
              <RowActions
                editLabel={t("pages.editLabel", { name: nameOf(row) })}
                deleteLabel={t("pages.deleteLabel", { name: nameOf(row) })}
                onEdit={() => setEditing(row)}
                onDelete={() => setDeleting(row)}
              />
            )}
          />
        ) : filtered ? (
          <EmptyState title={t("pages.noMatch")} description={t("pages.noMatchHint")} />
        ) : (
          <EmptyState title={t("pages.empty")} description={t("pages.emptyHint")} action={createButton()} />
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
          kind="page"
          entry={editing === "new" ? null : editing}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          onSaved={(_, created) => {
            setEditing(null);
            notify(t(created ? "pages.created" : "pages.saved"));
            void reload();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title={t("pages.deleteTitle")}
          description={t("pages.deleteBody", { name: nameOf(deleting) })}
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
