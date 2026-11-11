"use client";

import { Plus } from "lucide-react";
import { useCallback, useId, useRef, useState, type FormEvent } from "react";

import { ActiveBadge, RowActions, statusFilterOptions } from "@/components/content/catalog-cells";
import { ListRowsLoading } from "@/components/content/list-skeleton";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, useDeleteFocus, type Column } from "@/components/ui/data-table";
import { FilterBar, FilterSelect, SearchInput } from "@/components/ui/filter-bar";
import { Field, FormErrors, Input, Switch } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { describeError } from "@/lib/api/errors";
import { isValidationError, mapFieldErrors, type MappedErrors } from "@/lib/api/field-errors";
import { describeDeleteError } from "@/lib/content-errors";
import { SAMPLE_PERSON_LIST } from "@/lib/content-specs";
import { formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { activeFilterCount, type ListState } from "@/lib/list-params";
import { useListData } from "@/lib/use-list-data";
import { useListUrl } from "@/lib/use-list-url";
import type { Paginated } from "@/types/content";
import { SAMPLE_NAME_MAX, type SamplePerson } from "@/types/sample";

const rowId = (row: { id: number }) => row.id;
const NO_ERRORS: MappedErrors = { fields: {}, form: [] };

/** The library of sample participants (invented names). Each can be added to exams with marks (exam page).
 * URL-driven list; create/edit in a dialog; delete after a confirmation (refused while in an exam). */
export function SamplePeopleView({ data, state: serverState }: { data: Paginated<SamplePerson>; state: ListState }) {
  const { locale, t } = useI18n();
  const { notify } = useToast();
  const { state, key: urlKey, update, pending: navigating } = useListUrl(SAMPLE_PERSON_LIST);
  const goToFirstPage = useCallback(() => update({ page: 1 }, { replace: true }), [update]);
  const { data: list, reload, reloading, identity } = useListData({
    serverData: data,
    serverState,
    urlKey,
    apiPath: "/admin/sample-participants/",
    onPageGone: goToFirstPage,
  });
  const rows = list?.results ?? [];
  const pending = navigating || reloading;
  const createRef = useRef<HTMLButtonElement>(null);
  const rememberDeleted = useDeleteFocus(rows, rowId, createRef);
  const [editing, setEditing] = useState<SamplePerson | "new" | null>(null);
  const [deleting, setDeleting] = useState<SamplePerson | null>(null);
  const filtered = Boolean(state.search) || activeFilterCount(state) > 0;

  const columns: Column<SamplePerson>[] = [
    { key: "name", header: t("sp.colName"), hideOnMobile: true, className: "min-w-56", sortField: "name", cell: (row) => <span className="font-medium break-words text-ink">{row.name}</span> },
    { key: "status", header: t("field.status"), cell: (row) => <ActiveBadge active={row.is_active} /> },
    { key: "exams", header: t("sp.colExams"), cell: (row) => <span className="tabular-nums">{formatNumber(row.exam_count, locale)}</span> },
  ];

  async function remove(row: SamplePerson) {
    await apiFetch(`/admin/sample-participants/${row.id}/`, { method: "DELETE" });
    rememberDeleted(row);
    setDeleting(null);
    notify(t("sp.deleted"));
    void reload();
  }

  const createButton = (ref?: React.Ref<HTMLButtonElement>) => (
    <Button ref={ref} onClick={() => setEditing("new")}>
      <Plus aria-hidden />
      {t("sp.new")}
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t("sp.title")} subtitle={t("sp.subtitle")} actions={createButton(createRef)} />
      <Alert tone="info">{t("sp.notice")}</Alert>
      <Card {...identity}>
        <FilterBar
          search={<SearchInput id="sample-search" label={t("list.search")} placeholder={t("sp.search")} value={state.search} onChange={(search) => update({ search }, { replace: true })} />}
          activeCount={activeFilterCount(state)}
          onClear={() => update({ search: "", filters: { is_active: "" } })}
          filters={(prefix) => (
            <FilterSelect id={`${prefix}-status`} label={t("field.status")} value={state.filters.is_active ?? ""} onChange={(value) => update({ filters: { is_active: value } })} options={statusFilterOptions(t)} className="md:w-44" />
          )}
        />
        {list === null ? (
          <ListRowsLoading label={t("list.updating")} />
        ) : list.results.length ? (
          <DataTable
            caption={t("sp.title")}
            rows={rows}
            rowKey={rowId}
            columns={columns}
            ordering={state.ordering}
            onSort={(ordering) => update({ ordering })}
            busy={pending}
            mobileTitle={(row) => <span className="font-medium text-ink">{row.name}</span>}
            actions={(row) => (
              <RowActions
                editLabel={t("sp.editLabel", { name: row.name })}
                deleteLabel={t("sp.deleteLabel", { name: row.name })}
                onEdit={() => setEditing(row)}
                onDelete={() => setDeleting(row)}
              />
            )}
          />
        ) : filtered ? (
          <EmptyState title={t("sp.noMatch")} description={t("sp.noMatchHint")} />
        ) : (
          <EmptyState title={t("sp.empty")} description={t("sp.emptyHint")} action={createButton()} />
        )}
        {list && <Pagination page={state.page} pageSize={state.pageSize} count={list.count} disabled={pending} onPage={(page) => update({ page })} onPageSize={(pageSize) => update({ pageSize })} />}
      </Card>

      {editing && (
        <PersonDialog
          key={editing === "new" ? "new" : editing.id}
          person={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(created) => {
            setEditing(null);
            notify(t(created ? "sp.created" : "sp.saved"));
            void reload();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title={t("sp.deleteTitle")}
          description={t("sp.deleteBody", { name: deleting.name })}
          confirmLabel={t("common.delete")}
          pendingLabel={t("common.deleting")}
          onConfirm={() => remove(deleting)}
          describe={(error) => describeDeleteError(error, t)}
        />
      )}
    </div>
  );
}

function PersonDialog({ person, onClose, onSaved }: { person: SamplePerson | null; onClose: () => void; onSaved: (created: boolean) => void }) {
  const { t } = useI18n();
  const formId = useId();
  const [name, setName] = useState(person?.name ?? "");
  const [active, setActive] = useState(person?.is_active ?? true);
  const [errors, setErrors] = useState<MappedErrors>(NO_ERRORS);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setErrors(NO_ERRORS);
    try {
      await apiFetch(person ? `/admin/sample-participants/${person.id}/` : "/admin/sample-participants/", { method: person ? "PATCH" : "POST", body: { name, is_active: active } });
      onSaved(!person);
    } catch (error) {
      if (isValidationError(error)) setErrors(mapFieldErrors(error, (key) => key === "name" || key === "is_active"));
      else setErrors({ fields: {}, form: [describeError(error, t)] });
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={t(person ? "sp.editTitle" : "sp.createTitle")}
      description={t("sp.formHint")}
      closeDisabled={pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={formId} disabled={pending} aria-busy={pending || undefined}>
            {pending ? t("common.saving") : person ? t("common.save") : t("common.create")}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="space-y-5">
        <FormErrors messages={errors.form} title={Object.keys(errors.fields).length ? t("form.errorSummary") : undefined} />
        <Field id={`${formId}-name`} label={t("sp.fieldName")} required error={errors.fields.name}>
          <Input value={name} maxLength={SAMPLE_NAME_MAX} autoComplete="off" onChange={(event) => setName(event.target.value)} disabled={pending} />
        </Field>
        <Switch id={`${formId}-active`} label={t("field.active")} checked={active} onChange={setActive} disabled={pending} />
        {errors.fields.is_active && <p className="text-[13px] text-danger-700">{errors.fields.is_active}</p>}
      </form>
    </Modal>
  );
}
