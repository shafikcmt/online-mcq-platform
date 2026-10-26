"use client";

import { useId, useState, type FormEvent } from "react";

import { BilingualField } from "@/components/ui/bilingual-field";
import { Button } from "@/components/ui/button";
import { Field, FormErrors, Input, Select, Switch } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { apiFetch } from "@/lib/api/client";
import { describeError } from "@/lib/api/errors";
import { isValidationError, mapFieldErrors, type MappedErrors } from "@/lib/api/field-errors";
import { MAX_SORT_ORDER } from "@/lib/content-limits";
import { fromDhakaInput, toDhakaInput } from "@/lib/exam-form";
import { useI18n } from "@/lib/i18n/provider";
import { AUDIENCES, CMS_LIMITS, type Announcement, type Audience, type CmsPage, type Faq } from "@/types/cms";

export type CmsKind = "announcement" | "faq" | "page";
type Entry = Announcement | Faq | CmsPage;

/** The bilingual pair of each kind: (first, second) field prefixes, labels and limits. */
const PAIRS = {
  announcement: { first: "title", second: "body", firstLabel: "cms.title", secondLabel: "cms.text", firstMax: CMS_LIMITS.title, secondMax: CMS_LIMITS.announcementBody, rows: 6 },
  faq: { first: "question", second: "answer", firstLabel: "faqs.question", secondLabel: "faqs.answer", firstMax: CMS_LIMITS.faqQuestion, secondMax: CMS_LIMITS.faqAnswer, rows: 5 },
  page: { first: "title", second: "body", firstLabel: "cms.title", secondLabel: "cms.text", firstMax: CMS_LIMITS.title, secondMax: CMS_LIMITS.pageBody, rows: 12 },
} as const;

const PATHS: Record<CmsKind, string> = { announcement: "/admin/announcements/", faq: "/admin/faqs/", page: "/admin/pages/" };
const PREFIX = { announcement: "announcements", faq: "faqs", page: "pages" } as const;

type FormState = {
  first_bn: string;
  first_en: string;
  second_bn: string;
  second_en: string;
  audience: Audience;
  is_pinned: boolean;
  published_at: string; // datetime-local, Asia/Dhaka
  expires_at: string;
  is_active: boolean;
  sort_order: string;
  slug: string;
};

function initialState(kind: CmsKind, entry: Entry | null): FormState {
  const pair = PAIRS[kind];
  const value = (field: string) => (entry ? String((entry as Record<string, unknown>)[field] ?? "") : "");
  const announcement = kind === "announcement" ? (entry as Announcement | null) : null;
  return {
    first_bn: value(`${pair.first}_bn`),
    first_en: value(`${pair.first}_en`),
    second_bn: value(`${pair.second}_bn`),
    second_en: value(`${pair.second}_en`),
    audience: announcement?.audience ?? "all",
    is_pinned: announcement?.is_pinned ?? false,
    published_at: toDhakaInput(announcement?.published_at ?? null),
    expires_at: toDhakaInput(announcement?.expires_at ?? null),
    is_active: entry && "is_active" in entry ? entry.is_active : true,
    sort_order: entry && "sort_order" in entry ? String(entry.sort_order) : "0",
    slug: entry && "slug" in entry ? entry.slug : "",
  };
}

const NO_ERRORS: MappedErrors = { fields: {}, form: [] };

/** Create/edit form for an announcement, an FAQ entry or a page, in a dialog. Mirrors the
 * catalog dialog: the server normalizes and validates (bilingual pairs, the publish
 * window, the slug); its field errors appear under the fields, anything else above the
 * form, and the dialog stays open. Mount with a `key` per record so it starts fresh. */
