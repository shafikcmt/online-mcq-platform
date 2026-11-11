"use client";

import { ExternalLink, FileText, Plus, Video } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { BilingualName, RowActions } from "@/components/content/catalog-cells";
import { ListRowsLoading } from "@/components/content/list-skeleton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, useDeleteFocus, type Column } from "@/components/ui/data-table";
import { FilterBar, FilterSelect, SearchInput } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { describeDeleteError } from "@/lib/content-errors";
import { MATERIAL_LIST } from "@/lib/content-specs";
import { useI18n } from "@/lib/i18n/provider";
import { activeFilterCount, type ListState } from "@/lib/list-params";
import { localized } from "@/lib/localized";
import { useListData } from "@/lib/use-list-data";
import { useListUrl } from "@/lib/use-list-url";
import type { Category, Paginated } from "@/types/content";
import { MATERIAL_KINDS, type Material, type MaterialState } from "@/types/materials";

import { MaterialFormDialog, type MaterialLookups } from "./material-form-dialog";

const STATE_TONE: Record<MaterialState, string> = { draft: "draft", scheduled: "pending", live: "active" };
const rowId = (row: { id: number }) => row.id;

/** Study materials: URL-driven list (type, category, publication, search, sort); create/edit in a
 * dialog, delete after a confirmation. A PDF material is attached inside the dialog. */
