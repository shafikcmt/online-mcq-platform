"use client";

import { useId, useState, type FormEvent } from "react";

import { BilingualField } from "@/components/ui/bilingual-field";
import { Button } from "@/components/ui/button";
import { Field, FormErrors, Input, Select, Switch } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { apiFetch } from "@/lib/api/client";
import { describeError } from "@/lib/api/errors";
import { isValidationError, mapFieldErrors, type MappedErrors } from "@/lib/api/field-errors";
import { DESCRIPTION_MAX_LENGTH, MAX_SORT_ORDER, NAME_MAX_LENGTH, SLUG_MAX_LENGTH } from "@/lib/content-limits";
import { useI18n } from "@/lib/i18n/provider";
import { localized } from "@/lib/localized";
import type { Category, Subject } from "@/types/content";

type Kind = "category" | "subject";
type Entry = Category | Subject;

const FIELDS = ["name_bn", "name_en", "slug", "description_bn", "description_en", "sort_order", "is_active", "category"];

type FormState = {
  name_bn: string;
  name_en: string;
  slug: string;
  description_bn: string;
  description_en: string;
  sort_order: string;
  is_active: boolean;
  category: string;
};

function initialState(entry: Entry | null, defaultCategory?: number): FormState {
  return {
    name_bn: entry?.name_bn ?? "",
    name_en: entry?.name_en ?? "",
    slug: entry?.slug ?? "",
    description_bn: entry?.description_bn ?? "",
    description_en: entry?.description_en ?? "",
    sort_order: String(entry?.sort_order ?? 0),
    is_active: entry?.is_active ?? true,
    category: entry && "category" in entry ? String(entry.category) : defaultCategory ? String(defaultCategory) : "",
  };
}

const NO_ERRORS: MappedErrors = { fields: {}, form: [] };

/** Create/edit form for a category or a subject, in a dialog (both are short records).
 * The dialog stays open on errors: field errors appear under their fields, anything
 * else above the form. Mount it with a `key` per record so it starts fresh. */
export function CatalogFormDialog({
  kind,
  entry,
  categories = [],
  defaultCategory,
  open,
  onOpenChange,
  onSaved,
}: {
  kind: Kind;
  entry: Entry | null;
  categories?: Category[];
  defaultCategory?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (entry: Entry, created: boolean) => void;
}) {
  const { locale, t } = useI18n();
  const formId = useId();
  const [form, setForm] = useState(() => initialState(entry, defaultCategory));
  const [errors, setErrors] = useState<MappedErrors>(NO_ERRORS);
  const [pending, setPending] = useState(false);
  const isSubject = kind === "subject";
  const base = isSubject ? "/admin/subjects/" : "/admin/categories/";
  const prefix = isSubject ? "subjects" : "categories";

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setErrors(NO_ERRORS);
    const body: Record<string, unknown> = {
      name_bn: form.name_bn,
      name_en: form.name_en,
      slug: form.slug.trim(),
      description_bn: form.description_bn,
      description_en: form.description_en,
      sort_order: form.sort_order.trim() === "" ? 0 : Number(form.sort_order),
      is_active: form.is_active,
    };
    if (isSubject) body.category = form.category ? Number(form.category) : null;
    try {
      const saved = await apiFetch<Entry>(entry ? `${base}${entry.id}/` : base, {
        method: entry ? "PATCH" : "POST",
        body,
      });
      onSaved(saved, !entry);
    } catch (error) {
      if (isValidationError(error)) {
        setErrors(mapFieldErrors(error, (key) => FIELDS.includes(key)));
      } else {
        setErrors({ fields: {}, form: [describeError(error, t)] });
      }
    } finally {
      setPending(false);
    }
  }

  const fieldError = (key: string) => errors.fields[key];
  const title = t(entry ? `${prefix}.editTitle` : `${prefix}.createTitle`);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
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
        <FormErrors
          messages={errors.form}
          title={Object.keys(errors.fields).length ? t("form.errorSummary") : undefined}
        />
        {isSubject && (
          <Field id={`${formId}-category`} label={t("subjects.category")} required error={fieldError("category")}>
            <Select value={form.category} onChange={(event) => set("category", event.target.value)}>
              <option value="">{t("subjects.chooseCategory")}</option>
              {categories.map((category) => {
                const name = localized(locale, category.name_bn, category.name_en);
                return (
                  <option key={category.id} value={category.id} lang={name.lang}>
                    {name.text}
                  </option>
                );
              })}
            </Select>
          </Field>
        )}
        <BilingualField
          id={`${formId}-name`}
          label={t("field.name")}
          hint={t("bilingual.oneRequired")}
          required
          maxLength={NAME_MAX_LENGTH}
          values={{ bn: form.name_bn, en: form.name_en }}
          onChange={(lang, value) => set(lang === "bn" ? "name_bn" : "name_en", value)}
          errors={{ bn: fieldError("name_bn"), en: fieldError("name_en") }}
        />
        <BilingualField
          id={`${formId}-description`}
          label={`${t("field.description")} (${t("common.optional")})`}
          multiline
          rows={3}
          maxLength={DESCRIPTION_MAX_LENGTH}
          values={{ bn: form.description_bn, en: form.description_en }}
          onChange={(lang, value) => set(lang === "bn" ? "description_bn" : "description_en", value)}
          errors={{ bn: fieldError("description_bn"), en: fieldError("description_en") }}
        />
        <div className="grid gap-5 sm:grid-cols-[1fr_10rem]">
          <Field id={`${formId}-slug`} label={t("field.slug")} optional hint={t("field.slugHint")} error={fieldError("slug")}>
            <Input
              value={form.slug}
              maxLength={SLUG_MAX_LENGTH}
              autoComplete="off"
              spellCheck={false}
              lang="en"
              onChange={(event) => set("slug", event.target.value)}
            />
          </Field>
          <Field id={`${formId}-sort`} label={t("field.sortOrder")} hint={t("field.sortOrderHint")} error={fieldError("sort_order")}>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_SORT_ORDER}
              step={1}
              value={form.sort_order}
              onChange={(event) => set("sort_order", event.target.value)}
            />
          </Field>
        </div>
        <Switch
          id={`${formId}-active`}
          label={t("field.active")}
          hint={t("field.activeHint")}
          checked={form.is_active}
          onChange={(value) => set("is_active", value)}
        />
        {fieldError("is_active") && <p className="text-[13px] text-danger-700">{fieldError("is_active")}</p>}
      </form>
    </Modal>
  );
}
