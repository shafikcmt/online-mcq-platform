"use client";

import { useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, FormErrors, Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { describeError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";

/** Asks the admin for their own password again before a change to credentials or mode. The
 * password goes to the server with that one request and is never kept: the field is cleared
 * when the dialog closes or the request succeeds. A wrong password shows the server's message
 * and keeps the dialog open; the server also counts wrong attempts and locks after a few. */
export function PasswordConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  confirmLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  /** Performs the change with the entered password; throw to keep the dialog open. */
  onConfirm: (password: string) => Promise<void>;
  confirmLabel?: string;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string[]>([]);

  function change(next: boolean) {
    if (!next) {
      setPassword("");
      setError([]);
    }
    onOpenChange(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || !password) return;
    setPending(true);
    setError([]);
    try {
      await onConfirm(password);
      setPassword("");
      onOpenChange(false);
    } catch (failure) {
      setPassword("");
      setError([describeError(failure, t)]);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={change}
      title={title ?? t("gw.pwTitle")}
      description={description ?? t("gw.pwDescription")}
      size="sm"
      closeDisabled={pending}
      initialFocus={input}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => change(false)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="gateway-password-form" disabled={pending || !password}>
            {pending ? t("gw.pwPending") : (confirmLabel ?? t("gw.pwConfirm"))}
          </Button>
        </>
      }
    >
      <form id="gateway-password-form" onSubmit={submit} className="space-y-3">
        <FormErrors messages={error} />
        <Field id="gateway-password" label={t("gw.pwLabel")}>
          <Input
            ref={input}
            id="gateway-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}
