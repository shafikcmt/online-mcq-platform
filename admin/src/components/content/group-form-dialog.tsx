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
import type { Category, ExamGroup } from "@/types/content";

const FIELDS = ["name_bn", "name_en", "slug", "description_bn", "description_en", "sort_order", "is_active", "category", "parent"];

type FormState = {
  name_bn: string;
  name_en: string;
  slug: string;
  description_bn: string;
  description_en: string;
  sort_order: string;
  is_active: boolean;
  category: string;
  parent: string;
};

function initialState(entry: ExamGroup | null, defaultCategory?: number): FormState {
  return {
    name_bn: entry?.name_bn ?? "",
    name_en: entry?.name_en ?? "",
    slug: entry?.slug ?? "",
    description_bn: entry?.description_bn ?? "",
    description_en: entry?.description_en ?? "",
    sort_order: String(entry?.sort_order ?? 0),
    is_active: entry?.is_active ?? true,
    category: entry ? String(entry.category) : defaultCategory ? String(defaultCategory) : "",
    parent: entry?.parent ? String(entry.parent) : "",
  };
}

const NO_ERRORS: MappedErrors = { fields: {}, form: [] };

/** Create/edit form for an exam group, in a dialog. A group is in one category; to make a
 * sub-group, pick a top-level group of the same category as its parent (the server allows two
 * levels). The dialog stays open on errors. Mount it with a `key` per record. */
export function GroupFormDialog({
  entry,
  categories,
  groups,
  defaultCategory,
  open,
  onOpenChange,
  onSaved,
}: {
  entry: ExamGroup | null;
  categories: Category[];
  /** Every group: the parent menu offers the top-level ones of the chosen category. */
  groups: ExamGroup[];
  defaultCategory?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (entry: ExamGroup, created: boolean) => void;
}) {
  const { locale, t } = useI18n();
  const formId = useId();
  const [form, setForm] = useState(() => initialState(entry, defaultCategory));
  const [errors, setErrors] = useState<MappedErrors>(NO_ERRORS);
  const [pending, setPending] = useState(false);
  // A group that already has sub-groups cannot become one itself; a group cannot be its own parent.
  const parentChoices = groups.filter(
    (group) => group.category === Number(form.category) && group.parent === null && group.id !== entry?.id,
  );
  const hasChildren = Boolean(entry && entry.child_count > 0);

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
      category: form.category ? Number(form.category) : null,
      parent: form.parent ? Number(form.parent) : null,
    };
    try {
      const saved = await apiFetch<ExamGroup>(entry ? `/admin/groups/${entry.id}/` : "/admin/groups/", {
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

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t(entry ? "groups.editTitle" : "groups.createTitle")}
      description={t("groups.formHint")}
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
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id={`${formId}-category`} label={t("groups.category")} required error={fieldError("category")}>
            <Select
              value={form.category}
              // Another category's parent is invalid: the choice is cleared with it.
              onChange={(event) => setForm((current) => ({ ...current, category: event.target.value, parent: "" }))}
            >
              <option value="">{t("groups.chooseCategory")}</option>
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
          <Field id={`${formId}-parent`} label={t("groups.parent")} optional hint={t("groups.parentHint")} error={fieldError("parent")}>
            <Select value={form.parent} onChange={(event) => set("parent", event.target.value)} disabled={!form.category || hasChildren}>
              <option value="">{form.category ? t("groups.noParent") : t("groups.chooseCategoryFirst")}</option>
              {parentChoices.map((group) => {
                const name = localized(locale, group.name_bn, group.name_en);
                return (
                  <option key={group.id} value={group.id} lang={name.lang}>
                    {name.text}
                  </option>
                );
              })}
            </Select>
          </Field>
        </div>
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
