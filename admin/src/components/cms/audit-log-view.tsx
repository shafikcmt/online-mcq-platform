"use client";

import { FileSearch, History, UserRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { ListRowsLoading } from "@/components/content/list-skeleton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar, FilterSelect } from "@/components/ui/filter-bar";
import { FilterChip } from "@/components/ui/filter-chip";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/states";
import { AUDIT_LIST } from "@/lib/content-specs";
import { formatDateTime } from "@/lib/format";
import { en, type MessageKey } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/provider";
import { activeFilterCount, type ListState } from "@/lib/list-params";
import { useListData } from "@/lib/use-list-data";
import { useListUrl } from "@/lib/use-list-url";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, type AuditEntry } from "@/types/audit";
import type { Paginated } from "@/types/content";

type T = ReturnType<typeof useI18n>["t"];

/** A known code's label, else the code itself (a future action still shows). */
function label(t: T, prefix: "auditAction" | "auditEntity", code: string): string {
  const key = `${prefix}.${code}`;
  return key in en ? t(key as MessageKey) : code;
}

/** The panel page of a record, when it has one (payments are addressed by their public id,
 * which the log does not store; catalog and CMS records are edited in their lists). */
function recordHref(entry: AuditEntry): string | null {
  const id = /^\d+$/.test(entry.entity_id) ? entry.entity_id : null;
  if (entry.entity_type === "cms.sitesettings") return "/settings";
  if (!id) return null;
  const pages: Record<string, string> = {
    "accounts.user": "/users/",
    "questions.question": "/questions/",
    "exams.exam": "/exams/",
    "subscriptions.package": "/packages/",
    "subscriptions.subscription": "/subscriptions/",
  };
  return pages[entry.entity_type] ? `${pages[entry.entity_type]}${id}` : null;
}

/** The audit log, read-only: who changed what and when, newest first (the server's
 * order). Filters: action, record type, one record's history and one admin's changes —
 * all in the URL. Details show the server's allow-listed metadata and the IP address. */
