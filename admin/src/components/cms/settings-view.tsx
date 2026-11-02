"use client";

import { Info } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import { BilingualField } from "@/components/ui/bilingual-field";
import { Button } from "@/components/ui/button";
import { Field, FormErrors, FormSection, Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { describeError } from "@/lib/api/errors";
import { isValidationError, mapFieldErrors, type MappedErrors } from "@/lib/api/field-errors";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { useUnsavedGuard } from "@/lib/use-unsaved-guard";
import { LEADERBOARD_NAME_MODES, type LanguageCode, type LeaderboardNameMode, type SiteSettings } from "@/types/cms";

type Draft = Omit<SiteSettings, "updated_at">;
const FIELDS: (keyof Draft)[] = [
  "platform_name_bn",
  "platform_name_en",
  "tagline_bn",
  "tagline_en",
  "address_bn",
  "address_en",
  "contact_email",
  "contact_phone",
  "app_download_url",
  "app_open_url",
  "default_language",
  "public_leaderboard_name_mode",
  "app_leaderboard_name_mode",
];
const NO_ERRORS: MappedErrors = { fields: {}, form: [] };

function draftOf(settings: SiteSettings): Draft {
  return Object.fromEntries(FIELDS.map((field) => [field, settings[field]])) as Draft;
}

/** The single site-settings record: one form, saved with PATCH (only the changed fields;
 * the server normalizes, validates the URLs/e-mail/phone and audits the change). Leaving
 * with unsaved changes asks first, like the other editors. */
export function SettingsView({ settings: initial }: { settings: SiteSettings }) {
  const { locale, t } = useI18n();
  const { notify } = useToast();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const [errors, setErrors] = useState<MappedErrors>(NO_ERRORS);
  const [busy, setBusy] = useState(false);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const changed = FIELDS.filter((field) => draft[field] !== saved[field]);
  const guard = useUnsavedGuard(changed.length > 0);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const error = (field: string) => errors.fields[field];

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!changed.length) {
      notify(t("settings.unchanged"));
      return;
    }
    setBusy(true);
    setErrors(NO_ERRORS);
    try {
      const body = Object.fromEntries(changed.map((field) => [field, draft[field]]));
      const next = await apiFetch<SiteSettings>("/admin/settings/", { method: "PATCH", body });
      setSaved(next);
      setDraft(draftOf(next)); // the server's normalized values
      notify(t("settings.saved"));
    } catch (failure) {
      if (isValidationError(failure)) setErrors(mapFieldErrors(failure, (key) => (FIELDS as string[]).includes(key)));
      else setErrors({ fields: {}, form: [describeError(failure, t)] });
    } finally {
      setBusy(false);
    }
  }

  const pair = (name: "platform_name" | "tagline" | "address", label: string, maxLength: number, multiline = false) => (
    <BilingualField
      id={`settings-${name}`}
      label={label}
      maxLength={maxLength}
      multiline={multiline}
      rows={multiline ? 2 : undefined}
      values={{ bn: draft[`${name}_bn`], en: draft[`${name}_en`] }}
      onChange={(lang, value) => set(`${name}_${lang}`, value)}
      errors={{ bn: error(`${name}_bn`), en: error(`${name}_en`) }}
      disabled={busy}
    />
  );
  const nameMode = (field: "public_leaderboard_name_mode" | "app_leaderboard_name_mode", label: string) => (
    <Field id={`settings-${field}`} label={label} hint={t("settings.leaderboardHint")} error={error(field)}>
      <Select value={draft[field]} onChange={(event) => set(field, event.target.value as LeaderboardNameMode)} disabled={busy}>
        {LEADERBOARD_NAME_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {t(`nameMode.${mode}`)}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <form noValidate onSubmit={save} className="space-y-6">
      <PageHeader
        title={t("settings.title")}
        subtitle={t("settings.subtitle")}
        actions={
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            {busy ? t("common.saving") : t("settings.save")}
          </Button>
        }
      />
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
        <Info className="size-4 shrink-0" aria-hidden />
        {saved.updated_at ? t("settings.lastSaved", { when: formatDateTime(saved.updated_at, locale) }) : t("settings.neverSaved")}
        {changed.length > 0 && <span className="font-medium text-warning-700">{t("settings.unsaved")}</span>}
      </p>
      <FormErrors messages={errors.form} title={Object.keys(errors.fields).length ? t("form.errorSummary") : undefined} />

      <FormSection title={t("settings.sectionIdentity")}>
        {pair("platform_name", t("settings.platformName"), 120)}
        {pair("tagline", t("settings.tagline"), 200)}
      </FormSection>

      <FormSection title={t("settings.sectionContact")}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="settings-email" label={t("settings.email")} optional error={error("contact_email")}>
            <Input type="email" inputMode="email" autoComplete="off" lang="en" maxLength={254} value={draft.contact_email} onChange={(event) => set("contact_email", event.target.value)} disabled={busy} />
          </Field>
          <Field id="settings-phone" label={t("settings.phone")} optional error={error("contact_phone")}>
            <Input type="tel" inputMode="tel" autoComplete="off" lang="en" maxLength={30} value={draft.contact_phone} onChange={(event) => set("contact_phone", event.target.value)} disabled={busy} />
          </Field>
        </div>
        {pair("address", t("settings.address"), 300, true)}
      </FormSection>

      <FormSection title={t("settings.sectionApp")}>
        <Field id="settings-download" label={t("settings.downloadUrl")} optional hint={t("settings.downloadUrlHint")} error={error("app_download_url")}>
          <Input type="url" inputMode="url" autoComplete="off" lang="en" maxLength={500} value={draft.app_download_url} onChange={(event) => set("app_download_url", event.target.value)} disabled={busy} />
        </Field>
        <Field id="settings-open" label={t("settings.openUrl")} optional hint={t("settings.openUrlHint")} error={error("app_open_url")}>
          <Input inputMode="url" autoComplete="off" lang="en" maxLength={500} value={draft.app_open_url} onChange={(event) => set("app_open_url", event.target.value)} disabled={busy} />
        </Field>
      </FormSection>

      <FormSection title={t("settings.sectionDisplay")}>
        <Field id="settings-language" label={t("settings.defaultLanguage")} hint={t("settings.defaultLanguageHint")} error={error("default_language")} className="sm:max-w-xs">
          <Select value={draft.default_language} onChange={(event) => set("default_language", event.target.value as LanguageCode)} disabled={busy}>
            <option value="bn">{t("language.bn")}</option>
            <option value="en">{t("language.en")}</option>
          </Select>
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          {nameMode("public_leaderboard_name_mode", t("settings.publicLeaderboard"))}
          {nameMode("app_leaderboard_name_mode", t("settings.appLeaderboard"))}
        </div>
      </FormSection>

      <div className="flex justify-end">
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          {busy ? t("common.saving") : t("settings.save")}
        </Button>
      </div>

      <Modal
        open={guard.pending !== null}
        onOpenChange={(open) => !open && guard.cancel()}
        title={t("package.unsavedTitle")}
        description={t("settings.unsavedBody")}
        size="sm"
        role="alertdialog"
        initialFocus={keepEditingRef}
        footer={
          <>
            <Button ref={keepEditingRef} variant="secondary" onClick={guard.cancel}>
              {t("package.keepEditing")}
            </Button>
            <Button variant="danger" onClick={guard.discard}>
              {guard.pending && "action" in guard.pending ? t("package.discardSignOut") : t("package.discard")}
            </Button>
          </>
        }
      />
    </form>
  );
}
