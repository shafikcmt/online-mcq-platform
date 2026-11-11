"use client";

import { ExternalLink, FileUp, Trash2 } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";

import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { ApiError, describeError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey } from "@/lib/i18n/messages";
import type { Announcement } from "@/types/cms";

const MAX_MB = 10; // the server's DOCUMENT_MAX_BYTES default, only to refuse an obvious mistake early
const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Attach, replace, open or remove the PDF of an existing announcement. It acts at once
 * (its own endpoint), independent of the dialog's Save button; `onChanged` lets the list reload. */
export function NoticePdfField({ notice, onChanged }: { notice: Announcement | null; onChanged: () => void }) {
  const { t } = useI18n();
  const { notify } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [pdf, setPdf] = useState(notice?.pdf ?? { available: false, name: "", size_bytes: 0 });
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
    if (!file || busy || !notice) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) return setError(t("rt.notPdf"));
    if (file.size > MAX_MB * 1024 * 1024) return setError(t("rt.tooBig", { mb: String(MAX_MB) }));
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const saved = await apiFetch<Announcement>(`/admin/announcements/${notice.id}/pdf/`, { method: "POST", body: form });
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
    if (!notice) return;
    const saved = await apiFetch<Announcement>(`/admin/announcements/${notice.id}/pdf/`, { method: "DELETE" });
    setPdf(saved.pdf);
    setRemoving(false);
    notify(t("np.removed"));
    onChanged();
  }

  return (
    <section aria-labelledby="np-title" className="space-y-3 rounded-control border border-line p-4">
      <h3 id="np-title" className="text-sm font-semibold text-ink">
        {t("np.title")}
      </h3>
      {!notice ? (
        <p className="text-sm text-ink-subtle">{t("np.saveFirst")}</p>
      ) : (
        <>
          <p className="text-sm text-ink-muted">{t("np.hint", { mb: String(MAX_MB) })}</p>
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
            <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" tabIndex={-1} aria-hidden onChange={choose} data-testid="notice-pdf-file" />
            <Button type="button" variant="secondary" onClick={() => input.current?.click()} disabled={busy} aria-busy={busy || undefined}>
              <FileUp aria-hidden />
              {busy ? t("np.uploading") : pdf.available ? t("np.replace") : t("np.upload")}
            </Button>
            {pdf.available && (
              <>
                <a href={`/api/v1/public/announcements/${notice.id}/pdf/`} target="_blank" rel="noopener" className={buttonVariants({ variant: "secondary" })}>
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
            description={t("np.removeBody")}
            confirmLabel={t("np.remove")}
            pendingLabel={t("np.removing")}
            onConfirm={remove}
          />
        </>
      )}
    </section>
  );
}