export function AuditLogView({ data, state: serverState }: { data: Paginated<AuditEntry>; state: ListState }) {
  const { locale, t } = useI18n();
  const { state, key: urlKey, update, pending: navigating } = useListUrl(AUDIT_LIST);
  const goToFirstPage = useCallback(() => update({ page: 1 }, { replace: true }), [update]);
  const { data: list, reloading, identity } = useListData({
    serverData: data,
    serverState,
    urlKey,
    apiPath: "/admin/audit-logs/",
    onPageGone: goToFirstPage,
  });
  const rows = list?.results ?? [];
  const pending = navigating || reloading;
  const [details, setDetails] = useState<AuditEntry | null>(null);
  const filtered = activeFilterCount(state) > 0;
  const actorId = state.filters.actor ? Number(state.filters.actor) : null;
  const actorName = rows.find((row) => row.actor === actorId)?.actor_name ?? null;
  const who = (row: AuditEntry) => row.actor_name ?? t("audit.system");

  const columns: Column<AuditEntry>[] = [
    {
      key: "when",
      header: t("audit.colWhen"),
      hideOnMobile: true,
      className: "whitespace-nowrap",
      cell: (row) => <span className="text-ink-muted">{formatDateTime(row.created_at, locale)}</span>,
    },
    { key: "who", header: t("audit.colWho"), cell: (row) => <span className={row.actor ? "text-ink" : "text-ink-subtle"}>{who(row)}</span> },
    { key: "action", header: t("audit.colAction"), className: "min-w-44", cell: (row) => <span className="font-medium text-ink">{label(t, "auditAction", row.action)}</span> },
    {
      key: "record",
      header: t("audit.colRecord"),
      className: "min-w-56",
      cell: (row) => (
        <span className="block min-w-0">
          <span className="block text-xs text-ink-subtle">
            {label(t, "auditEntity", row.entity_type)} #{row.entity_id}
          </span>
          <span className="block break-words text-ink">{row.summary}</span>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("audit.title")} subtitle={t("audit.subtitle")} />

      {(actorId !== null || state.filters.entity_id) && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("list.filters")}>
          {actorId !== null && (
            <FilterChip
              label={actorName ?? t("audit.actorUnknown", { id: actorId })}
              prefix={t("audit.colWho")}
              clearLabel={t("audit.clearActor")}
              onClear={() => update({ filters: { actor: "" } })}
            />
          )}
          {state.filters.entity_id && (
            <FilterChip
              label={`${state.filters.entity_type ? label(t, "auditEntity", state.filters.entity_type) : ""} #${state.filters.entity_id}`.trim()}
              prefix={t("audit.colRecord")}
              clearLabel={t("audit.clearRecord")}
              onClear={() => update({ filters: { entity_id: "" } })}
            />
          )}
        </div>
      )}

      <Card {...identity}>
        <FilterBar
          activeCount={activeFilterCount(state)}
          onClear={() => update({ filters: { action: "", entity_type: "", entity_id: "", actor: "" } })}
          filters={(prefix) => (
            <>
              <FilterSelect
                id={`${prefix}-action`}
                label={t("audit.actionFilter")}
                value={state.filters.action ?? ""}
                onChange={(value) => update({ filters: { action: value } })}
                options={[{ value: "", label: t("audit.allActions") }, ...AUDIT_ACTIONS.map((value) => ({ value, label: label(t, "auditAction", value) }))]}
                className="md:w-64"
              />
              <FilterSelect
                id={`${prefix}-entity`}
                label={t("audit.entityFilter")}
                value={state.filters.entity_type ?? ""}
                onChange={(value) => update({ filters: { entity_type: value } })}
                options={[{ value: "", label: t("audit.allEntities") }, ...AUDIT_ENTITY_TYPES.map((value) => ({ value, label: label(t, "auditEntity", value) }))]}
                className="md:w-56"
              />
            </>
          )}
        />
        {list === null ? (
          <ListRowsLoading label={t("list.updating")} />
        ) : list.results.length ? (
          <DataTable
            caption={t("audit.title")}
            rows={rows}
            rowKey={(row) => row.id}
            columns={columns}
            busy={pending}
            mobileTitle={(row) => <span className="text-sm text-ink-muted">{formatDateTime(row.created_at, locale)}</span>}
            actions={(row) => (
              <span className="inline-flex gap-1">
                {row.actor !== null && actorId !== row.actor && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => update({ filters: { actor: String(row.actor) } })}
                    aria-label={t("audit.onlyActor", { name: who(row) })}
                    title={t("audit.onlyActor", { name: who(row) })}
                  >
                    <UserRound aria-hidden />
                  </Button>
                )}
                {/^\d+$/.test(row.entity_id) && state.filters.entity_id !== row.entity_id && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => update({ filters: { entity_type: row.entity_type, entity_id: row.entity_id } })}
                    aria-label={t("audit.recordHistory")}
                    title={t("audit.recordHistory")}
                  >
                    <History aria-hidden />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDetails(row)}
                  aria-label={t("audit.details", { id: row.id })}
                  title={t("audit.details", { id: row.id })}
                  aria-haspopup="dialog"
                >
                  <FileSearch aria-hidden />
                </Button>
              </span>
            )}
          />
        ) : filtered ? (
          <EmptyState title={t("audit.noMatch")} description={t("audit.noMatchHint")} />
        ) : (
          <EmptyState title={t("audit.empty")} description={t("audit.emptyHint")} />
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

      {details && (
        <Modal open onOpenChange={(open) => !open && setDetails(null)} title={t("audit.detailsTitle", { id: details.id })} description={formatDateTime(details.created_at, locale)} size="lg">
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
            <Item label={t("audit.colWho")}>{who(details)}</Item>
            <Item label={t("audit.colAction")}>{label(t, "auditAction", details.action)}</Item>
            <Item label={t("audit.colRecord")}>
              {label(t, "auditEntity", details.entity_type)} #{details.entity_id} — {details.summary}
              {recordHref(details) && (
                <Link href={recordHref(details)!} className="mt-1 block font-medium text-brand-700 hover:underline">
                  {t("audit.openRecord")}
                </Link>
              )}
            </Item>
            <Item label={t("audit.ip")}>{details.ip_address ?? <span className="text-ink-subtle">{t("audit.noIp")}</span>}</Item>
          </dl>
          <h3 className="mt-6 mb-2 text-sm font-semibold text-ink">{t("audit.metadata")}</h3>
          {Object.keys(details.metadata).length ? (
            // Plain text (React escapes it): the server's allow-listed values only.
            <pre className="max-h-80 overflow-auto rounded-control border border-line bg-neutral-50 p-3 text-xs leading-relaxed whitespace-pre-wrap break-words text-ink">
              {JSON.stringify(details.metadata, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-ink-subtle">{t("audit.noMetadata")}</p>
          )}
        </Modal>
      )}
    </div>
  );
}

function Item({ label: text, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-ink-subtle">{text}</dt>
      <dd className="mt-0.5 break-words text-ink">{children}</dd>
    </div>
  );
}
