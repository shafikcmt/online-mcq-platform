"use client";

import { Mail, MessageSquareText, Phone } from "lucide-react";
import { useCallback, useState } from "react";

import { ListRowsLoading } from "@/components/content/list-skeleton";
import { DateTimeText } from "@/components/ui/date-time";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar, FilterSelect, SearchInput } from "@/components/ui/filter-bar";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { describeError } from "@/lib/api/errors";
import { CONTACT_LIST } from "@/lib/content-specs";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { activeFilterCount, type ListState } from "@/lib/list-params";
import { useListData } from "@/lib/use-list-data";
import { useListUrl } from "@/lib/use-list-url";
import { CONTACT_STATUSES, type ContactMessage, type ContactStatus } from "@/types/cms";
import type { Paginated } from "@/types/content";

const STATUS_TONE: Record<ContactStatus, string> = { new: "pending", read: "draft", resolved: "success" };

export function ContactStatusBadge({ status }: { status: ContactStatus }) {
  const { t } = useI18n();
  return <StatusBadge status={STATUS_TONE[status]} label={t(`contactStatus.${status}`)} className="whitespace-nowrap" />;
}

/** Contact inbox (website contact form). The sender's phone and e-mail are shown in full
 * on purpose — the admin needs them to reply; the server never sends the sender's IP.
 * The only change is the status (new → read → resolved, or back to new); nothing can be
 * deleted or edited. Opening a message does not change its status by itself. */
