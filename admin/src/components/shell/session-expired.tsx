"use client";

import { LogIn } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n/provider";
import { SESSION_EXPIRED_EVENT, expiredLoginPath, navigateTo } from "@/lib/session";

/** Shown when any panel API call answers 401 (`apiFetch` fires SESSION_EXPIRED_EVENT).
 * Instead of navigating away mid-edit, it explains what happened first; the form behind
 * it keeps its input (and its own inline error), so the admin can copy unsaved text.
 * "Sign in again" goes to the same sign-in flow as Milestone 7A, returning to this page. */
export function SessionExpiredDialog() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const signInRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, show);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, show);
  }, []);

  function signIn() {
    // A full page load: the old session's client state is not carried into the new one.
    navigateTo(expiredLoginPath(window.location.pathname + window.location.search));
  }

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title={t("session.expiredTitle")}
      description={t("session.expiredBody")}
      size="sm"
      role="alertdialog"
      layer="top"
      initialFocus={signInRef}
      footer={
        <>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t("session.stay")}
          </Button>
          <Button ref={signInRef} onClick={signIn}>
            <LogIn aria-hidden />
            {t("session.signIn")}
          </Button>
        </>
      }
    />
  );
}
