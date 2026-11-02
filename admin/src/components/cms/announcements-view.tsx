"use client";

import { Pin, Plus } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { BilingualName, RowActions } from "@/components/content/catalog-cells";
import { ListRowsLoading } from "@/components/content/list-skeleton";
import { DateTimeText } from "@/components/ui/date-time";
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
import { ANNOUNCEMENT_LIST } from "@/lib/content-specs";
import { useI18n } from "@/lib/i18n/provider";
import { activeFilterCount, type ListState } from "@/lib/list-params";
import { localized } from "@/lib/localized";
import { useListData } from "@/lib/use-list-data";
import { useListUrl } from "@/lib/use-list-url";
import { AUDIENCES, type Announcement, type AnnouncementState } from "@/types/cms";
import type { Paginated } from "@/types/content";

import { CmsFormDialog } from "./cms-form-dialog";

/** The server's computed state as a badge (tones shared with the other status badges). */
const STATE_TONE: Record<AnnouncementState, string> = { draft: "draft", scheduled: "pending", live: "active", expired: "archived" };

export function AnnouncementStateBadge({ state }: { state: AnnouncementState }) {
  const { t } = useI18n();
  return <StatusBadge status={STATE_TONE[state]} label={t(`announcementState.${state}`)} className="whitespace-nowrap" />;
}

/** Announcements (website and app notices): URL-driven list like the other content lists;
 * create/edit in a dialog, delete after a confirmation. The state (draft, scheduled, live,
 * ended) is the server's, computed from the publish window. */
export function AnnouncementsView({ data, state: serverState }: { data: Paginated<Announcement>; state: ListState }) {
  const { locale, t } = useI18n();
  const { notify } = useToast();
  const { state, key: urlKey, update, pending: navigating } = useListUrl(ANNOUNCEMENT_LIST);
  const goToFirstPage = useCallback(() => update({ page: 1 }, { replace: true }), [update]);
  const { data: list, reload, reloading, identity } = useListData({
    serverData: data,
    serverState,
    urlKey,
    apiPath: "/admin/announcements/",
    onPageGone: goToFirstPage,
  });
  const rows = list?.results ?? [];
  const pending = navigating || reloading;
  const createRef = useRef<HTMLButtonElement>(null);
  const rememberDeleted = useDeleteFocus(rows, rowId, createRef);
  const [editing, setEditing] = useState<Announcement | "new" | null>(null);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const filtered = Boolean(state.search) || activeFilterCount(state) > 0;
  const titleOf = (row: Announcement) => localized(locale, row.title_bn, row.title_en).text || t("cms.untitled");
  const time = (iso: string | null) => <span className="text-ink-muted">{iso ? <DateTimeText iso={iso} /> : "—"}</span>;

  const title = (row: Announcement) => (
    <span className="flex items-start gap-2">
      {row.is_pinned && <Pin className="mt-1 size-3.5 shrink-0 text-brand-700" aria-label={t("announcements.pinned")} />}
      <BilingualName bn={row.title_bn} en={row.title_en} />
    </span>
  );

  const columns: Column<Announcement>[] = [
    { key: "title", header: t("announcements.colTitle"), hideOnMobile: true, className: "min-w-64", cell: title },
    { key: "audience", header: t("announcements.colAudience"), cell: (row) => t(`audience.${row.audience}`) },
    { key: "state", header: t("announcements.colState"), cell: (row) => <AnnouncementStateBadge state={row.state} /> },
    { key: "published", header: t("announcements.colPublished"), sortField: "published_at", sortFirst: "desc", cell: (row) => time(row.published_at) },
    { key: "expires", header: t("announcements.colExpires"), sortField: "expires_at", cell: (row) => time(row.expires_at) },
  ];

  async function remove(row: Announcement) {
    await apiFetch(`/admin/announcements/${row.id}/`, { method: "DELETE" });
    rememberDeleted(row);
    setDeleting(null);
    notify(t("announcements.deleted"));
    void reload();
  }

  const createButton = (ref?: React.Ref<HTMLButtonElement>) => (
    <Button ref={ref} onClick={() => setEditing("new")}>
      <Plus aria-hidden />
      {t("announcements.new")}
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t("announcements.title")} subtitle={t("announcements.subtitle")} actions={createButton(createRef)} />
      <Card {...identity}>
        <FilterBar
          search={
            <SearchInput
              id="announcements-search"
              label={t("list.search")}
              placeholder={t("announcements.search")}
              value={state.search}
              onChange={(search) => update({ search }, { replace: true })}
            />
          }
          activeCount={activeFilterCount(state)}
          onClear={() => update({ search: "", filters: { audience: "", published: "", is_pinned: "" } })}
          filters={(prefix) => (
            <>
              <FilterSelect
                id={`${prefix}-audience`}
                label={t("announcements.audienceFilter")}
                value={state.filters.audience ?? ""}
                onChange={(value) => update({ filters: { audience: value } })}
                options={[{ value: "", label: t("announcements.allAudiences") }, ...AUDIENCES.map((value) => ({ value, label: t(`audience.${value}`) }))]}
                className="md:w-48"
              />
              <FilterSelect
                id={`${prefix}-published`}
                label={t("announcements.publishedFilter")}
                value={state.filters.published ?? ""}
                onChange={(value) => update({ filters: { published: value } })}
                options={[
                  { value: "", label: t("announcements.anyPublication") },
                  { value: "true", label: t("announcements.onlyPublished") },
                  { value: "false", label: t("announcements.onlyDrafts") },
                ]}
                className="md:w-52"
              />
              <FilterSelect
                id={`${prefix}-pinned`}
                label={t("announcements.pinnedFilter")}
                value={state.filters.is_pinned ?? ""}
                onChange={(value) => update({ filters: { is_pinned: value } })}
                options={[
                  { value: "", label: t("announcements.anyPinned") },
                  { value: "true", label: t("announcements.onlyPinned") },
                  { value: "false", label: t("announcements.notPinned") },
                ]}
                className="md:w-44"
              />
              <FilterSelect
                id={`${prefix}-ordering`}
                label={t("list.sort")}
                value={state.ordering}
                onChange={(ordering) => update({ ordering })}
                options={[
                  { value: "-created_at", label: t("announcements.newest") },
                  { value: "-published_at", label: t("announcements.publishedLatest") },
                  { value: "expires_at", label: t("announcements.expiresSoonest") },
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
            caption={t("announcements.title")}
            rows={rows}
            rowKey={rowId}
            columns={columns}
            ordering={state.ordering}
            onSort={(ordering) => update({ ordering })}
            busy={pending}
            mobileTitle={title}
            actions={(row) => (
              <RowActions
                editLabel={t("announcements.editLabel", { name: titleOf(row) })}
                deleteLabel={t("announcements.deleteLabel", { name: titleOf(row) })}
                onEdit={() => setEditing(row)}
                onDelete={() => setDeleting(row)}
              />
            )}
          />
        ) : filtered ? (
          <EmptyState title={t("announcements.noMatch")} description={t("announcements.noMatchHint")} />
        ) : (
          <EmptyState title={t("announcements.empty")} description={t("announcements.emptyHint")} action={createButton()} />
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
          kind="announcement"
          entry={editing === "new" ? null : editing}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          onSaved={(_, created) => {
            setEditing(null);
            notify(t(created ? "announcements.created" : "announcements.saved"));
            void reload();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title={t("announcements.deleteTitle")}
          description={t("announcements.deleteBody", { name: titleOf(deleting) })}
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
