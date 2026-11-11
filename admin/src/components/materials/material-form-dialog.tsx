"use client";

import { useId, useState, type FormEvent } from "react";

import { BilingualField } from "@/components/ui/bilingual-field";
import { Button } from "@/components/ui/button";
import { Field, FormErrors, Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { PdfAttachment } from "@/components/ui/pdf-attachment";
import { apiFetch } from "@/lib/api/client";
import { describeError } from "@/lib/api/errors";
import { isValidationError, mapFieldErrors, type MappedErrors } from "@/lib/api/field-errors";
import { MAX_SORT_ORDER } from "@/lib/content-limits";
import { fromDhakaInput, toDhakaInput } from "@/lib/exam-form";
import { useI18n } from "@/lib/i18n/provider";
import { localized } from "@/lib/localized";
import type { Category, Subject } from "@/types/content";
import { MATERIAL_KINDS, MATERIAL_LIMITS, type Material, type MaterialKind } from "@/types/materials";

export type ExamOption = { id: number; title_bn: string; title_en: string };
export type MaterialLookups = { categories: Category[]; subjects: Subject[]; exams: ExamOption[] };

type Visibility = "now" | "at" | "draft";
const VISIBILITIES: readonly Visibility[] = ["now", "at", "draft"];
const VISIBILITY_LABEL = { now: "mat.visNow", at: "mat.visAt", draft: "mat.visDraft" } as const;

type FormState = {
  kind: MaterialKind;
  title_bn: string;
  title_en: string;
  description_bn: string;
  description_en: string;
  youtube_url: string;
  category: string;
  subject: string;
  exam: string;
  teacher: string;
  sort_order: string;
  visibility: Visibility;
  published_at: string; // datetime-local, Asia/Dhaka
};

function initialState(item: Material | null): FormState {
  return {
    kind: item?.kind ?? "video",
    title_bn: item?.title_bn ?? "",
    title_en: item?.title_en ?? "",
    description_bn: item?.description_bn ?? "",
    description_en: item?.description_en ?? "",
    youtube_url: item?.watch_url ?? "",
    category: item?.category ? String(item.category) : "",
    subject: item?.subject ? String(item.subject) : "",
    exam: item?.exam ? String(item.exam) : "",
    teacher: item?.teacher ?? "",
    sort_order: String(item?.sort_order ?? 0),
    visibility: !item ? "now" : item.published_at ? "at" : "draft",
    published_at: toDhakaInput(item?.published_at ?? null),
  };
}

const FIELDS = ["kind", "title_bn", "title_en", "description_bn", "description_en", "youtube_url", "category", "subject", "exam", "teacher", "sort_order", "published_at", "publish_now"];
const NO_ERRORS: MappedErrors = { fields: {}, form: [] };

/** Create/edit a study material in a dialog. The server validates everything (the YouTube link,
 * title in one language, the subject belonging to the category); its field errors appear under the
 * fields. A PDF material gets its file after the first save. */
export function MaterialFormDialog({
  item,
  lookups,
  open,
  onOpenChange,
  onSaved,
  onPdfChanged,
}: {
  item: Material | null;
  lookups: MaterialLookups;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (item: Material, created: boolean) => void;
  onPdfChanged: () => void;
}) {
  const { locale, t } = useI18n();
  const formId = useId();
  const [form, setForm] = useState(() => initialState(item));
  const [errors, setErrors] = useState<MappedErrors>(NO_ERRORS);
  const [pending, setPending] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const fieldError = (key: string) => errors.fields[key];
  const name = (row: { name_bn: string; name_en: string }) => localized(locale, row.name_bn, row.name_en).text;
  const subjects = lookups.subjects.filter((subject) => !form.category || String(subject.category) === form.category);

  function chooseCategory(value: string) {
    setForm((current) => {
      const stillFits = !current.subject || !value || lookups.subjects.some((s) => String(s.id) === current.subject && String(s.category) === value);
      return { ...current, category: value, subject: stillFits ? current.subject : "" };
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (form.visibility === "at" && !form.published_at.trim()) {
      setErrors({ fields: { published_at: t("mat.publishAtRequired") }, form: [] });
      return;
    }
    setPending(true);
    setErrors(NO_ERRORS);
    const body: Record<string, unknown> = {
      kind: form.kind,
      title_bn: form.title_bn,
      title_en: form.title_en,
      description_bn: form.description_bn,
      description_en: form.description_en,
      category: form.category ? Number(form.category) : null,
      subject: form.subject ? Number(form.subject) : null,
      exam: form.exam ? Number(form.exam) : null,
      teacher: form.teacher,
      sort_order: form.sort_order.trim() === "" ? 0 : Number(form.sort_order),
    };
    if (form.kind === "video") body.youtube_url = form.youtube_url;
    if (form.visibility === "now") body.publish_now = true;
    else body.published_at = form.visibility === "at" ? fromDhakaInput(form.published_at) : null;
    try {
      const saved = await apiFetch<Material>(item ? `/admin/materials/${item.id}/` : "/admin/materials/", { method: item ? "PATCH" : "POST", body });
      onSaved(saved, !item);
    } catch (error) {
      if (isValidationError(error)) setErrors(mapFieldErrors(error, (key) => FIELDS.includes(key)));
      else setErrors({ fields: {}, form: [describeError(error, t)] });
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t(item ? "mat.editTitle" : "mat.createTitle")}
      description={t("mat.formHint")}
      size="lg"
      closeDisabled={pending}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={formId} disabled={pending} aria-busy={pending || undefined}>
            {pending ? t("common.saving") : item ? t("common.save") : t("common.create")}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="space-y-5">
        <FormErrors messages={errors.form} title={Object.keys(errors.fields).length ? t("form.errorSummary") : undefined} />
        <Field id={`${formId}-kind`} label={t("mat.fieldKind")} error={fieldError("kind")} className="sm:max-w-60">
          <Select value={form.kind} onChange={(event) => set("kind", event.target.value as MaterialKind)} disabled={pending || Boolean(item)}>
            {MATERIAL_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`mat.kind.${kind}`)}
              </option>
            ))}
          </Select>
        </Field>
        <BilingualField
          id={`${formId}-title`}
          label={t("mat.fieldTitle")}
          hint={t("bilingual.oneRequired")}
          required
          maxLength={MATERIAL_LIMITS.title}
          values={{ bn: form.title_bn, en: form.title_en }}
          onChange={(lang, value) => set(lang === "bn" ? "title_bn" : "title_en", value)}
          errors={{ bn: fieldError("title_bn"), en: fieldError("title_en") }}
          disabled={pending}
        />
        {form.kind === "video" && (
          <Field id={`${formId}-link`} label={t("mat.fieldLink")} required hint={t("mat.linkHint")} error={fieldError("youtube_url")}>
            <Input
              type="url"
              inputMode="url"
              value={form.youtube_url}
              maxLength={MATERIAL_LIMITS.link}
              autoComplete="off"
              spellCheck={false}
              lang="en"
              placeholder="https://www.youtube.com/watch?v=…"
              onChange={(event) => set("youtube_url", event.target.value)}
              disabled={pending}
            />
          </Field>
        )}
        <BilingualField
          id={`${formId}-description`}
          label={t("mat.fieldDescription")}
          multiline
          rows={4}
          maxLength={MATERIAL_LIMITS.description}
          values={{ bn: form.description_bn, en: form.description_en }}
          onChange={(lang, value) => set(lang === "bn" ? "description_bn" : "description_en", value)}
          errors={{ bn: fieldError("description_bn"), en: fieldError("description_en") }}
          disabled={pending}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id={`${formId}-category`} label={t("mat.fieldCategory")} optional error={fieldError("category")}>
            <Select value={form.category} onChange={(event) => chooseCategory(event.target.value)} disabled={pending}>
              <option value="">{t("mat.none")}</option>
              {lookups.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {name(category)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={`${formId}-subject`} label={t("mat.fieldSubject")} optional error={fieldError("subject")}>
            <Select value={form.subject} onChange={(event) => set("subject", event.target.value)} disabled={pending}>
              <option value="">{t("mat.none")}</option>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {name(subject)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={`${formId}-exam`} label={t("mat.fieldExam")} optional error={fieldError("exam")}>
            <Select value={form.exam} onChange={(event) => set("exam", event.target.value)} disabled={pending}>
              <option value="">{t("mat.none")}</option>
              {lookups.exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {localized(locale, exam.title_bn, exam.title_en).text}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={`${formId}-teacher`} label={t("mat.fieldTeacher")} optional error={fieldError("teacher")}>
            <Input value={form.teacher} maxLength={MATERIAL_LIMITS.teacher} autoComplete="off" onChange={(event) => set("teacher", event.target.value)} disabled={pending} />
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id={`${formId}-visibility`} label={t("mat.publishing")} error={fieldError("publish_now")}>
            <Select value={form.visibility} onChange={(event) => set("visibility", event.target.value as Visibility)} disabled={pending}>
              {VISIBILITIES.map((visibility) => (
                <option key={visibility} value={visibility}>
                  {t(VISIBILITY_LABEL[visibility])}
                </option>
              ))}
            </Select>
          </Field>
          {form.visibility === "at" && (
            <Field id={`${formId}-publish`} label={t("mat.publishAt")} required error={fieldError("published_at")}>
              <Input type="datetime-local" value={form.published_at} onChange={(event) => set("published_at", event.target.value)} disabled={pending} />
            </Field>
          )}
          <Field id={`${formId}-order`} label={t("mat.fieldOrder")} hint={t("mat.orderHint")} error={fieldError("sort_order")}>
            <Input type="number" inputMode="numeric" min={0} max={MAX_SORT_ORDER} step={1} value={form.sort_order} onChange={(event) => set("sort_order", event.target.value)} disabled={pending} />
          </Field>
        </div>
        {form.kind === "pdf" && (
          <PdfAttachment
            endpoint={item ? `/admin/materials/${item.id}/pdf/` : null}
            openHref={item ? `/api/v1/public/materials/${item.id}/pdf/` : ""}
            initial={item?.pdf}
            title={t("mat.pdfTitle")}
            hint={t("mat.pdfHint", { mb: "10" })}
            saveFirst={t("mat.pdfSaveFirst")}
            removeBody={t("np.removeBody")}
            onChanged={onPdfChanged}
          />
        )}
      </form>
    </Modal>
  );
}