export function ContactMessagesView({ data, state: serverState }: { data: Paginated<ContactMessage>; state: ListState }) {
  const { t } = useI18n();
  const { state, key: urlKey, update, pending: navigating } = useListUrl(CONTACT_LIST);
  const goToFirstPage = useCallback(() => update({ page: 1 }, { replace: true }), [update]);
  const { data: list, reload, reloading, identity } = useListData({
    serverData: data,
    serverState,
    urlKey,
    apiPath: "/admin/contact-messages/",
    onPageGone: goToFirstPage,
  });
  const rows = list?.results ?? [];
  const pending = navigating || reloading;
  const [open, setOpen] = useState<ContactMessage | null>(null);
  const filtered = Boolean(state.search) || activeFilterCount(state) > 0;

  const from = (row: ContactMessage) => (
    <button
      type="button"
      onClick={() => setOpen(row)}
      className="block min-w-0 rounded-control text-left"
      aria-label={t("contact.open", { name: row.name })}
      aria-haspopup="dialog"
    >
      <span className={`block break-words text-ink hover:text-brand-700 hover:underline ${row.status === "new" ? "font-semibold" : "font-medium"}`}>{row.name}</span>
      <span className="block text-xs break-all text-ink-subtle">{row.email || row.phone}</span>
    </button>
  );

  const columns: Column<ContactMessage>[] = [
    { key: "from", header: t("contact.colFrom"), hideOnMobile: true, className: "min-w-48", cell: from },
    {
      key: "subject",
      header: t("contact.colSubject"),
      className: "min-w-56",
      cell: (row) => <span className="line-clamp-2 break-words">{row.subject || <span className="text-ink-subtle">{t("contact.noSubject")}</span>}</span>,
    },
    { key: "status", header: t("contact.colStatus"), sortField: "status", cell: (row) => <ContactStatusBadge status={row.status} /> },
    {
      key: "received",
      header: t("contact.colReceived"),
      sortField: "created_at",
      sortFirst: "desc",
      className: "whitespace-nowrap",
      cell: (row) => <span className="text-ink-muted"><DateTimeText iso={row.created_at} /></span>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("contact.title")} subtitle={t("contact.subtitle")} />
      <Card {...identity}>
        <FilterBar
          search={
            <SearchInput
              id="contact-search"
              label={t("list.search")}
              placeholder={t("contact.search")}
              value={state.search}
              onChange={(search) => update({ search }, { replace: true })}
            />
          }
          activeCount={activeFilterCount(state)}
          onClear={() => update({ search: "", filters: { status: "", language: "" } })}
          filters={(prefix) => (
            <>
              <FilterSelect
                id={`${prefix}-status`}
                label={t("contact.statusFilter")}
                value={state.filters.status ?? ""}
                onChange={(value) => update({ filters: { status: value } })}
                options={[{ value: "", label: t("contact.allStatuses") }, ...CONTACT_STATUSES.map((value) => ({ value, label: t(`contactStatus.${value}`) }))]}
                className="md:w-44"
              />
              <FilterSelect
                id={`${prefix}-language`}
                label={t("contact.languageFilter")}
                value={state.filters.language ?? ""}
                onChange={(value) => update({ filters: { language: value } })}
                options={[
                  { value: "", label: t("contact.allLanguages") },
                  { value: "bn", label: t("language.bn") },
                  { value: "en", label: t("language.en") },
                ]}
                className="md:w-44"
              />
            </>
          )}
        />
        {list === null ? (
          <ListRowsLoading label={t("list.updating")} />
        ) : list.results.length ? (
          <DataTable
            caption={t("contact.title")}
            rows={rows}
            rowKey={(row) => row.id}
            columns={columns}
            ordering={state.ordering}
            onSort={(ordering) => update({ ordering })}
            busy={pending}
            mobileTitle={from}
            actions={(row) => (
              <Button variant="ghost" size="icon" onClick={() => setOpen(row)} aria-label={t("contact.open", { name: row.name })} title={t("contact.open", { name: row.name })} aria-haspopup="dialog">
                <MessageSquareText aria-hidden />
              </Button>
            )}
          />
        ) : filtered ? (
          <EmptyState title={t("contact.noMatch")} description={t("contact.noMatchHint")} />
        ) : (
          <EmptyState title={t("contact.empty")} description={t("contact.emptyHint")} />
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

      {open && (
        <ContactMessageDialog
          key={open.id}
          message={open}
          onClose={() => setOpen(null)}
          onChanged={(next) => {
            setOpen(next);
            void reload();
          }}
        />
      )}
    </div>
  );
}

/** One message in full, with the sender's contact details and the status actions. */
function ContactMessageDialog({
  message,
  onClose,
  onChanged,
}: {
  message: ContactMessage;
  onClose: () => void;
  onChanged: (message: ContactMessage) => void;
}) {
  const { locale, t } = useI18n();
  const { notify } = useToast();
  const [busy, setBusy] = useState<ContactStatus | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function setStatus(status: ContactStatus) {
    setBusy(status);
    setFailure(null);
    try {
      const next = await apiFetch<ContactMessage>(`/admin/contact-messages/${message.id}/`, { method: "PATCH", body: { status } });
      notify(t("contact.statusChanged", { status: t(`contactStatus.${next.status}`) }));
      onChanged(next);
    } catch (error) {
      setFailure(describeError(error, t));
    } finally {
      setBusy(null);
    }
  }

  const actions: { status: ContactStatus; label: string; variant: "primary" | "secondary" }[] = [
    ...(message.status === "new" ? [{ status: "read" as const, label: t("contact.markRead"), variant: "secondary" as const }] : []),
    ...(message.status !== "resolved" ? [{ status: "resolved" as const, label: t("contact.markResolved"), variant: "primary" as const }] : []),
    ...(message.status !== "new" ? [{ status: "new" as const, label: t("contact.markNew"), variant: "secondary" as const }] : []),
  ];

  return (
    <Modal
      open
      onOpenChange={(next) => !next && onClose()}
      title={t("contact.dialogTitle", { name: message.name })}
      description={t("contact.received", { when: formatDateTime(message.created_at, locale), language: t(`language.${message.language}`) })}
      size="lg"
      closeDisabled={busy !== null}
      footer={
        <>
          {actions.map((action) => (
            <Button key={action.status} variant={action.variant} onClick={() => setStatus(action.status)} disabled={busy !== null} aria-busy={busy === action.status || undefined}>
              {action.label}
            </Button>
          ))}
        </>
      }
    >
      <div className="space-y-5">
        {failure && (
          <p role="alert" className="rounded-control border border-danger-700/25 bg-danger-50 px-3 py-2.5 text-sm text-danger-700">
            {failure}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <ContactStatusBadge status={message.status} />
          {message.phone && (
            <a href={`tel:${message.phone}`} className="inline-flex items-center gap-1.5 rounded-control text-brand-700 hover:underline" aria-label={`${t("contact.phone")}: ${message.phone}`}>
              <Phone className="size-4" aria-hidden />
              <span className="tabular-nums">{message.phone}</span>
            </a>
          )}
          {message.email && (
            <a href={`mailto:${message.email}`} className="inline-flex items-center gap-1.5 rounded-control break-all text-brand-700 hover:underline" aria-label={`${t("contact.email")}: ${message.email}`}>
              <Mail className="size-4" aria-hidden />
              {message.email}
            </a>
          )}
        </div>
        <section className="space-y-2">
          <h3 className="text-[15px] font-semibold break-words text-ink" lang={message.language}>
            {message.subject || t("contact.noSubject")}
          </h3>
          <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-ink" lang={message.language}>
            {message.message}
          </p>
        </section>
        {message.handled_by && <p className="text-[13px] text-ink-subtle">{t("contact.handledBy", { name: message.handled_by.full_name })}</p>}
      </div>
    </Modal>
  );
}
