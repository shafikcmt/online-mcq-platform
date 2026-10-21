"use client";

import { AlertTriangle } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { describeError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";

import { Button } from "./button";
import { Modal } from "./modal";

/** Confirmation for destructive actions. Focus starts on Cancel (the safe choice); the
 * action runs only after the click and the dialog stays open, with buttons disabled,
 * until the server answers. A failure is shown inside the dialog (nothing is removed
 * from the page before the server confirms). `onConfirm` may return an error message
 * to show instead of the default description of the error. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel,
  onConfirm,
  describe,
  confirmVariant = "danger",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  onConfirm: () => Promise<void>;
  /** Turn a failure into a message (default: describeError). */
  describe?: (error: unknown) => { title?: string; message: string };
  /** "primary" for a confirmation that is not destructive (e.g. duplicate). */
  confirmVariant?: "danger" | "primary";
}) {
  const { t } = useI18n();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ title?: string; message: string } | null>(null);

  function change(next: boolean) {
    if (!next) setFailure(null);
    onOpenChange(next);
  }

  async function confirm() {
    setPending(true);
    setFailure(null);
    try {
      await onConfirm();
    } catch (error) {
      setFailure(describe ? describe(error) : { message: describeError(error, t) });
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={change}
      title={title}
      description={description}
      size="sm"
      role="alertdialog"
      closeDisabled={pending}
      initialFocus={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={() => change(false)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button variant={confirmVariant} onClick={confirm} disabled={pending} aria-busy={pending || undefined}>
            {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
          </Button>
        </>
      }
    >
      {failure && (
        <div role="alert" className="flex gap-3 rounded-control border border-danger-700/25 bg-danger-50 px-3 py-2.5 text-sm text-danger-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0">
            {failure.title && <p className="font-medium">{failure.title}</p>}
            <p>{failure.message}</p>
          </div>
        </div>
      )}
    </Modal>
  );
}
