"use client";

import { AlertTriangle, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ExamStatusBadge, examTitle } from "@/components/exams/exam-cells";
import { ExamPicker } from "@/components/results/exam-picker";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormSection, Switch } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { ApiError, describeError } from "@/lib/api/errors";
import { mapFieldErrors } from "@/lib/api/field-errors";
import { formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { localized } from "@/lib/localized";
import type { Category } from "@/types/content";
import type { ExamStatus } from "@/types/exams";
import type { AccessRule, AccessRuleInput } from "@/types/packages";

type ExamRef = { id: number; title_bn: string; title_en: string; status: string };

/** The editor's view of a rule list (order-independent, like the server's comparison). */
export type RulesDraft = { allPaid: boolean; categoryIds: number[]; exams: ExamRef[] };

export function rulesDraft(rules: AccessRule[]): RulesDraft {
  return {
    allPaid: rules.some((rule) => rule.rule_type === "all_paid_exams"),
    categoryIds: rules.flatMap((rule) => (rule.rule_type === "category" && rule.category ? [rule.category.id] : [])).sort((a, b) => a - b),
    exams: rules.flatMap((rule) => (rule.rule_type === "exam" && rule.exam ? [rule.exam] : [])),
  };
}

export function sameRules(a: RulesDraft, b: RulesDraft): boolean {
  const examIds = (draft: RulesDraft) => draft.exams.map((exam) => exam.id).sort((x, y) => x - y).join(",");
  return a.allPaid === b.allPaid && a.categoryIds.join(",") === b.categoryIds.join(",") && examIds(a) === examIds(b);
}

/** The COMPLETE list PATCH …/access-rules/ takes. */
export function toRulesPayload(draft: RulesDraft): AccessRuleInput[] {
  return [
    ...(draft.allPaid ? [{ rule_type: "all_paid_exams" as const }] : []),
    ...draft.categoryIds.map((category) => ({ rule_type: "category" as const, category })),
    ...draft.exams.map((exam) => ({ rule_type: "exam" as const, exam: exam.id })),
  ];
}

/** A package's access rules: all paid exams, whole categories, individual paid exams.
 * Saving replaces the server's complete list (one atomic PATCH); the server validates
 * (paid exams only, no duplicates, the configured maximum) and its messages are shown.
 * Exams come from the bounded, paid-only exam search — never a full exam download. */
export function AccessRulesEditor({
  packageId,
  rules,
  categories,
  categoriesTruncated,
  disabled,
  onDirtyChange,
  onSaved,
}: {
  packageId: number;
  rules: AccessRule[];
  categories: Category[];
  categoriesTruncated: boolean;
  disabled: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (ruleCount: number) => void;
}) {
  const { locale, t } = useI18n();
  const { notify } = useToast();
  const [saved, setSaved] = useState<RulesDraft>(() => rulesDraft(rules));
  const [draft, setDraft] = useState<RulesDraft>(saved);
  // Category names: the lookup, plus any category a rule names that the (capped) lookup missed.
  const [ruleCategories, setRuleCategories] = useState(() => rules.flatMap((rule) => (rule.category ? [rule.category] : [])));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const addRef = useRef<HTMLButtonElement>(null);
  const dirty = !sameRules(draft, saved);

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const categoryRows = [
    ...categories,
    ...ruleCategories.filter((row) => !categories.some((category) => category.id === row.id)),
  ];
  const name = (row: { name_bn: string; name_en: string }) => localized(locale, row.name_bn, row.name_en);
  const examName = (exam: ExamRef) => examTitle(exam, locale).text || `#${exam.id}`;

  function toggleCategory(id: number, checked: boolean) {
    const ids = checked ? [...draft.categoryIds, id] : draft.categoryIds.filter((value) => value !== id);
    setDraft({ ...draft, categoryIds: [...new Set(ids)].sort((a, b) => a - b) });
  }

  function removeExam(exam: ExamRef) {
    setDraft({ ...draft, exams: draft.exams.filter((row) => row.id !== exam.id) });
    setAnnouncement(t("rules.examRemoved", { name: examName(exam) }));
    requestAnimationFrame(() => addRef.current?.focus());
  }

  async function save() {
    if (busy || !dirty) return;
    setBusy(true);
    setErrors([]);
    try {
      const result = await apiFetch<{ rules: AccessRule[] }>(`/admin/packages/${packageId}/access-rules/`, {
        method: "PATCH",
        body: { rules: toRulesPayload(draft) }, // always the COMPLETE list
      });
      const next = rulesDraft(result.rules);
      setSaved(next);
      setDraft(next);
      setRuleCategories(result.rules.flatMap((rule) => (rule.category ? [rule.category] : [])));
      onSaved(result.rules.length);
      notify(t("rules.saved"));
    } catch (error) {
      const mapped = mapFieldErrors(error, () => false); // every rule message goes to the list
      setErrors(
        mapped.form.length ? mapped.form : [error instanceof ApiError && error.status === 404 ? t("error.notFound") : describeError(error, t)],
      );
    }
    setBusy(false);
  }

  const locked = disabled || busy;
  const empty = !draft.allPaid && !draft.categoryIds.length && !draft.exams.length;

  return (
    <FormSection title={t("rules.title")} description={t("rules.hint")}>
      {/* Always shown: saving changes access for everyone who already has this package. */}
      <p role="note" className="flex items-start gap-2 rounded-control border border-warning-700/25 bg-warning-50 px-3 py-2.5 text-sm font-medium text-warning-700">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t("rules.warning")}
      </p>
      {errors.length > 0 && (
        <Alert tone="danger" live>
          <ul className="list-disc space-y-0.5 pl-5 text-danger-700">
            {errors.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        </Alert>
      )}

      <Switch
        id="rule-all-paid"
        label={t("rules.allPaid")}
        hint={t("rules.allPaidHint")}
        checked={draft.allPaid}
        onChange={(allPaid) => setDraft({ ...draft, allPaid })}
        disabled={locked}
      />

      <fieldset className="min-w-0" aria-describedby="rule-categories-hint">
        <legend className="text-sm font-medium text-ink">{t("rules.categories")}</legend>
        <p id="rule-categories-hint" className="mb-2 text-[13px] text-ink-subtle">
          {t("rules.categoriesHint")}
        </p>
        {categoriesTruncated && <p className="mb-2 text-[13px] text-warning-700">{t("rules.categoriesTruncated", { n: formatNumber(categories.length, locale) })}</p>}
        {categoryRows.length ? (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {categoryRows.map((row) => {
              const label = name(row);
              return (
                <li key={row.id} className="min-w-0">
                  <label className="flex min-w-0 cursor-pointer items-start gap-2 rounded-control border border-line px-3 py-2 text-sm hover:bg-neutral-50">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 accent-brand-600"
                      checked={draft.categoryIds.includes(row.id)}
                      onChange={(event) => toggleCategory(row.id, event.target.checked)}
                      disabled={locked}
                    />
                    <span lang={label.lang} className="min-w-0 break-words text-ink">
                      {label.text || row.slug}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">{t("rules.noCategories")}</p>
        )}
      </fieldset>

      <section aria-labelledby="rule-exams-title" className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 id="rule-exams-title" className="text-sm font-medium text-ink">
              {t("rules.exams")}
            </h3>
            <p className="text-[13px] text-ink-subtle">{t("rules.examsHint")}</p>
          </div>
          <Button ref={addRef} variant="secondary" size="sm" onClick={() => setPicking(true)} disabled={locked} aria-haspopup="dialog">
            <Plus aria-hidden />
            {t("rules.addExam")}
          </Button>
        </div>
        {draft.exams.length ? (
          <ul className="divide-y divide-line rounded-card border border-line">
            {draft.exams.map((exam) => {
              const title = examTitle(exam, locale);
              return (
                <li key={exam.id} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
                  <div className="min-w-0 flex-1">
                    <p lang={title.lang} className="text-sm font-medium break-words text-ink">
                      {title.text || `#${exam.id}`}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
                      <span className="tabular-nums">#{exam.id}</span>
                      <ExamStatusBadge status={exam.status as ExamStatus} />
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeExam(exam)}
                    disabled={locked}
                    aria-label={t("rules.removeExam", { name: examName(exam) })}
                    title={t("rules.removeExam", { name: examName(exam) })}
                  >
                    <X aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">{t("rules.noExams")}</p>
        )}
      </section>

      {empty && <p className="text-sm font-medium text-ink-muted">{t("rules.none")}</p>}

      <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p id="rules-replace" className="text-[13px] text-ink-subtle">
          {t("rules.replaceNote")}
        </p>
        <div className="flex flex-wrap items-center gap-3 sm:justify-end">
          {dirty && (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-warning-700">
              <span className="size-2 rounded-full bg-accent-500" aria-hidden />
              {t("package.unsaved")}
            </span>
          )}
          <Button onClick={save} disabled={disabled || busy || !dirty} aria-busy={busy || undefined} aria-describedby="rules-replace">
            {busy ? t("rules.saving") : t("rules.save")}
          </Button>
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <ExamPicker
        open={picking}
        onOpenChange={setPicking}
        accessType="paid"
        labels={{ title: "rules.pickerTitle", description: "rules.pickerDescription", select: "rules.pickerSelect", selectLabel: "rules.pickerSelectLabel" }}
        isChosen={(exam) => draft.exams.some((row) => row.id === exam.id)}
        chosenLabel={t("rules.pickerAdded")}
        onSelect={(exam) => {
          setDraft((current) =>
            current.exams.some((row) => row.id === exam.id)
              ? current
              : { ...current, exams: [...current.exams, { id: exam.id, title_bn: exam.title_bn, title_en: exam.title_en, status: exam.status }] },
          );
          setAnnouncement(t("rules.examAdded", { name: examTitle(exam, locale).text || `#${exam.id}` }));
        }}
      />
    </FormSection>
  );
}
