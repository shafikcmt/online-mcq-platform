"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import { DateTimeText } from "@/components/ui/date-time";
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
import { CATEGORY_LIST } from "@/lib/content-specs";
import { formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { activeFilterCount, type ListState } from "@/lib/list-params";
import { localized } from "@/lib/localized";
import { useListData } from "@/lib/use-list-data";
import { useListUrl } from "@/lib/use-list-url";
import type { Category, Paginated } from "@/types/content";

import { ListRowsLoading } from "./list-skeleton";
import { ActiveBadge, BilingualName, RowActions, statusFilterOptions } from "./catalog-cells";
import { CatalogFormDialog } from "./catalog-form-dialog";

export function CategoriesView({ data, state: serverState }: { data: Paginated<Category>; state: ListState }) {
  const { locale, t } = useI18n();
  const { notify } = useToast();
  const { state, key: urlKey, update, pending: navigating } = useListUrl(CATEGORY_LIST);
  const goToFirstPage = useCallback(() => update({ page: 1 }, { replace: true }), [update]);
  const { data: list, reload, reloading, identity } = useListData({
    serverData: data,
    serverState,
    urlKey,
    apiPath: "/admin/categories/",
    onPageGone: goToFirstPage,
  });
  const rows = list?.results ?? [];
  const pending = navigating || reloading;
  const createRef = useRef<HTMLButtonElement>(null);
  const rememberDeleted = useDeleteFocus(rows, rowId, createRef);
  // `editing`: null = closed, "new" = create, else the record being edited.
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const filtered = Boolean(state.search) || activeFilterCount(state) > 0;
  const nameOf = (category: Category) => localized(locale, category.name_bn, category.name_en).text;

  const columns: Column<Category>[] = [
    {
      key: "name",
      header: t("field.name"),
      sortField: locale === "bn" ? "name_bn" : "name_en",
      hideOnMobile: true,
      className: "min-w-56",
      cell: (row) => <BilingualName bn={row.name_bn} en={row.name_en} />,
    },
    {
      key: "slug",
      header: t("field.slug"),
      cell: (row) => <code className="text-[13px] break-all text-ink-muted">{row.slug}</code>,
    },
    {
      key: "subjects",
      header: t("categories.subjects"),
      cell: (row) => (
        <Link
          href={`/subjects?category=${row.id}`}
          className="font-medium text-brand-700 underline-offset-2 hover:underline"
          aria-label={t("categories.viewSubjects", { name: nameOf(row) })}
        >
          {formatNumber(row.subject_count, locale)}
        </Link>
      ),
    },
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
      cell: (row) => <span className="text-ink-muted"><DateTimeText iso={row.updated_at} /></span>,
    },
  ];

  async function remove(category: Category) {
    await apiFetch(`/admin/categories/${category.id}/`, { method: "DELETE" });
    rememberDeleted(category); // focus moves to a neighbouring row once the new page renders
    setDeleting(null);
    notify(t("categories.deleted"));
    void reload(); // the row disappears only after the server confirmed the delete
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("categories.title")}
        subtitle={t("categories.subtitle")}
        actions={
          <Button ref={createRef} onClick={() => setEditing("new")}>
            <Plus aria-hidden />
            {t("categories.new")}
          </Button>
        }
      />
      <Card {...identity}>
        <FilterBar
          search={
            <SearchInput
              id="categories-search"
              label={t("list.search")}
              placeholder={t("categories.search")}
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
            caption={t("categories.title")}
            rows={rows}
            rowKey={rowId}
            columns={columns}
            ordering={state.ordering}
            onSort={(ordering) => update({ ordering })}
            busy={pending}
            mobileTitle={(row) => <BilingualName bn={row.name_bn} en={row.name_en} />}
            actions={(row) => (
              <RowActions
                editLabel={t("categories.editLabel", { name: nameOf(row) })}
                deleteLabel={t("categories.deleteLabel", { name: nameOf(row) })}
                onEdit={() => setEditing(row)}
                onDelete={() => setDeleting(row)}
              />
            )}
          />
        ) : filtered ? (
          <EmptyState title={t("categories.noMatch")} description={t("categories.noMatchHint")} />
        ) : (
          <EmptyState
            title={t("categories.empty")}
            description={t("categories.emptyHint")}
            action={
              <Button onClick={() => setEditing("new")}>
                <Plus aria-hidden />
                {t("categories.new")}
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

      {editing && (
        <CatalogFormDialog
          key={editing === "new" ? "new" : editing.id}
          kind="category"
          entry={editing === "new" ? null : editing}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          onSaved={(_, created) => {
            setEditing(null);
            notify(t(created ? "categories.created" : "categories.saved"));
            void reload();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title={t("categories.deleteTitle")}
          description={t("categories.deleteBody", { name: nameOf(deleting) })}
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