export function MaterialsView({ data, state: serverState, lookups }: { data: Paginated<Material>; state: ListState; lookups: MaterialLookups }) {
  const { locale, t } = useI18n();
  const { notify } = useToast();
  const { state, key: urlKey, update, pending: navigating } = useListUrl(MATERIAL_LIST);
  const goToFirstPage = useCallback(() => update({ page: 1 }, { replace: true }), [update]);
  const { data: list, reload, reloading, identity } = useListData({
    serverData: data,
    serverState,
    urlKey,
    apiPath: "/admin/materials/",
    onPageGone: goToFirstPage,
  });
  const rows = list?.results ?? [];
  const pending = navigating || reloading;
  const createRef = useRef<HTMLButtonElement>(null);
  const rememberDeleted = useDeleteFocus(rows, rowId, createRef);
  const [editing, setEditing] = useState<Material | "new" | null>(null);
  const [deleting, setDeleting] = useState<Material | null>(null);
  const filtered = Boolean(state.search) || activeFilterCount(state) > 0;
  const titleOf = (row: Material) => localized(locale, row.title_bn, row.title_en).text || t("mat.untitled");
  const categoryName = (category: Category) => localized(locale, category.name_bn, category.name_en).text;

  const title = (row: Material) => (
    <span className="flex items-start gap-2">
      {row.kind === "video" ? <Video className="mt-1 size-4 shrink-0 text-brand-700" aria-hidden /> : <FileText className="mt-1 size-4 shrink-0 text-brand-700" aria-hidden />}
      <BilingualName bn={row.title_bn} en={row.title_en} />
    </span>
  );

  const columns: Column<Material>[] = [
    { key: "title", header: t("mat.colTitle"), hideOnMobile: true, className: "min-w-64", cell: title },
    { key: "kind", header: t("mat.colKind"), cell: (row) => t(`mat.kind.${row.kind}`) },
    {
      key: "place",
      header: t("mat.colPlace"),
      cell: (row) => <span className="text-ink-muted">{[row.category_label, row.subject_label].filter(Boolean).join(" · ") || "—"}</span>,
    },
    { key: "teacher", header: t("mat.colTeacher"), cell: (row) => <span className="text-ink-muted">{row.teacher || "—"}</span> },
    { key: "state", header: t("mat.colState"), cell: (row) => <StatusBadge status={STATE_TONE[row.state]} label={t(`mat.state.${row.state}`)} className="whitespace-nowrap" /> },
  ];

  async function remove(row: Material) {
    await apiFetch(`/admin/materials/${row.id}/`, { method: "DELETE" });
    rememberDeleted(row);
    setDeleting(null);
    notify(t("mat.deleted"));
    void reload();
  }

  const createButton = (ref?: React.Ref<HTMLButtonElement>) => (
    <Button ref={ref} onClick={() => setEditing("new")}>
      <Plus aria-hidden />
      {t("mat.new")}
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t("mat.title")} subtitle={t("mat.subtitle")} actions={createButton(createRef)} />
      <Card {...identity}>
        <FilterBar
          search={<SearchInput id="materials-search" label={t("list.search")} placeholder={t("mat.search")} value={state.search} onChange={(search) => update({ search }, { replace: true })} />}
          activeCount={activeFilterCount(state)}
          onClear={() => update({ search: "", filters: { kind: "", category: "", published: "" } })}
          filters={(prefix) => (
            <>
              <FilterSelect
                id={`${prefix}-kind`}
                label={t("mat.kindFilter")}
                value={state.filters.kind ?? ""}
                onChange={(value) => update({ filters: { kind: value } })}
                options={[{ value: "", label: t("mat.allKinds") }, ...MATERIAL_KINDS.map((value) => ({ value, label: t(`mat.kind.${value}`) }))]}
                className="md:w-40"
              />
              <FilterSelect
                id={`${prefix}-category`}
                label={t("mat.categoryFilter")}
                value={state.filters.category ?? ""}
                onChange={(value) => update({ filters: { category: value } })}
                options={[{ value: "", label: t("mat.allCategories") }, ...lookups.categories.map((category) => ({ value: String(category.id), label: categoryName(category) }))]}
                className="md:w-52"
              />
              <FilterSelect
                id={`${prefix}-published`}
                label={t("mat.publishedFilter")}
                value={state.filters.published ?? ""}
                onChange={(value) => update({ filters: { published: value } })}
                options={[
                  { value: "", label: t("mat.anyPublication") },
                  { value: "true", label: t("mat.onlyPublished") },
                  { value: "false", label: t("mat.onlyDrafts") },
                ]}
                className="md:w-52"
              />
            </>
          )}
        />
        {list === null ? (
          <ListRowsLoading label={t("list.updating")} />
        ) : list.results.length ? (
          <DataTable
            caption={t("mat.title")}
            rows={rows}
            rowKey={rowId}
            columns={columns}
            ordering={state.ordering}
            onSort={(ordering) => update({ ordering })}
            busy={pending}
            mobileTitle={title}
            actions={(row) => (
              <span className="inline-flex items-center gap-1">
                {row.kind === "video" && row.watch_url && (
                  <a
                    href={row.watch_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${t("mat.openVideo")}: ${titleOf(row)}`}
                    title={t("mat.openVideo")}
                    className="inline-flex size-9 items-center justify-center rounded-control text-ink-muted hover:bg-neutral-100 hover:text-ink"
                  >
                    <ExternalLink className="size-4" aria-hidden />
                  </a>
                )}
                <RowActions
                  editLabel={t("mat.editLabel", { name: titleOf(row) })}
                  deleteLabel={t("mat.deleteLabel", { name: titleOf(row) })}
                  onEdit={() => setEditing(row)}
                  onDelete={() => setDeleting(row)}
                />
              </span>
            )}
          />
        ) : filtered ? (
          <EmptyState title={t("mat.noMatch")} description={t("mat.noMatchHint")} />
        ) : (
          <EmptyState title={t("mat.empty")} description={t("mat.emptyHint")} action={createButton()} />
        )}
        {list && <Pagination page={state.page} pageSize={state.pageSize} count={list.count} disabled={pending} onPage={(page) => update({ page })} onPageSize={(pageSize) => update({ pageSize })} />}
      </Card>

      {editing && (
        <MaterialFormDialog
          key={editing === "new" ? "new" : editing.id}
          item={editing === "new" ? null : editing}
          lookups={lookups}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          onPdfChanged={() => void reload()}
          onSaved={(saved, created) => {
            // A new PDF material stays open on its saved record, so the file can be attached right away.
            if (created && saved.kind === "pdf") setEditing(saved);
            else setEditing(null);
            notify(t(created ? "mat.created" : "mat.saved"));
            void reload();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title={t("mat.deleteTitle")}
          description={t("mat.deleteBody", { name: titleOf(deleting) })}
          confirmLabel={t("common.delete")}
          pendingLabel={t("common.deleting")}
          onConfirm={() => remove(deleting)}
          describe={(error) => describeDeleteError(error, t)}
        />
      )}
    </div>
  );
}
