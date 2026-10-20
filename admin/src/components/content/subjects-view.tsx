"use client";

import { Plus } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

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
import { SUBJECT_LIST } from "@/lib/content-specs";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { activeFilterCount, type ListState } from "@/lib/list-params";
import { localized } from "@/lib/localized";
import { useListData } from "@/lib/use-list-data";
import { useListUrl } from "@/lib/use-list-url";
import type { Category, Paginated, Subject } from "@/types/content";

import { ListRowsLoading } from "./list-skeleton";
import { ActiveBadge, BilingualName, RowActions, statusFilterOptions } from "./catalog-cells";
import { CatalogFormDialog } from "./catalog-form-dialog";

export function SubjectsView({
  data,
  state: serverState,
  categories,
  categoriesTruncated,
}: {
  data: Paginated<Subject>;
  state: ListState;
  /** All categories (one lookup request): names for the table, the filter and the form. */
  categories: Category[];
  categoriesTruncated: boolean;
}) {
  const { locale, t } = useI18n();
  const { notify } = useToast();
  const { state, key: urlKey, update, pending: navigating } = useListUrl(SUBJECT_LIST);
  const goToFirstPage = useCallback(() => update({ page: 1 }, { replace: true }), [update]);
  const { data: list, reload, reloading, identity } = useListData({
    serverData: data,
    serverState,
    urlKey,
    apiPath: "/admin/subjects/",
    onPageGone: goToFirstPage,
  });
  const rows = list?.results ?? [];
  const pending = navigating || reloading;
  const createRef = useRef<HTMLButtonElement>(null);
  const rememberDeleted = useDeleteFocus(rows, rowId, createRef);
  const [editing, setEditing] = useState<Subject | "new" | null>(null);
  const [deleting, setDeleting] = useState<Subject | null>(null);
  const filtered = Boolean(state.search) || activeFilterCount(state) > 0;
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const nameOf = (subject: Subject) => localized(locale, subject.name_bn, subject.name_en).text;
  const filterCategory = state.filters.category ? Number(state.filters.category) : undefined;

  function categoryName(id: number) {
    const category = categoryById.get(id);
    if (!category) return { text: t("subjects.unknownCategory", { id }), lang: locale };
    return localized(locale, category.name_bn, category.name_en);
  }

  const columns: Column<Subject>[] = [
    {
      key: "name",
      header: t("field.name"),
      sortField: locale === "bn" ? "name_bn" : "name_en",
      hideOnMobile: true,
      className: "min-w-52",
      cell: (row) => <BilingualName bn={row.name_bn} en={row.name_en} />,
    },
    {
      key: "category",
      header: t("subjects.category"),
      cell: (row) => {
        const name = categoryName(row.category);
        return (
          <span lang={name.lang} className="break-words">
            {name.text}
          </span>
        );
      },
    },
    {
      key: "slug",
      header: t("field.slug"),
      cell: (row) => <code className="text-[13px] break-all text-ink-muted">{row.slug}</code>,
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
      cell: (row) => <span className="text-ink-muted">{formatDateTime(row.updated_at, locale)}</span>,
    },
  ];

  const categoryOptions = [
    { value: "", label: t("subjects.allCategories") },
    ...categories.map((category) => ({
      value: String(category.id),
      label: localized(locale, category.name_bn, category.name_en).text,
    })),
  ];

  async function remove(subject: Subject) {
    await apiFetch(`/admin/subjects/${subject.id}/`, { method: "DELETE" });
    rememberDeleted(subject); // focus moves to a neighbouring row once the new page renders
    setDeleting(null);
    notify(t("subjects.deleted"));
    void reload();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("subjects.title")}
        subtitle={t("subjects.subtitle")}
        actions={
          <Button ref={createRef} onClick={() => setEditing("new")} disabled={!categories.length}>
            <Plus aria-hidden />
            {t("subjects.new")}
          </Button>
        }
      />
      {!categories.length && <Alert tone="info" title={t("subjects.noCategories")} />}
      {categoriesTruncated && (
        <Alert tone="warning">{t("subjects.lookupTruncated", { n: formatNumber(categories.length, locale) })}</Alert>
      )}
      <Card {...identity}>
        <FilterBar
          search={
            <SearchInput
              id="subjects-search"
              label={t("list.search")}
              placeholder={t("subjects.search")}
              value={state.search}
              onChange={(search) => update({ search }, { replace: true })}
            />
          }
          activeCount={activeFilterCount(state)}
          onClear={() => update({ search: "", filters: { is_active: "", category: "" } })}
          filters={(prefix) => (
            <>
              <FilterSelect
                id={`${prefix}-category`}
                label={t("subjects.category")}
                value={state.filters.category ?? ""}
                onChange={(value) => update({ filters: { category: value } })}
                options={categoryOptions}
                className="md:w-60"
              />
              <FilterSelect
                id={`${prefix}-status`}
                label={t("field.status")}
                value={state.filters.is_active ?? ""}
                onChange={(value) => update({ filters: { is_active: value } })}
                options={statusFilterOptions(t)}
                className="md:w-44"
              />
            </>
          )}
        />
        {list === null ? (
          <ListRowsLoading label={t("list.updating")} />
        ) : list.results.length ? (
          <DataTable
            caption={t("subjects.title")}
            rows={rows}
            rowKey={rowId}
            columns={columns}
            ordering={state.ordering}
            onSort={(ordering) => update({ ordering })}
            busy={pending}
            mobileTitle={(row) => <BilingualName bn={row.name_bn} en={row.name_en} />}
            actions={(row) => (
              <RowActions
                editLabel={t("subjects.editLabel", { name: nameOf(row) })}
                deleteLabel={t("subjects.deleteLabel", { name: nameOf(row) })}
                onEdit={() => setEditing(row)}
                onDelete={() => setDeleting(row)}
              />
            )}
          />
        ) : filtered ? (
          <EmptyState title={t("subjects.noMatch")} description={t("subjects.noMatchHint")} />
        ) : (
          <EmptyState
            title={t("subjects.empty")}
            description={t("subjects.emptyHint")}
            action={
              categories.length ? (
                <Button onClick={() => setEditing("new")}>
                  <Plus aria-hidden />
                  {t("subjects.new")}
                </Button>
              ) : undefined
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
          kind="subject"
          entry={editing === "new" ? null : editing}
          categories={categories}
          defaultCategory={filterCategory}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          onSaved={(_, created) => {
            setEditing(null);
            notify(t(created ? "subjects.created" : "subjects.saved"));
            void reload();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title={t("subjects.deleteTitle")}
          description={t("subjects.deleteBody", { name: nameOf(deleting) })}
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
