"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FormSection, Input } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { fieldLabel, typedCredentials } from "@/lib/gateway-form";
import { useI18n } from "@/lib/i18n/provider";
import type { Adapter, Gateway, GatewayMode } from "@/types/gateways";

import { PasswordConfirmDialog } from "./password-confirm-dialog";

/** Credentials per mode (sandbox and live never share). Every field is write-only: a saved
 * value is shown only as "Saved (…last 4)", and an empty box keeps what is stored. Saving
 * asks for the admin's password again. Nothing typed here is kept after saving. */
export function GatewayCredentials({
  gateway,
  adapter,
  onSaved,
}: {
  gateway: Gateway;
  adapter: Adapter | undefined;
  onSaved: (gateway: Gateway) => void;
}) {
  const { t, locale } = useI18n();
  if (!adapter || !adapter.implemented) {
    return (
      <FormSection title={t("gw.secCredentials")}>
        <p className="text-sm text-ink-muted">{t("gw.credUnavailable")}</p>
      </FormSection>
    );
  }
  const modes: GatewayMode[] = ["sandbox", "live"];
  return (
    <FormSection title={t("gw.secCredentials")} description={t("gw.credNote")}>
      <div className="grid gap-6 lg:grid-cols-2">
        {modes.map((mode) => (
          <ModeCredentials key={mode} gateway={gateway} adapter={adapter} mode={mode} locale={locale} onSaved={onSaved} />
        ))}
      </div>
    </FormSection>
  );
}

function ModeCredentials({
  gateway,
  adapter,
  mode,
  locale,
  onSaved,
}: {
  gateway: Gateway;
  adapter: Adapter;
  mode: GatewayMode;
  locale: "en" | "bn";
  onSaved: (gateway: Gateway) => void;
}) {
  const { t } = useI18n();
  const { notify } = useToast();
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const state = gateway.credentials[mode];
  const values = typedCredentials(typed);

  async function save(password: string) {
    const result = await apiFetch<{ changed: string[]; gateway: Gateway }>(`/admin/payment-gateways/${gateway.id}/credentials/`, {
      method: "POST",
      body: { mode, values, password },
    });
    setTyped({});
    onSaved(result.gateway);
    notify(t("gw.credSaved"));
  }

  return (
    <div className="space-y-4 rounded-card border border-line p-4" data-mode={mode}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{t(mode === "live" ? "gw.credLive" : "gw.credSandbox")}</h3>
        {gateway.mode === mode ? <StatusBadge status={mode} label={t("gw.credCurrent")} /> : null}
      </div>
      {adapter.credentials.map((field) => {
        const saved = state?.[field.name];
        const id = `gw-cred-${mode}-${field.name}`;
        const hint = saved?.set ? (saved.hint ? t("gw.credSet", { hint: saved.hint }) : t("gw.credSetNoHint")) : t("gw.credNotSet");
        return (
          <Field key={field.name} id={id} label={fieldLabel(field, locale)} hint={hint}>
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              value={typed[field.name] ?? ""}
              placeholder={saved?.set ? "••••••••" : ""}
              onChange={(event) => setTyped((current) => ({ ...current, [field.name]: event.target.value }))}
            />
          </Field>
        );
      })}
      <div className="flex justify-end">
        <Button
          type="button"
          variant="secondary"
          disabled={Object.keys(values).length === 0}
          onClick={() => setConfirming(true)}
          title={Object.keys(values).length === 0 ? t("gw.credNothing") : undefined}
        >
          {t("gw.credSave")}
        </Button>
      </div>
      <PasswordConfirmDialog open={confirming} onOpenChange={setConfirming} onConfirm={save} />
    </div>
  );
}