export function CmsFormDialog({
  kind,
  entry,
  open,
  onOpenChange,
  onSaved,
}: {
  kind: CmsKind;
  entry: Entry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (entry: Entry, created: boolean) => void;
}) {
  const { t } = useI18n();
  const formId = useId();
  const pair = PAIRS[kind];
  const prefix = PREFIX[kind];
  const [form, setForm] = useState(() => initialState(kind, entry));
  const [errors, setErrors] = useState<MappedErrors>(NO_ERRORS);
  const [pending, setPending] = useState(false);

  // Server field name → form field (the pair's own names, plus the kind's extras).
  const fields = [
    `${pair.first}_bn`,
    `${pair.first}_en`,
    `${pair.second}_bn`,
    `${pair.second}_en`,
    ...(kind === "announcement" ? ["audience", "is_pinned", "published_at", "expires_at"] : []),
    ...(kind === "faq" ? ["is_active", "sort_order"] : []),
    ...(kind === "page" ? ["slug", "is_active"] : []),
  ];

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setErrors(NO_ERRORS);
    const body: Record<string, unknown> = {
      [`${pair.first}_bn`]: form.first_bn,
      [`${pair.first}_en`]: form.first_en,
      [`${pair.second}_bn`]: form.second_bn,
      [`${pair.second}_en`]: form.second_en,
    };
    if (kind === "announcement") {
      body.audience = form.audience;
      body.is_pinned = form.is_pinned;
      body.published_at = fromDhakaInput(form.published_at);
      body.expires_at = fromDhakaInput(form.expires_at);
    }
    if (kind === "faq") {
      body.is_active = form.is_active;
      body.sort_order = form.sort_order.trim() === "" ? 0 : Number(form.sort_order);
    }
    if (kind === "page") {
      body.slug = form.slug.trim();
      body.is_active = form.is_active;
    }
    try {
      const saved = await apiFetch<Entry>(entry ? `${PATHS[kind]}${entry.id}/` : PATHS[kind], {
        method: entry ? "PATCH" : "POST",
        body,
      });
      onSaved(saved, !entry);
    } catch (error) {
      if (isValidationError(error)) setErrors(mapFieldErrors(error, (key) => fields.includes(key)));
      else setErrors({ fields: {}, form: [describeError(error, t)] });
    } finally {
      setPending(false);
    }
  }

  const fieldError = (key: string) => errors.fields[key];

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t(entry ? `${prefix}.editTitle` : `${prefix}.createTitle`)}
      description={t(`${prefix}.formHint`)}
      size="lg"
      closeDisabled={pending}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={formId} disabled={pending} aria-busy={pending || undefined}>
            {pending ? t("common.saving") : entry ? t("common.save") : t("common.create")}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="space-y-5">
        <FormErrors messages={errors.form} title={Object.keys(errors.fields).length ? t("form.errorSummary") : undefined} />
        {kind === "page" && (
          <Field id={`${formId}-slug`} label={t("field.slug")} required hint={t("pages.slugHint")} error={fieldError("slug")}>
            <Input
              value={form.slug}
              maxLength={CMS_LIMITS.slug}
              autoComplete="off"
              spellCheck={false}
              lang="en"
              onChange={(event) => set("slug", event.target.value)}
              disabled={pending}
            />
          </Field>
        )}
        <BilingualField
          id={`${formId}-first`}
          label={t(pair.firstLabel)}
          hint={t("bilingual.oneRequired")}
          required
          maxLength={pair.firstMax}
          values={{ bn: form.first_bn, en: form.first_en }}
          onChange={(lang, value) => set(lang === "bn" ? "first_bn" : "first_en", value)}
          errors={{ bn: fieldError(`${pair.first}_bn`), en: fieldError(`${pair.first}_en`) }}
          disabled={pending}
        />
        <BilingualField
          id={`${formId}-second`}
          label={t(pair.secondLabel)}
          multiline
          rows={pair.rows}
          maxLength={pair.secondMax}
          values={{ bn: form.second_bn, en: form.second_en }}
          onChange={(lang, value) => set(lang === "bn" ? "second_bn" : "second_en", value)}
          errors={{ bn: fieldError(`${pair.second}_bn`), en: fieldError(`${pair.second}_en`) }}
          disabled={pending}
        />
        {kind === "announcement" && (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id={`${formId}-audience`} label={t("announcements.audience")} error={fieldError("audience")}>
                <Select value={form.audience} onChange={(event) => set("audience", event.target.value as Audience)} disabled={pending}>
                  {AUDIENCES.map((audience) => (
                    <option key={audience} value={audience}>
                      {t(`audience.${audience}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="sm:pt-7">
                <Switch
                  id={`${formId}-pinned`}
                  label={t("announcements.pinLabel")}
                  hint={t("announcements.pinHint")}
                  checked={form.is_pinned}
                  onChange={(value) => set("is_pinned", value)}
                  disabled={pending}
                />
              </div>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id={`${formId}-publish`} label={t("announcements.publishAt")} optional hint={t("announcements.publishAtHint")} error={fieldError("published_at")}>
                <Input type="datetime-local" value={form.published_at} onChange={(event) => set("published_at", event.target.value)} disabled={pending} />
              </Field>
              <Field id={`${formId}-expires`} label={t("announcements.expiresAt")} optional hint={t("announcements.expiresAtHint")} error={fieldError("expires_at")}>
                <Input type="datetime-local" value={form.expires_at} onChange={(event) => set("expires_at", event.target.value)} disabled={pending} />
              </Field>
            </div>
          </>
        )}
        {kind === "faq" && (
          <Field id={`${formId}-sort`} label={t("field.sortOrder")} hint={t("field.sortOrderHint")} error={fieldError("sort_order")} className="sm:max-w-44">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_SORT_ORDER}
              step={1}
              value={form.sort_order}
              onChange={(event) => set("sort_order", event.target.value)}
              disabled={pending}
            />
          </Field>
        )}
        {kind !== "announcement" && (
          <>
            <Switch
              id={`${formId}-active`}
              label={t("field.active")}
              hint={t(kind === "faq" ? "faqs.activeHint" : "pages.activeHint")}
              checked={form.is_active}
              onChange={(value) => set("is_active", value)}
              disabled={pending}
            />
            {fieldError("is_active") && <p className="text-[13px] text-danger-700">{fieldError("is_active")}</p>}
          </>
        )}
      </form>
    </Modal>
  );
}
