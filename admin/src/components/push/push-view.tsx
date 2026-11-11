"use client";

import { BellRing, Send } from "lucide-react";
import { useCallback, useId, useState, type FormEvent } from "react";

import { ListRowsLoading } from "@/components/content/list-skeleton";
import { Alert } from "@/components/ui/alert";
import { BilingualField } from "@/components/ui/bilingual-field";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DateTimeText } from "@/components/ui/date-time";
import { FilterBar, FilterSelect } from "@/components/ui/filter-bar";
import { Field, FormErrors, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { describeError } from "@/lib/api/errors";
import { isValidationError, mapFieldErrors, type MappedErrors } from "@/lib/api/field-errors";
import { PUSH_LIST } from "@/lib/content-specs";
import { formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { activeFilterCount, type ListState } from "@/lib/list-params";
import { localized } from "@/lib/localized";
import { useListData } from "@/lib/use-list-data";
import { useListUrl } from "@/lib/use-list-url";
import type { Paginated } from "@/types/content";
import { PUSH_LIMITS, type PushExamOption, type PushKind, type PushMessage, type PushMessageState, type PushStatusInfo } from "@/types/push";

const TONE: Record<PushMessageState, string> = { pending: "pending", sending: "pending", sent: "success", failed: "failed", disabled: "inactive" };
const KINDS: PushKind[] = ["manual", "exam_reminder"];
const STATES: PushMessageState[] = ["pending", "sending", "sent", "failed", "disabled"];
const NO_ERRORS: MappedErrors = { fields: {}, form: [] };
const rowId = (row: { id: number }) => row.id;
const FIELDS = ["title_bn", "title_en", "body_bn", "body_en", "exam"];

/** Push notifications: whether push is on and how many phones are registered, a form to send a message
 * to every phone (after a confirmation: it cannot be recalled), and the history of what was sent,
 * including the automatic exam reminders. */
export function PushView({ data, state: serverState, status, exams }: { data: Paginated<PushMessage>; state: ListState; status: PushStatusInfo; exams: PushExamOption[] }) {
  const { locale, t } = useI18n();
  const { notify } = useToast();
  const { state, key: urlKey, update, pending: navigating } = useListUrl(PUSH_LIST);
  const goToFirstPage = useCallback(() => update({ page: 1 }, { replace: true }), [update]);
  const { data: list, reload, reloading, identity } = useListData({ serverData: data, serverState, urlKey, apiPath: "/admin/push/messages/", onPageGone: goToFirstPage });
  const rows = list?.results ?? [];
  const pending = navigating || reloading;
  const filtered = activeFilterCount(state) > 0;

  const offsetText = (minutes: number) =>
    minutes % 1440 === 0
      ? t("push.offset.days", { n: String(minutes / 1440) })
      : minutes % 60 === 0
        ? t("push.offset.hours", { n: String(minutes / 60) })
        : t("push.offset.minutes", { n: String(minutes) });

  const textOf = (row: PushMessage) => localized(locale, row.title_bn, row.title_en).text || t("push.untitled");
  const bodyOf = (row: PushMessage) => localized(locale, row.body_bn, row.body_en).text;

  const columns: Column<PushMessage>[] = [
    {
      key: "message",
      header: t("push.colMessage"),
      className: "min-w-64",
      hideOnMobile: true,
      cell: (row) => (
        <span className="block">
          <span className="block font-medium break-words text-ink">{textOf(row)}</span>
          <span className="block text-[13px] break-words text-ink-subtle">{bodyOf(row)}</span>
          {row.exam_label ? <span className="block text-xs text-ink-subtle">{row.exam_label}</span> : null}
        </span>
      ),
    },
    { key: "kind", header: t("push.colKind"), cell: (row) => t(`push.kind.${row.kind}`) },
    { key: "status", header: t("push.colStatus"), cell: (row) => <StatusBadge status={TONE[row.status]} label={t(`push.state.${row.status}`)} className="whitespace-nowrap" /> },
    {
      key: "sent",
      header: t("push.colSent"),
      cell: (row) => <span className="tabular-nums text-ink-muted">{row.status === "sent" || row.status === "failed" ? t("push.counts", { sent: formatNumber(row.sent_count, locale), devices: formatNumber(row.device_count, locale) }) : "—"}</span>,
    },
    { key: "when", header: t("push.colWhen"), sortField: "created_at", sortFirst: "desc", className: "whitespace-nowrap", cell: (row) => <span className="text-ink-muted"><DateTimeText iso={row.created_at} /></span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("push.title")} subtitle={t("push.subtitle")} />

      <Card aria-labelledby="push-status">
        <CardHeader>
          <CardTitle id="push-status">{t("push.statusTitle")}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2 text-sm">
          {status.enabled ? (
            <p className="flex items-center gap-2 font-medium text-success-700">
              <BellRing className="size-4" aria-hidden />
              {t("push.on")}
            </p>
          ) : (
            <Alert tone="warning">
              <span className="block font-medium">{t("push.off")}</span>
              <span className="mt-1 block">{t("push.offHint")}</span>
            </Alert>
          )}
          <p className="text-ink-muted">{t("push.devices", { n: formatNumber(status.devices, locale) })}</p>
          <p className="text-ink-muted">{status.reminder_offsets.length ? t("push.reminders", { list: status.reminder_offsets.map(offsetText).join(", ") }) : t("push.noReminders")}</p>
        </CardBody>
      </Card>

      <SendForm status={status} exams={exams} onSent={() => { notify(t("push.sent")); void reload(); }} />

      <Card {...identity}>
        <CardHeader>
          <CardTitle>{t("push.historyTitle")}</CardTitle>
        </CardHeader>
        <FilterBar
          activeCount={activeFilterCount(state)}
          onClear={() => update({ filters: { kind: "", status: "" } })}
          filters={(prefix) => (
            <>
              <FilterSelect id={`${prefix}-kind`} label={t("push.kindFilter")} value={state.filters.kind ?? ""} onChange={(value) => update({ filters: { kind: value } })} options={[{ value: "", label: t("push.allKinds") }, ...KINDS.map((value) => ({ value, label: t(`push.kind.${value}`) }))]} className="md:w-52" />
              <FilterSelect id={`${prefix}-status`} label={t("push.statusFilter")} value={state.filters.status ?? ""} onChange={(value) => update({ filters: { status: value } })} options={[{ value: "", label: t("push.allStatuses") }, ...STATES.map((value) => ({ value, label: t(`push.state.${value}`) }))]} className="md:w-52" />
            </>
          )}
        />
        {list === null ? (
          <ListRowsLoading label={t("list.updating")} />
        ) : list.results.length ? (
          <DataTable caption={t("push.historyTitle")} rows={rows} rowKey={rowId} columns={columns} ordering={state.ordering} onSort={(ordering) => update({ ordering })} busy={pending} mobileTitle={(row) => <span className="font-medium text-ink">{textOf(row)}</span>} />
        ) : filtered ? (
          <EmptyState title={t("push.noMatch")} description={t("push.noMatchHint")} />
        ) : (
          <EmptyState title={t("push.empty")} description={t("push.emptyHint")} />
        )}
        {list && <Pagination page={state.page} pageSize={state.pageSize} count={list.count} disabled={pending} onPage={(page) => update({ page })} onPageSize={(pageSize) => update({ pageSize })} />}
      </Card>
    </div>
  );
}

function SendForm({ status, exams, onSent }: { status: PushStatusInfo; exams: PushExamOption[]; onSent: () => void }) {
  const { locale, t } = useI18n();
  const formId = useId();
  const [values, setValues] = useState({ title_bn: "", title_en: "", body_bn: "", body_en: "", exam: "" });
  const [errors, setErrors] = useState<MappedErrors>(NO_ERRORS);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  function review(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const filled = (values.title_bn.trim() && values.body_bn.trim()) || (values.title_en.trim() && values.body_en.trim());
    if (!filled) {
      setErrors({ fields: {}, form: [t("push.sendHint")] });
      return;
    }
    setErrors(NO_ERRORS);
    setConfirming(true);
  }

  async function send() {
    setBusy(true);
    setErrors(NO_ERRORS);
    try {
      await apiFetch("/admin/push/messages/", { method: "POST", body: { ...values, exam: values.exam ? Number(values.exam) : null } });
      setValues({ title_bn: "", title_en: "", body_bn: "", body_en: "", exam: "" });
      setConfirming(false);
      onSent();
    } catch (error) {
      setConfirming(false);
      if (isValidationError(error)) setErrors(mapFieldErrors(error, (key) => FIELDS.includes(key)));
      else setErrors({ fields: {}, form: [describeError(error, t)] });
    } finally {
      setBusy(false);
    }
  }

  const set = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));
  return (
    <Card aria-labelledby="push-send">
      <CardHeader>
        <CardTitle id="push-send">{t("push.sendTitle")}</CardTitle>
      </CardHeader>
      <CardBody>
        <form id={formId} noValidate onSubmit={review} className="space-y-5">
          <p className="text-sm text-ink-muted">{t("push.sendHint")}</p>
          <FormErrors messages={errors.form} title={Object.keys(errors.fields).length ? t("form.errorSummary") : undefined} />
          <BilingualField
            id={`${formId}-title`}
            label={t("push.fieldTitle")}
            maxLength={PUSH_LIMITS.title}
            values={{ bn: values.title_bn, en: values.title_en }}
            onChange={(lang, value) => set(lang === "bn" ? "title_bn" : "title_en", value)}
            errors={{ bn: errors.fields.title_bn, en: errors.fields.title_en }}
            disabled={busy}
          />
          <BilingualField
            id={`${formId}-body`}
            label={t("push.fieldBody")}
            multiline
            rows={3}
            maxLength={PUSH_LIMITS.body}
            values={{ bn: values.body_bn, en: values.body_en }}
            onChange={(lang, value) => set(lang === "bn" ? "body_bn" : "body_en", value)}
            errors={{ bn: errors.fields.body_bn, en: errors.fields.body_en }}
            disabled={busy}
          />
          <Field id={`${formId}-exam`} label={t("push.fieldExam")} optional error={errors.fields.exam} className="sm:max-w-md">
            <Select value={values.exam} onChange={(event) => set("exam", event.target.value)} disabled={busy}>
              <option value="">{t("push.noExam")}</option>
              {exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {localized(locale, exam.title_bn, exam.title_en).text}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" disabled={busy}>
            <Send aria-hidden />
            {t("push.send")}
          </Button>
        </form>
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t("push.confirmTitle")}
          description={status.enabled ? t("push.confirmBody", { n: formatNumber(status.devices, locale) }) : t("push.confirmBodyOff")}
          confirmLabel={t("push.confirm")}
          pendingLabel={t("push.sending")}
          onConfirm={send}
        />
      </CardBody>
    </Card>
  );
}
