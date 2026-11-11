"use client";

import { CalendarDays, ExternalLink, FileUp, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type ChangeEvent } from "react";

import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DateTimeText } from "@/components/ui/date-time";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { ApiError, describeError } from "@/lib/api/errors";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey } from "@/lib/i18n/messages";
import type { RoutineExam, RoutinePdfInfo } from "@/types/routine";

const PDF_PATH = "/api/v1/public/routine/pdf/";
const MAX_MB = 10; // the server's DOCUMENT_MAX_BYTES default, used only to refuse an obvious mistake early

const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** The exam routine. The schedule is read live from the exams (nothing to maintain here); the
 * admin's own job is the optional routine PDF: upload, replace, open, remove. */
export function RoutineView({ exams, initialPdf }: { exams: RoutineExam[]; initialPdf: RoutinePdfInfo }) {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pdf, setPdf] = useState(initialPdf);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  const [now] = useState(() => Date.now());

  const problem = (caught: unknown) => {
    if (caught instanceof ApiError) {
      const key = `rt.err.${caught.code}` as MessageKey;
      const known = t(key);
      if (known !== key) return known;
    }
    return describeError(caught, t);
  };

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // the same file can be chosen again later
    if (!file || busy) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) return setError(t("rt.notPdf"));
    if (file.size > MAX_MB * 1024 * 1024) return setError(t("rt.tooBig", { mb: String(MAX_MB) }));
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      setPdf(await apiFetch<RoutinePdfInfo>("/admin/routine/pdf/", { method: "POST", body: form }));
      notify(t("rt.uploaded"));
    } catch (caught) {
      setError(problem(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setPdf(await apiFetch<RoutinePdfInfo>("/admin/routine/pdf/", { method: "DELETE" }));
    setRemoving(false);
    notify(t("rt.removed"));
  }

  const examTitle = (row: RoutineExam) => row.title || row.slug;
  const isLive = (row: RoutineExam) => !!row.start_at && new Date(row.start_at).getTime() <= now && (!row.end_at || new Date(row.end_at).getTime() > now);
  const columns: Column<RoutineExam>[] = [
    {
      key: "when",
      header: t("rt.colWhen"),
      className: "min-w-36",
      cell: (row) => (
        <span className="block">
          {row.start_at ? <DateTimeText iso={row.start_at} /> : null}
          {row.end_at ? <span className="block text-xs text-ink-subtle">{t("rt.until", { time: formatDateTime(row.end_at, locale) })}</span> : null}
        </span>
      ),
    },
    {
      key: "exam",
      header: t("rt.colExam"),
      cell: (row) => (
        <span className="block">
          <span className="block font-medium break-words text-ink">{examTitle(row)}</span>
          <span className="block text-xs text-ink-subtle">{[row.category.name, row.subject?.name].filter(Boolean).join(" · ")}</span>
        </span>
      ),
    },
    {
      key: "details",
      header: t("rt.colDetails"),
      hideOnMobile: true,
      cell: (row) => (
        <span className="block text-xs text-ink-muted">
          {t("rt.minutes", { n: formatNumber(row.duration_minutes, locale) })} · {t("rt.questions", { n: formatNumber(row.total_questions, locale) })} · {t("rt.marks", { n: row.total_marks })}
        </span>
      ),
    },
    {
      key: "status",
      header: t("rt.colStatus"),
      cell: (row) => <StatusBadge status={isLive(row) ? "success" : "pending"} label={isLive(row) ? t("rt.live") : t("rt.upcoming")} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("rt.title")} subtitle={t("rt.subtitle")} />

      <Card aria-labelledby="rt-pdf">
        <CardHeader>
          <CardTitle id="rt-pdf">{t("rt.pdfTitle")}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-ink-muted">{t("rt.pdfHint", { mb: String(MAX_MB) })}</p>
          {pdf.available ? (
            <div className="rounded-control border border-line bg-neutral-50 px-3 py-2 text-sm">
              <p className="font-medium break-all text-ink">{t("rt.pdfCurrent", { name: pdf.name })}</p>
              <p className="text-xs text-ink-subtle">{t("rt.pdfDetails", { size: sizeText(pdf.size_bytes), time: pdf.updated_at ? formatDateTime(pdf.updated_at, locale) : "" })}</p>
            </div>
          ) : (
            <p className="text-sm text-ink-subtle">{t("rt.pdfNone")}</p>
          )}
          {error && (
            <Alert tone="danger" live>
              {error}
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <input ref={fileInput} type="file" accept="application/pdf,.pdf" className="sr-only" tabIndex={-1} aria-hidden onChange={choose} data-testid="routine-file" />
            <Button onClick={() => fileInput.current?.click()} disabled={busy} aria-busy={busy || undefined}>
              <FileUp aria-hidden />
              {busy ? t("rt.uploading") : pdf.available ? t("rt.replace") : t("rt.upload")}
            </Button>
            {pdf.available && (
              <>
                <a href={PDF_PATH} target="_blank" rel="noopener" className={buttonVariants({ variant: "secondary" })}>
                  <ExternalLink aria-hidden />
                  {t("rt.open")}
                </a>
                <Button variant="secondary" onClick={() => setRemoving(true)} disabled={busy}>
                  <Trash2 aria-hidden />
                  {t("rt.remove")}
                </Button>
              </>
            )}
          </div>
        </CardBody>
      </Card>

      <Card aria-labelledby="rt-schedule">
        <CardHeader>
          <CardTitle id="rt-schedule">{t("rt.scheduleTitle")}</CardTitle>
          <Link href="/exams" className={buttonVariants({ variant: "secondary", size: "sm" })}>
            <CalendarDays aria-hidden />
            {t("rt.manageExams")}
          </Link>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-ink-muted">{t("rt.scheduleHint")}</p>
          {exams.length === 0 ? (
            <EmptyState title={t("rt.empty")} description={t("rt.emptyHint")} />
          ) : (
            <DataTable caption={t("rt.scheduleTitle")} rows={exams} rowKey={(row) => row.slug} columns={columns} mobileTitle={(row) => examTitle(row)} />
          )}
        </CardBody>
      </Card>

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t("rt.removeTitle")}
        description={t("rt.removeBody")}
        confirmLabel={t("rt.remove")}
        pendingLabel={t("rt.removing")}
        onConfirm={remove}
      />
    </div>
  );
}
