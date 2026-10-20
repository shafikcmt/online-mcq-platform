"use client";

import { ImageIcon, RefreshCw, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FieldError } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { describeError } from "@/lib/api/errors";
import { isValidationError, mapFieldErrors } from "@/lib/api/field-errors";
import { isQuestionLocked } from "@/lib/content-errors";
import { useI18n } from "@/lib/i18n/provider";
import type { Question } from "@/types/content";

const ACCEPT = "image/jpeg,image/png,image/webp";
const UPLOAD_TIMEOUT_MS = 60_000; // slower links: a few MB upload

/** Image of a saved question: upload (multipart field `image`), replace, remove. The file
 * goes straight to `POST /admin/questions/{id}/image/` — no base64, no unreferenced
 * uploads; the server validates, re-encodes and stores it, then returns the question.
 * The preview always shows the server's copy (what students will see). */
export function QuestionImage({ question, onChange }: { question: Question; onChange: (question: Question) => void }) {
  const { t } = useI18n();
  const { notify } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | null>(null);
  const [error, setError] = useState<{ message: string; locked: boolean } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const errorId = "q-image-file";

  function fail(cause: unknown) {
    if (isQuestionLocked(cause)) return setError({ message: t("error.questionLocked"), locked: true });
    if (isValidationError(cause)) {
      const mapped = mapFieldErrors(cause, (key) => key === "image");
      return setError({ message: [mapped.fields.image, ...mapped.form].filter(Boolean).join(" "), locked: false });
    }
    setError({ message: describeError(cause, t), locked: false });
  }

  async function upload(file: File) {
    setBusy("upload");
    setError(null);
    const body = new FormData();
    body.append("image", file);
    try {
      const updated = await apiFetch<Question>(`/admin/questions/${question.id}/image/`, {
        method: "POST",
        body,
        timeoutMs: UPLOAD_TIMEOUT_MS,
      });
      onChange(updated);
      notify(t("image.uploaded"));
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = ""; // choosing the same file again works
    }
  }

  async function remove() {
    try {
      const updated = await apiFetch<Question>(`/admin/questions/${question.id}/image/`, { method: "DELETE" });
      setConfirmRemove(false);
      setError(null);
      onChange(updated);
      notify(t("image.removed"));
    } catch (cause) {
      if (isQuestionLocked(cause)) {
        setConfirmRemove(false);
        setError({ message: t("error.questionLocked"), locked: true });
        return;
      }
      throw cause; // shown inside the dialog
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="grid h-44 w-full shrink-0 place-items-center overflow-hidden rounded-card border border-dashed border-line-strong bg-neutral-50 sm:w-64">
          {question.image ? (
            // A user-uploaded file served from MEDIA_URL; next/image adds nothing here.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={question.image}
              alt={t("image.alt", { id: question.id })}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="flex flex-col items-center gap-2 text-sm text-ink-subtle">
              <ImageIcon className="size-6" aria-hidden />
              {t("image.none")}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor={errorId} className="sr-only">
            {t("image.fileLabel")}
          </label>
          <input
            ref={inputRef}
            id={errorId}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-describedby={error ? `${errorId}-error` : undefined}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button
            variant="secondary"
            onClick={() => inputRef.current?.click()}
            disabled={busy !== null}
            aria-busy={busy === "upload" || undefined}
            aria-describedby={error ? `${errorId}-error` : undefined}
          >
            {question.image ? <RefreshCw aria-hidden /> : <Upload aria-hidden />}
            {busy === "upload" ? t("image.uploading") : question.image ? t("image.replace") : t("image.choose")}
          </Button>
          {question.image && (
            <Button
              variant="ghost"
              onClick={() => setConfirmRemove(true)}
              disabled={busy !== null}
              className="text-danger-700 hover:bg-danger-50 hover:text-danger-700"
            >
              <Trash2 aria-hidden />
              {t("image.remove")}
            </Button>
          )}
        </div>
      </div>
      {error?.locked ? (
        <Alert tone="locked" title={error.message} live>
          {t("error.questionLockedHint")}
        </Alert>
      ) : (
        <div role="alert">
          <FieldError id={errorId} message={error?.message} />
        </div>
      )}
      {confirmRemove && (
        <ConfirmDialog
          open
          onOpenChange={setConfirmRemove}
          title={t("image.removeTitle")}
          description={t("image.removeBody", { id: question.id })}
          confirmLabel={t("image.remove")}
          pendingLabel={t("image.removing")}
          onConfirm={remove}
        />
      )}
    </div>
  );
}
