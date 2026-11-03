"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, FormErrors, FormSection, Input, Select, Switch, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { describeError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import type { SmsGateway, SmsNumberFormat } from "@/types/sms";

type Draft = {
  enabled: boolean;
  api_url: string;
  sender_id: string;
  number_format: SmsNumberFormat;
  body: string;
  success_codes: string;
  retry_codes: string;
  code_field: string;
};

function draftOf(gateway: SmsGateway): Draft {
  return {
    enabled: gateway.enabled,
    api_url: gateway.api_url,
    sender_id: gateway.sender_id,
    number_format: gateway.number_format,
    body: JSON.stringify(gateway.request_template, null, 2),
    success_codes: gateway.success_codes.join(", "),
    retry_codes: gateway.retry_codes.join(", "),
    code_field: gateway.code_field,
  };
}

const list = (text: string) => text.split(",").map((part) => part.trim()).filter(Boolean);

/** One screen to choose and configure the OTP SMS provider. Saves only changed fields;
 * the API key is typed fresh and never shown again. */
export function SmsGatewayView({ gateway: initial }: { gateway: SmsGateway }) {
  const { t } = useI18n();
  const { notify } = useToast();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [preset, setPreset] = useState("");
  const [formError, setFormError] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  function applyPreset(key: string) {
    setPreset(key);
    const chosen = saved.presets[key];
    if (!chosen) return;
    setDraft((d) => ({
      ...d,
      api_url: chosen.api_url,
      number_format: chosen.number_format,
      body: JSON.stringify(chosen.request_template, null, 2),
      success_codes: chosen.success_codes.join(", "),
      retry_codes: chosen.retry_codes.join(", "),
      code_field: chosen.code_field,
    }));
    notify(t("sms.presetLoaded"));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    let template: unknown;
    try {
      template = JSON.parse(draft.body);
    } catch {
      setFormError([t("sms.bodyInvalid")]);
      return;
    }
    const body: Record<string, unknown> = {};
    if (draft.enabled !== saved.enabled) body.enabled = draft.enabled;
    if (draft.api_url !== saved.api_url) body.api_url = draft.api_url;
    if (draft.sender_id !== saved.sender_id) body.sender_id = draft.sender_id;
    if (draft.number_format !== saved.number_format) body.number_format = draft.number_format;
    if (JSON.stringify(template) !== JSON.stringify(saved.request_template)) body.request_template = template;
    if (draft.success_codes !== saved.success_codes.join(", ")) body.success_codes = list(draft.success_codes);
    if (draft.retry_codes !== saved.retry_codes.join(", ")) body.retry_codes = list(draft.retry_codes);
    if (draft.code_field !== saved.code_field) body.code_field = draft.code_field;
    if (apiKey) body.api_key = apiKey;
    if (clearKey) body.clear_api_key = true;
    if (!Object.keys(body).length) {
      notify(t("sms.unchanged"));
      return;
    }
    setBusy(true);
    setFormError([]);
    try {
      const next = await apiFetch<SmsGateway>("/admin/sms/gateway/", { method: "PATCH", body });
      setSaved(next);
      setDraft(draftOf(next));
      setApiKey("");
      setClearKey(false);
      notify(t("sms.saved"));
    } catch (failure) {
      setFormError([describeError(failure, t)]);
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (testing || !phone.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      await apiFetch("/admin/sms/test/", { method: "POST", body: { phone: phone.trim() } });
      setTestResult({ ok: true, text: t("sms.testOk") });
    } catch (failure) {
      setTestResult({ ok: false, text: t("sms.testFail") + describeError(failure, t) });
    } finally {
      setTesting(false);
    }
  }

  const presetEntries = Object.entries(saved.presets);
  const providerLabel = saved.enabled ? "http-gateway" : saved.active_provider;

  return (
    <div className="space-y-6">
      <PageHeader title={t("sms.title")} subtitle={t("sms.subtitle")} />

      <div className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-ink-muted">{t("sms.statusActive")}</p>
          <p className="font-medium">{providerLabel}</p>
          {!saved.enabled ? <p className="text-xs text-ink-muted">{t("sms.statusEnvironment")}</p> : null}
        </div>
        {!saved.secret_storage_ready ? (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            {t("sms.secretMissing")}
          </p>
        ) : null}
      </div>

      <form onSubmit={save} className="space-y-6">
        <FormErrors messages={formError} />

        <FormSection title={t("sms.sectionEnable")}>
          <Switch
            id="sms-enabled"
            label={t("sms.enable")}
            hint={t("sms.enableHint")}
            checked={draft.enabled}
            onChange={(checked) => set("enabled", checked)}
          />
        </FormSection>

        <FormSection title={t("sms.sectionConnection")}>
          <div className="flex flex-wrap items-end gap-3">
            <Field id="sms-preset" label={t("sms.preset")} className="min-w-56 flex-1">
              <Select id="sms-preset" value={preset} onChange={(e) => setPreset(e.target.value)}>
                <option value="">{t("sms.presetCustom")}</option>
                {presetEntries.map(([key, value]) => (
                  <option key={key} value={key}>
                    {value.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="button" variant="secondary" disabled={!preset} onClick={() => applyPreset(preset)}>
              {t("sms.loadPreset")}
            </Button>
          </div>

          <Field id="sms-url" label={t("sms.url")} hint={t("sms.urlHint")}>
            <Input id="sms-url" type="url" value={draft.api_url} onChange={(e) => set("api_url", e.target.value)} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="sms-sender" label={t("sms.sender")}>
              <Input id="sms-sender" value={draft.sender_id} onChange={(e) => set("sender_id", e.target.value)} maxLength={20} />
            </Field>
            <Field id="sms-format" label={t("sms.numberFormat")}>
              <Select
                id="sms-format"
                value={draft.number_format}
                onChange={(e) => set("number_format", e.target.value as SmsNumberFormat)}
              >
                <option value="without_plus">{t("sms.numWithout")}</option>
                <option value="with_plus">{t("sms.numWithPlus")}</option>
                <option value="local">{t("sms.numLocal")}</option>
              </Select>
            </Field>
          </div>

          <Field
            id="sms-key"
            label={t("sms.apiKey")}
            hint={saved.has_api_key ? `${t("sms.apiKeyStored")} (…${saved.api_key_hint})` : t("sms.apiKeyEmpty")}
          >
            <Input
              id="sms-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={saved.has_api_key ? "••••••••" : ""}
              disabled={!saved.secret_storage_ready}
            />
            <p className="mt-1 text-xs text-ink-muted">{t("sms.apiKeyHint")}</p>
          </Field>
          {saved.has_api_key ? (
            <Switch id="sms-clear" label={t("sms.clearKey")} checked={clearKey} onChange={setClearKey} />
          ) : null}
        </FormSection>

        <FormSection title={t("sms.sectionResponse")}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="sms-field" label={t("sms.responseField")}>
              <Input id="sms-field" value={draft.code_field} onChange={(e) => set("code_field", e.target.value)} />
            </Field>
            <Field id="sms-success" label={t("sms.successCodes")} hint={t("sms.codesHint")}>
              <Input id="sms-success" value={draft.success_codes} onChange={(e) => set("success_codes", e.target.value)} />
            </Field>
            <Field id="sms-retry" label={t("sms.retryCodes")} hint={t("sms.codesHint")}>
              <Input id="sms-retry" value={draft.retry_codes} onChange={(e) => set("retry_codes", e.target.value)} />
            </Field>
          </div>
        </FormSection>

        <FormSection title={t("sms.sectionBody")}>
          <Field id="sms-body" label={t("sms.sectionBody")} hint={t("sms.bodyHint")}>
            <Textarea id="sms-body" rows={8} className="font-mono text-xs" value={draft.body} onChange={(e) => set("body", e.target.value)} />
          </Field>
        </FormSection>

        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>
            {t("sms.save")}
          </Button>
        </div>
      </form>

      <FormSection title={t("sms.sectionTest")}>
        <div className="flex flex-wrap items-end gap-3">
          <Field id="sms-test-phone" label={t("sms.testPhone")} hint={t("sms.testPhoneHint")} className="min-w-56 flex-1">
            <Input id="sms-test-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" />
          </Field>
          <Button type="button" variant="secondary" disabled={testing || !phone.trim()} onClick={sendTest}>
            {t("sms.testSend")}
          </Button>
        </div>
        {testResult ? (
          <p role="status" className={testResult.ok ? "text-sm text-emerald-700" : "text-sm text-red-700"}>
            {testResult.text}
          </p>
        ) : null}
      </FormSection>
    </div>
  );
}
