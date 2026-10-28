"use client";

import { UserCheck, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { ApiError, describeError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import { setUserActive } from "@/lib/user-actions";
import type { AdminUserDetail } from "@/types/users";

/** Deactivate (or activate again) a student account, after a confirmation. Only for
 * students — staff accounts are managed separately, so an admin can never lock themselves
 * or another admin out. The page reloads its data afterwards (also after a conflict). */
export function UserStatusActions({ user }: { user: AdminUserDetail }) {
  const { t } = useI18n();
  const router = useRouter();
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  if (user.role !== "student") return null;
  const deactivating = user.is_active;

  async function confirm() {
    await setUserActive(user.id, !deactivating);
    setOpen(false);
    notify(t(deactivating ? "userStatus.deactivated" : "userStatus.activated"));
    router.refresh();
  }

  return (
    <>
      <Button variant={deactivating ? "danger" : "secondary"} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {deactivating ? <UserX aria-hidden /> : <UserCheck aria-hidden />}
        {t(deactivating ? "userStatus.deactivateOpen" : "userStatus.activateOpen")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t(deactivating ? "userStatus.deactivateTitle" : "userStatus.activateTitle")}
        description={t(deactivating ? "userStatus.deactivateDescription" : "userStatus.activateDescription", { name: user.full_name })}
        confirmLabel={t(deactivating ? "userStatus.deactivateConfirm" : "userStatus.activateConfirm")}
        pendingLabel={t("userStatus.pending")}
        cancelLabel={t(deactivating ? "userStatus.keepActive" : "userStatus.keepInactive")}
        confirmVariant={deactivating ? "danger" : "primary"}
        onConfirm={confirm}
        describe={(error) => {
          if (error instanceof ApiError && error.status === 409) router.refresh();
          return { message: describeError(error, t) };
        }}
      />
    </>
  );
}
