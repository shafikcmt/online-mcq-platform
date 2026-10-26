"use client";

import { Ban, CalendarPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { packageName } from "@/components/packages/package-cells";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { ApiError, describeError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import { cancelSubscription } from "@/lib/subscription-actions";
import type { AdminSubscription } from "@/types/subscriptions";

import { GrantDialog } from "./grant-dialog";

/** Actions on one subscription (detail page): extend it while it runs, or grant the same
 * package again once it has ended; cancel while it runs. Every action is the server's
 * decision — the page reloads its data afterwards (also after a conflict, e.g. someone
 * else cancelled it first). */
export function SubscriptionActions({ subscription }: { subscription: AdminSubscription }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const { notify } = useToast();
  const [granting, setGranting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const running = subscription.effective_status === "active" || subscription.effective_status === "scheduled";
  const pkgName = packageName(subscription.package, locale).text || subscription.package.slug;

  async function cancel() {
    await cancelSubscription(subscription.id);
    setCancelling(false);
    notify(t("cancel.done"));
    router.refresh();
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setGranting(true)} aria-haspopup="dialog">
          <CalendarPlus aria-hidden />
          {t(running ? "grant.extendOpen" : "grant.againOpen")}
        </Button>
        {running && (
          <Button variant="danger" onClick={() => setCancelling(true)} aria-haspopup="dialog">
            <Ban aria-hidden />
            {t("cancel.open")}
          </Button>
        )}
      </div>

      <GrantDialog
        open={granting}
        onOpenChange={setGranting}
        student={subscription.user}
        pkg={subscription.package}
        fixed
        extending={running}
      />
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t("cancel.title")}
        description={t("cancel.description", { name: subscription.user.full_name, package: pkgName })}
        confirmLabel={t("cancel.confirm")}
        pendingLabel={t("cancel.pending")}
        cancelLabel={t("cancel.keep")}
        onConfirm={cancel}
        describe={(error) => {
          // Already cancelled or expired (e.g. by someone else): show the server's reason
          // and refresh the page behind the dialog so it shows the current state.
          if (error instanceof ApiError && error.status === 409) router.refresh();
          return { message: describeError(error, t) };
        }}
      />
    </>
  );
}
