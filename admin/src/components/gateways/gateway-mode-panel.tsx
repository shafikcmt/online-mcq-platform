"use client";

import { CheckCircle2, Circle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { FormSection } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { issueText } from "@/lib/gateway-form";
import { useI18n } from "@/lib/i18n/provider";
import type { Adapter, Gateway } from "@/types/gateways";

import { ModeBadge } from "./gateway-parts";
import { PasswordConfirmDialog } from "./password-confirm-dialog";

/** Sandbox ⇄ live. Going live is allowed by the server only with the live credentials and
 * one successful sandbox payment on this gateway: both are listed here as a checklist, and
 * the button stays off until they are done. Every switch asks for the admin's password. */
export function GatewayModePanel({
  gateway,
  adapter,
  onChanged,
}: {
  gateway: Gateway;
  adapter: Adapter | undefined;
  onChanged: (gateway: Gateway) => void;
}) {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const [confirming, setConfirming] = useState(false);
  const target = gateway.mode === "live" ? "sandbox" : "live";
  const blockers = target === "live" ? gateway.live_blockers : [];

  async function change(password: string) {
    const next = await apiFetch<Gateway>(`/admin/payment-gateways/${gateway.id}/mode/`, {
      method: "POST",
      body: { mode: target, password },
    });
    onChanged(next);
    notify(t("gw.modeChanged", { mode: t(`gw.mode.${next.mode}`) }));
  }

  return (
    <FormSection title={t("gw.secMode")}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-ink-muted">{t("gw.modeCurrent")}</span>
        <ModeBadge mode={gateway.mode} />
      </div>
      <p className="text-sm text-ink-muted">{gateway.mode === "live" ? t("gw.modeLiveHelp") : t("gw.modeSandboxHelp")}</p>

      {target === "live" ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">{blockers.length ? t("gw.liveNeeds") : t("gw.liveReady")}</p>
          <ul className="space-y-1.5 text-sm">
            {(blockers.length ? blockers : ["done"]).map((code) => (
              <li key={code} className="flex items-start gap-2">
                {blockers.length ? (
                  <Circle className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-hidden />
                ) : (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-700" aria-hidden />
                )}
                <span>
                  {code === "done"
                    ? t("gw.sandboxProofDone")
                    : code === "no_successful_sandbox_payment"
                      ? t("gw.sandboxProof")
                      : issueText(code, adapter, locale, t)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <Button
          type="button"
          variant={target === "live" ? "primary" : "secondary"}
          disabled={blockers.length > 0}
          onClick={() => setConfirming(true)}
        >
          {t(target === "live" ? "gw.toLive" : "gw.toSandbox")}
        </Button>
      </div>

      <PasswordConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        description={target === "live" ? t("gw.modeLiveConfirm") : undefined}
        onConfirm={change}
      />
    </FormSection>
  );
}
