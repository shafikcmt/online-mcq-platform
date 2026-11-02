"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { ApiError, describeError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import type { AdminPaymentDetail } from "@/types/payments";

import { codeLabel } from "./payment-cells";

/** Ask the provider again about a payment that is not successful yet (a lost callback, a
 * late success). The server applies the provider's answer exactly like a callback and
 * never sets a status by itself; it refuses a successful payment (409) and more than one
 * query per payment per cooldown (429 — the dialog shows how long to wait). The page
 * reloads its server data afterwards. Successful payments get no button: they are final. */
export function ReverifyButton({ payment }: { payment: AdminPaymentDetail }) {
  const { t } = useI18n();
  const router = useRouter();
  const { notify } = useToast();
  const [open, setOpen] = useState(false);

  if (payment.status === "success") return null;

  async function reverify() {
    const after = await apiFetch<AdminPaymentDetail>(`/admin/payments/${payment.payment_id}/reverify/`, { method: "POST" });
    setOpen(false);
    notify(
      after.status === payment.status
        ? t("reverify.unchanged")
        : t("reverify.changed", { from: t(`paymentStatus.${payment.status}`), to: t(`paymentStatus.${after.status}`) }),
    );
    router.refresh();
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <RefreshCw aria-hidden />
        {t("reverify.open")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("reverify.title")}
        description={t("reverify.description", { provider: codeLabel(t, "payProvider", payment.provider) })}
        confirmLabel={t("reverify.confirm")}
        pendingLabel={t("reverify.pending")}
        confirmVariant="primary"
        onConfirm={reverify}
        describe={(error) => {
          // Already successful (someone else's check got there first): show the page's
          // current state behind the dialog.
          if (error instanceof ApiError && error.status === 409) router.refresh();
          return { message: describeError(error, t) };
        }}
      />
    </>
  );
}
