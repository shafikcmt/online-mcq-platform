"use client";

import { ExternalLink, FileUp, Trash2 } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";

import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { ApiError, describeError } from "@/lib/api/errors";
import type { MessageKey } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/provider";

export type PdfInfo = { available: boolean; name: string; size_bytes: number };

const MAX_MB = 10; // the server's DOCUMENT_MAX_BYTES default, only to refuse an obvious mistake early
const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Attach, replace, open or remove one PDF through a `POST`/`DELETE` endpoint that answers with
 * the owning record (`{pdf: {available, name, size_bytes}}`). It acts at once, independent of any
 * surrounding form's Save button. `endpoint` is null while the record is not saved yet. */
export function PdfAttachment({
  endpoint,
  openHref,
  initial,
  title,
  hint,
  saveFirst,
  removeBody,
  onChanged,
}: {
  endpoint: string | null;
  openHref: string;
  initial: PdfInfo | undefined;
  title: string;
  hint: string;
  saveFirst: string;
  removeBody: string;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const { notify } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [pdf, setPdf] = useState<PdfInfo>(initial ?? { available: false, name: "", size_bytes: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);

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
    event.target.value = "";
    if (!file || busy || !endpoint) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) return setError(t("rt.notPdf"));
    if (file.size > MAX_MB * 1024 * 1024) return setError(t("rt.tooBig", { mb: String(MAX_MB) }));
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const saved = await apiFetch<{ pdf: PdfInfo }>(endpoint, { method: "POST", body: form });
      setPdf(saved.pdf);
      notify(t("np.uploaded"));
      onChanged();
    } catch (caught) {
      setError(problem(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!endpoint) return;
    const saved = await apiFetch<{ pdf: PdfInfo }>(endpoint, { method: "DELETE" });
    setPdf(saved.pdf);
    setRemoving(false);
    notify(t("np.removed"));
    onChanged();
  }

  return (
    <section aria-label={title} className="space-y-3 rounded-control border border-line p-4">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {!endpoint ? (
        <p className="text-sm text-ink-subtle">{saveFirst}</p>
      ) : (
        <>
          <p className="text-sm text-ink-muted">{hint}</p>
          {pdf.available ? (
            <p className="text-sm font-medium break-all text-ink">
              {t("np.current", { name: pdf.name })} <span className="font-normal text-ink-subtle">({sizeText(pdf.size_bytes)})</span>
            </p>
          ) : (
            <p className="text-sm text-ink-subtle">{t("np.none")}</p>
          )}
          {error && (
            <Alert tone="danger" live>
              {error}
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" tabIndex={-1} aria-hidden onChange={choose} data-testid="pdf-file" />
            <Button type="button" variant="secondary" onClick={() => input.current?.click()} disabled={busy} aria-busy={busy || undefined}>
              <FileUp aria-hidden />
              {busy ? t("np.uploading") : pdf.available ? t("np.replace") : t("np.upload")}
            </Button>
            {pdf.available && (
              <>
                <a href={openHref} target="_blank" rel="noopener" className={buttonVariants({ variant: "secondary" })}>
                  <ExternalLink aria-hidden />
                  {t("np.open")}
                </a>
                <Button type="button" variant="secondary" onClick={() => setRemoving(true)} disabled={busy}>
                  <Trash2 aria-hidden />
                  {t("np.remove")}
                </Button>
              </>
            )}
          </div>
          <ConfirmDialog
            open={removing}
            onOpenChange={setRemoving}
            title={t("np.removeTitle")}
            description={removeBody}
            confirmLabel={t("np.remove")}
            pendingLabel={t("np.removing")}
            onConfirm={remove}
          />
        </>
      )}
    </section>
  );
}
