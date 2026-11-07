"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, FormErrors, FormSection, Input, Switch, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { ApiError, describeError } from "@/lib/api/errors";
import { CURRENCIES, settingsChanges, settingsDraft, type SettingsDraft } from "@/lib/gateway-form";
import { useI18n } from "@/lib/i18n/provider";
import type { Adapter, Gateway } from "@/types/gateways";

import { SchemaField } from "./gateway-parts";

const first = (errors?: string[]) => errors?.[0];

/** Display names, limits, website/app availability and return addresses, and the provider's
 * own options (rendered from its schema). Saves only what changed; the API validates. */
export function GatewaySettingsForm({
  gateway,
  adapter,
  onSaved,
}: {
  gateway: Gateway;
  adapter: Adapter | undefined;
  onSaved: (gateway: Gateway) => void;
}) {
  const { t } = useI18n();
  const { notify } = useToast();
  const [draft, setDraft] = useState<SettingsDraft>(() => settingsDraft(gateway, adapter));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const body = settingsChanges(gateway, draft, adapter);
    if (!Object.keys(body).length) {
      notify(t("gw.unchanged"));
      return;
    }
    setBusy(true);
    setFieldErrors({});
    setFormError([]);
    try {
      const next = await apiFetch<Gateway>(`/admin/payment-gateways/${gateway.id}/`, { method: "PATCH", body });
      onSaved(next);
      setDraft(settingsDraft(next, adapter));
      notify(t("gw.settingsSaved"));
    } catch (failure) {
      if (failure instanceof ApiError && Object.keys(failure.fieldErrors).length) setFieldErrors(failure.fieldErrors);
      else setFormError([describeError(failure, t)]);
    } finally {
      setBusy(false);
    }
  }

  const toggleCurrency = (code: string, on: boolean) =>
    set("currencies", on ? [...new Set([...draft.currencies, code])] : draft.currencies.filter((c) => c !== code));

  return (
    <form onSubmit={save} className="space-y-6" noValidate>
      <FormErrors messages={formError} />

      <FormSection title={t("gw.secSettings")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="gw-name-en" label={t("gw.nameEn")} error={first(fieldErrors.name_en)} required>
            <Input id="gw-name-en" value={draft.name_en} maxLength={120} onChange={(e) => set("name_en", e.target.value)} />
          </Field>
          <Field id="gw-name-bn" label={t("gw.nameBn")} error={first(fieldErrors.name_bn)} labelLang="bn">
            <Input id="gw-name-bn" lang="bn" value={draft.name_bn} maxLength={120} onChange={(e) => set("name_bn", e.target.value)} />
          </Field>
          <Field id="gw-desc-en" label={t("gw.descEn")} error={first(fieldErrors.description_en)}>
            <Textarea id="gw-desc-en" rows={2} value={draft.description_en} maxLength={300} onChange={(e) => set("description_en", e.target.value)} />
          </Field>
          <Field id="gw-desc-bn" label={t("gw.descBn")} error={first(fieldErrors.description_bn)} labelLang="bn">
            <Textarea id="gw-desc-bn" lang="bn" rows={2} value={draft.description_bn} maxLength={300} onChange={(e) => set("description_bn", e.target.value)} />
          </Field>
        </div>
        <Field id="gw-logo" label={t("gw.logo")} hint={t("gw.logoHint")} error={first(fieldErrors.logo_url)}>
          <Input id="gw-logo" type="url" value={draft.logo_url} onChange={(e) => set("logo_url", e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="gw-priority" label={t("gw.priorityLabel")} hint={t("gw.priorityHint")} error={first(fieldErrors.priority)}>
            <Input id="gw-priority" inputMode="numeric" value={draft.priority} onChange={(e) => set("priority", e.target.value)} />
          </Field>
          <Field id="gw-min" label={t("gw.minAmount")} hint={t("gw.limitHint")} error={first(fieldErrors.min_amount)}>
            <Input id="gw-min" inputMode="decimal" value={draft.min_amount} onChange={(e) => set("min_amount", e.target.value)} />
          </Field>
          <Field id="gw-max" label={t("gw.maxAmount")} hint={t("gw.limitHint")} error={first(fieldErrors.max_amount) ?? first(fieldErrors.non_field_errors)}>
            <Input id="gw-max" inputMode="decimal" value={draft.max_amount} onChange={(e) => set("max_amount", e.target.value)} />
          </Field>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">{t("gw.currencies")}</legend>
          {CURRENCIES.map((code) => (
            <Switch
              key={code}
              id={`gw-currency-${code}`}
              label={code}
              checked={draft.currencies.includes(code)}
              onChange={(on) => toggleCurrency(code, on)}
            />
          ))}
          {first(fieldErrors.currencies) ? <p className="text-sm text-danger-700">{first(fieldErrors.currencies)}</p> : null}
        </fieldset>
      </FormSection>

      <FormSection title={t("gw.secChannels")}>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-3">
            <Switch id="gw-web" label={t("gw.webEnabled")} checked={draft.web_enabled} onChange={(on) => set("web_enabled", on)} />
            <Field id="gw-web-return" label={t("gw.webReturn")} hint={t("gw.webReturnHint")} error={first(fieldErrors.web_return_url)}>
              <Input id="gw-web-return" type="url" value={draft.web_return_url} onChange={(e) => set("web_return_url", e.target.value)} />
            </Field>
          </div>
          <div className="space-y-3">
            <Switch id="gw-app" label={t("gw.appEnabled")} checked={draft.app_enabled} onChange={(on) => set("app_enabled", on)} />
            <Field id="gw-app-return" label={t("gw.appReturn")} hint={t("gw.appReturnHint")} error={first(fieldErrors.app_return_url)}>
              <Input id="gw-app-return" value={draft.app_return_url} onChange={(e) => set("app_return_url", e.target.value)} />
            </Field>
          </div>
        </div>
      </FormSection>

      {adapter && adapter.options.length ? (
        <FormSection title={t("gw.secOptions")}>
          <div className="grid gap-4 sm:grid-cols-2">
            {adapter.options.map((field) => (
              <SchemaField
                key={field.name}
                idPrefix="gw-opt"
                field={field}
                value={draft.options[field.name] ?? ""}
                error={first(fieldErrors[`options.${field.name}`])}
                onChange={(value) => set("options", { ...draft.options, [field.name]: value })}
              />
            ))}
          </div>
        </FormSection>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>
          {t("gw.saveSettings")}
        </Button>
      </div>
    </form>
  );
}
