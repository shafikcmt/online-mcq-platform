"use client";

import { Download, FileSpreadsheet, Upload } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";

import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Field, Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { apiFetch } from "@/lib/api/client";
import { ApiError, describeError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey } from "@/lib/i18n/messages";
import { errorReportCsv, IMPORT_ACCEPT, IMPORT_MAX_BYTES } from "@/lib/question-import";
import type { Subject } from "@/types/content";
import type { ImportPreviewRow, ImportReport, ImportRowError } from "@/types/question-import";

const TEMPLATE = "/api/v1/admin/questions/import/template/";
const SHOWN_ERRORS = 100;
const MAX_ROWS_TEXT = 2000; // the server's QUESTION_IMPORT_MAX_ROWS default, shown as guidance only

type OnError = "skip" | "abort";

/** Bulk question import: choose a CSV/Excel file, CHECK it (nothing is saved), see the problems
 * row by row (and download them), then import the correct rows. The server does all the
 * checking, and the preview and the import run the same code over the same file. */
export function QuestionImportView({ subjects }: { subjects: Subject[] }) {
  const { t, locale } = useI18n();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [subject, setSubject] = useState("");
  const [onError, setOnError] = useState<OnError>("skip");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [confirming, setConfirming] = useState(false);

  const subjectName = (row: Subject) => (locale === "bn" && row.name_bn) || row.name_en || row.name_bn || row.slug;
  const mb = String(IMPORT_MAX_BYTES / (1024 * 1024));

  function body(mode: "preview" | "import") {
    const form = new FormData();
    form.append("file", file as File);
    form.append("mode", mode);
    form.append("on_error", onError);
    if (subject) form.append("subject", subject);
    return form;
  }

  // A translated text when we have one for the file-level code; otherwise the server's message.
  function failureText(caught: unknown): string {
    if (caught instanceof ApiError) {
      const key = `qi.file.${caught.code}` as MessageKey;
      const known = t(key);
      if (known !== key) return known;
    }
    return describeError(caught, t);
  }

  async function check(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!file) {
      setError(t("qi.chooseFile"));
      return;
    }
    setBusy(true);
    setError("");
    setReport(null);
    try {
      setReport(await apiFetch<ImportReport>("/admin/questions/import/", { method: "POST", body: body("preview") }));
    } catch (caught) {
      setError(failureText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    // The dialog keeps itself open while this runs; a failure is thrown back into it.
    const result = await apiFetch<ImportReport>("/admin/questions/import/", { method: "POST", body: body("import") });
    setReport(result);
    setConfirming(false);
  }

  function reset() {
    setReport(null);
    setFile(null);
    setError("");
    if (fileInput.current) fileInput.current.value = "";
  }

  function downloadErrors(errors: ImportRowError[]) {
    const csv = errorReportCsv(errors, { row: t("qi.reportRow"), field: t("qi.reportField"), problem: t("qi.reportProblem") });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "question-import-errors.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  const done = report && report.created !== undefined;
  const errorColumns: Column<ImportRowError>[] = [
    { key: "row", header: t("qi.colRow"), className: "w-16 tabular-nums", cell: (row) => row.row },
    { key: "field", header: t("qi.colField"), className: "w-36", cell: (row) => fieldLabel(row.field) },
    {
      key: "problem",
      header: t("qi.colProblem"),
      cell: (row) => (
        <span className="block">
          <span className="block">{codeText(row.code)}</span>
          <span className="block text-xs break-words text-ink-subtle">{row.message}</span>
        </span>
      ),
    },
  ];
  const previewColumns: Column<ImportPreviewRow>[] = [
    { key: "row", header: t("qi.colRow"), className: "w-16 tabular-nums", cell: (row) => row.row },
    { key: "question", header: t("qi.colQuestion"), cell: (row) => <span className="break-words">{row.question}</span> },
    { key: "subject", header: t("qi.colSubject"), className: "w-40", cell: (row) => row.subject },
    { key: "options", header: t("qi.colOptions"), className: "w-20 tabular-nums", cell: (row) => row.options },
    { key: "correct", header: t("qi.colCorrect"), className: "w-20", cell: (row) => row.correct },
  ];

  function codeText(code: string) {
    const key = `qi.err.${code}` as MessageKey;
    const text = t(key);
    return text === key ? code : text;
  }
  function fieldLabel(field: string) {
    const key = `qi.field.${field}` as MessageKey;
    const text = t(key);
    return text === key ? field : text;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("qi.title")}
        subtitle={t("qi.subtitle")}
        actions={
          <Button asChild variant="secondary">
            <Link href="/questions">{t("qi.back")}</Link>
          </Button>
        }
      />

      <Card aria-labelledby="qi-how">
        <CardHeader>
          <CardTitle id="qi-how">{t("qi.howTitle")}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2 text-sm text-ink-muted">
          <p>{t("qi.how1")}</p>
          <p>{t("qi.how2")}</p>
          <p>{t("qi.how3")}</p>
          <p>{t("qi.how4", { rows: String(MAX_ROWS_TEXT), mb })}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <a href={`${TEMPLATE}?file_format=csv`} download className={buttonVariants({ variant: "secondary", size: "sm" })}>
              <Download aria-hidden />
              {t("qi.templateCsv")}
            </a>
            <a href={`${TEMPLATE}?file_format=xlsx`} download className={buttonVariants({ variant: "secondary", size: "sm" })}>
              <FileSpreadsheet aria-hidden />
              {t("qi.templateXlsx")}
            </a>
          </div>
        </CardBody>
      </Card>

      {done ? (
        <Card aria-live="polite">
          <CardBody className="space-y-3">
            {report.aborted ? (
              <Alert tone="warning" title={t("qi.abortedTitle")} live>
                {t("qi.abortedText")}
              </Alert>
            ) : (
              <Alert tone="info" title={t("qi.doneTitle")} live>
                {t("qi.doneText", { created: String(report.created), skipped: String(report.skipped ?? 0) })}
              </Alert>
            )}
            {report.errors.length > 0 && (
              <Button variant="secondary" size="sm" onClick={() => downloadErrors(report.errors)}>
                <Download aria-hidden />
                {t("qi.downloadErrors")}
              </Button>
            )}
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/questions">{t("qi.viewQuestions")}</Link>
              </Button>
              <Button variant="secondary" onClick={reset}>
                {t("qi.another")}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody>
            <form onSubmit={check} className="grid gap-4 md:grid-cols-2" noValidate>
              <Field id="qi-file" label={t("qi.file")} hint={t("qi.fileHint", { mb })} className="md:col-span-2">
                <Input
                  id="qi-file"
                  ref={fileInput}
                  type="file"
                  accept={IMPORT_ACCEPT}
                  className="h-auto py-1.5"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setReport(null);
                    setError("");
                  }}
                />
              </Field>
              <Field id="qi-subject" label={t("qi.subject")} hint={t("qi.subjectHint")} optional>
                <Select id="qi-subject" value={subject} onChange={(event) => setSubject(event.target.value)}>
                  <option value="">{t("qi.noDefault")}</option>
                  {subjects.map((row) => (
                    <option key={row.id} value={row.id}>
                      {subjectName(row)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="qi-onerror" label={t("qi.onError")}>
                <Select id="qi-onerror" value={onError} onChange={(event) => setOnError(event.target.value as OnError)}>
                  <option value="skip">{t("qi.onErrorSkip")}</option>
                  <option value="abort">{t("qi.onErrorAbort")}</option>
                </Select>
              </Field>
              {error && (
                <div className="md:col-span-2">
                  <Alert tone="danger" live>
                    {error}
                  </Alert>
                </div>
              )}
              <div className="md:col-span-2">
                <Button type="submit" disabled={busy}>
                  <Upload aria-hidden />
                  {busy ? t("qi.checking") : t("qi.check")}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {report && !done && (
        <div className="space-y-4" aria-live="polite">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label={t("qi.rows")} value={report.total_rows} />
            <Stat label={t("qi.valid")} value={report.valid_rows} tone="good" />
            <Stat label={t("qi.invalid")} value={report.invalid_rows} tone={report.invalid_rows ? "bad" : undefined} />
          </div>
          {report.unknown_columns.length > 0 && (
            <Alert tone="warning">{t("qi.unknownCols", { columns: report.unknown_columns.join(", ") })}</Alert>
          )}
          {report.errors.length > 0 && (
            <Card aria-labelledby="qi-errors">
              <CardHeader>
                <CardTitle id="qi-errors">{t("qi.errorsTitle")}</CardTitle>
                <Button variant="secondary" size="sm" onClick={() => downloadErrors(report.errors)}>
                  <Download aria-hidden />
                  {t("qi.downloadErrors")}
                </Button>
              </CardHeader>
              <CardBody className="space-y-2">
                <DataTable
                  caption={t("qi.errorsTitle")}
                  rows={report.errors.slice(0, SHOWN_ERRORS)}
                  rowKey={(row) => `${row.row}-${row.field}-${row.code}`}
                  columns={errorColumns}
                  mobileTitle={(row) => `${t("qi.colRow")} ${row.row}`}
                />
                {(report.errors.length > SHOWN_ERRORS || report.errors_truncated) && (
                  <p className="text-xs text-ink-subtle">
                    {report.errors_truncated ? t("qi.errorsTruncated") : t("qi.errorsShown", { n: String(SHOWN_ERRORS) })}
                  </p>
                )}
              </CardBody>
            </Card>
          )}
          {report.preview.length > 0 && (
            <Card aria-labelledby="qi-preview">
              <CardHeader>
                <CardTitle id="qi-preview">{t("qi.previewTitle")}</CardTitle>
              </CardHeader>
              <CardBody>
                <DataTable
                  caption={t("qi.previewTitle")}
                  rows={report.preview}
                  rowKey={(row) => row.row}
                  columns={previewColumns}
                  mobileTitle={(row) => row.question}
                />
              </CardBody>
            </Card>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => setConfirming(true)} disabled={report.valid_rows === 0}>
              {t("qi.import", { n: String(report.valid_rows) })}
            </Button>
            {report.valid_rows === 0 && <span className="text-sm text-ink-subtle">{t("qi.nothingToImport")}</span>}
          </div>
        </div>
      )}

      {report && (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t("qi.confirmTitle", { n: String(report.valid_rows) })}
          description={onError === "abort" ? t("qi.confirmBodyAbort") : t("qi.confirmBody", { skipped: String(report.invalid_rows) })}
          confirmLabel={t("qi.import", { n: String(report.valid_rows) })}
          pendingLabel={t("qi.importing")}
          confirmVariant="primary"
          onConfirm={runImport}
          describe={(caught) => ({ message: failureText(caught) })}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-card border border-line bg-surface px-4 py-3">
      <p className="text-xs text-ink-subtle">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${tone === "good" ? "text-success-700" : tone === "bad" ? "text-danger-700" : "text-ink"}`}>{value}</p>
    </div>
  );
}
