"use client";

import { Plus } from "lucide-react";
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
import { GROUP_LIST } from "@/lib/content-specs";
import { formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { activeFilterCount, type ListState } from "@/lib/list-params";
import { localized } from "@/lib/localized";
import { useListData } from "@/lib/use-list-data";
import { useListUrl } from "@/lib/use-list-url";
import type { Category, ExamGroup, Paginated } from "@/types/content";

import { ListRowsLoading } from "./list-skeleton";
import { ActiveBadge, BilingualName, RowActions, statusFilterOptions } from "./catalog-cells";
import { GroupFormDialog } from "./group-form-dialog";

export function GroupsView({
  data,
  state: serverState,
  categories,
  groups,
  lookupTruncated,
}: {
  data: Paginated<ExamGroup>;
  state: ListState;
  /** All categories and all groups (lookups): names for the table and the filter, the form's menus. */
  categories: Category[];
  groups: ExamGroup[];
  lookupTruncated: boolean;
}) {
  const { locale, t } = useI18n();
  const { notify } = useToast();
  const { state, key: urlKey, update, pending: navigating } = useListUrl(GROUP_LIST);
  const goToFirstPage = useCallback(() => update({ page: 1 }, { replace: true }), [update]);
  const { data: list, reload, reloading, identity } = useListData({
    serverData: data,
    serverState,
    urlKey,
    apiPath: "/admin/groups/",
    onPageGone: goToFirstPage,
  });
  const rows = list?.results ?? [];
  const pending = navigating || reloading;
  const createRef = useRef<HTMLButtonElement>(null);
  const rememberDeleted = useDeleteFocus(rows, rowId, createRef);
  const [editing, setEditing] = useState<ExamGroup | "new" | null>(null);
  const [deleting, setDeleting] = useState<ExamGroup | null>(null);
  const filtered = Boolean(state.search) || activeFilterCount(state) > 0;
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const nameOf = (group: ExamGroup) => localized(locale, group.name_bn, group.name_en).text;
  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const filterCategory = state.filters.category ? Number(state.filters.category) : undefined;

  function categoryName(id: number) {
    const category = categoryById.get(id);
    if (!category) return { text: t("groups.unknownCategory", { id }), lang: locale };
    return localized(locale, category.name_bn, category.name_en);
  }

  const columns: Column<ExamGroup>[] = [
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
      header: t("groups.category"),
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
      key: "parent",
      header: t("groups.parent"),
      cell: (row) => {
        const parent = row.parent ? groupById.get(row.parent) : undefined;
        if (!parent) return <span className="text-ink-subtle">—</span>;
        const name = localized(locale, parent.name_bn, parent.name_en);
        return (
          <span lang={name.lang} className="break-words">
            {name.text}
          </span>
        );
      },
    },
    {
      key: "exams",
      header: t("groups.exams"),
      cell: (row) => <span className="tabular-nums">{formatNumber(row.exam_count, locale)}</span>,
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
      cell: (row) => <span className="text-ink-muted"><DateTimeText iso={row.updated_at} /></span>,
    },
  ];

  const categoryOptions = [
    { value: "", label: t("groups.allCategories") },
    ...categories.map((category) => ({
      value: String(category.id),
      label: localized(locale, category.name_bn, category.name_en).text,
    })),
  ];

  async function remove(group: ExamGroup) {
    await apiFetch(`/admin/groups/${group.id}/`, { method: "DELETE" });
    rememberDeleted(group); // focus moves to a neighbouring row once the new page renders
    setDeleting(null);
    notify(t("groups.deleted"));
    void reload();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("groups.title")}
        subtitle={t("groups.subtitle")}
        actions={
          <Button ref={createRef} onClick={() => setEditing("new")} disabled={!categories.length}>
            <Plus aria-hidden />
            {t("groups.new")}
          </Button>
        }
      />
      {!categories.length && <Alert tone="info" title={t("groups.noCategories")} />}
      {lookupTruncated && (
        <Alert tone="warning">{t("groups.lookupTruncated", { n: formatNumber(categories.length, locale) })}</Alert>
      )}
      <Card {...identity}>
        <FilterBar
          search={
            <SearchInput
              id="groups-search"
              label={t("list.search")}
              placeholder={t("groups.search")}
              value={state.search}
              onChange={(search) => update({ search }, { replace: true })}
            />
          }
          activeCount={activeFilterCount(state)}
          onClear={() => update({ search: "", filters: { is_active: "", category: "", parent: "" } })}
          filters={(prefix) => (
            <>
              <FilterSelect
                id={`${prefix}-category`}
                label={t("groups.category")}
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
            caption={t("groups.title")}
            rows={rows}
            rowKey={rowId}
            columns={columns}
            ordering={state.ordering}
            onSort={(ordering) => update({ ordering })}
            busy={pending}
            mobileTitle={(row) => <BilingualName bn={row.name_bn} en={row.name_en} />}
            actions={(row) => (
              <RowActions
                editLabel={t("groups.editLabel", { name: nameOf(row) })}
                deleteLabel={t("groups.deleteLabel", { name: nameOf(row) })}
                onEdit={() => setEditing(row)}
                onDelete={() => setDeleting(row)}
              />
            )}
          />
        ) : filtered ? (
          <EmptyState title={t("groups.noMatch")} description={t("groups.noMatchHint")} />
        ) : (
          <EmptyState
            title={t("groups.empty")}
            description={t("groups.emptyHint")}
            action={
              categories.length ? (
                <Button onClick={() => setEditing("new")}>
                  <Plus aria-hidden />
                  {t("groups.new")}
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
        <GroupFormDialog
          key={editing === "new" ? "new" : editing.id}
          entry={editing === "new" ? null : editing}
          categories={categories}
          groups={groups}
          defaultCategory={filterCategory}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          onSaved={(_, created) => {
            setEditing(null);
            notify(t(created ? "groups.created" : "groups.saved"));
            void reload();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title={t("groups.deleteTitle")}
          description={t("groups.deleteBody", { name: nameOf(deleting) })}
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
