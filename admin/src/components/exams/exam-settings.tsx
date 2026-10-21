"use client";

import { Radio } from "lucide-react";
import type { ReactNode } from "react";

import { Alert } from "@/components/ui/alert";
import { BilingualField } from "@/components/ui/bilingual-field";
import { Field, FormSection, Input, Select, Switch } from "@/components/ui/form";
import { EXAM_TEXT_MAX_LENGTH, EXAM_TITLE_MAX_LENGTH, SLUG_MAX_LENGTH } from "@/lib/content-limits";
import { attemptRules, withPracticeDefaults, type ExamDraft } from "@/lib/exam-form";
import { useI18n } from "@/lib/i18n/provider";
import { localized } from "@/lib/localized";
import { CONTENT_LANGUAGES, type Category, type Subject } from "@/types/content";
import { ACCESS_TYPES, EXAM_TYPES, MERIT_STRATEGIES, RESULT_VISIBILITIES } from "@/types/exams";

export const SECTION_IDS = ["basics", "schedule", "scoring", "attempts", "merit", "review"] as const;
export type SectionId = (typeof SECTION_IDS)[number] | "questions";

export const sectionElementId = (section: string) => `exam-section-${section}`;

/** Wrapper the error summary can scroll to and focus. */
export function SectionAnchor({ section, children }: { section: SectionId; children: ReactNode }) {
  return (
    <div id={sectionElementId(section)} tabIndex={-1} className="scroll-mt-20 rounded-card focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/40">
      {children}
    </div>
  );
}

/** The exam's settings, in the sections of the spec. Controls show exactly what will be
 * sent: for a live exam the retake/attempt/merit-strategy controls show the fixed values
 * (and `toExamPayload` sends them), the stored choice comes back if the type changes. */
export function ExamSettings({
  draft,
  onChange,
  errors,
  categories,
  subjects,
  isNew,
  disabled,
}: {
  draft: ExamDraft;
  onChange: (draft: ExamDraft) => void;
  errors: Record<string, string>;
  categories: Category[];
  subjects: Subject[];
  isNew: boolean;
  disabled: boolean;
}) {
  const { locale, t } = useI18n();
  const rules = attemptRules(draft);
  const set = <K extends keyof ExamDraft>(key: K, value: ExamDraft[K]) => onChange({ ...draft, [key]: value });
  const categoryId = draft.category ? Number(draft.category) : null;
  const subjectChoices = categoryId ? subjects.filter((row) => row.category === categoryId) : [];
  const name = (row: { name_bn: string; name_en: string }) => localized(locale, row.name_bn, row.name_en);

  function changeType(exam_type: ExamDraft["exam_type"]) {
    const next = { ...draft, exam_type };
    // A new practice exam starts with the server's practice defaults, shown here.
    onChange(isNew && exam_type === "practice" ? withPracticeDefaults(next) : next);
  }

  return (
    <div className="space-y-6">
      <SectionAnchor section="basics">
        <FormSection title={t("exam.sectionBasics")} description={t("exam.sectionBasicsHint")}>
          <BilingualField
            id="exam-title"
            label={t("exam.titleLabel")}
            hint={t("exam.titleHint")}
            maxLength={EXAM_TITLE_MAX_LENGTH}
            disabled={disabled}
            values={{ bn: draft.title_bn, en: draft.title_en }}
            onChange={(lang, value) => set(lang === "bn" ? "title_bn" : "title_en", value)}
            errors={{ bn: errors.title_bn, en: errors.title_en }}
          />
          <div className="grid gap-5 md:grid-cols-2">
            <Field id="exam-slug" label={t("field.slug")} optional hint={t("field.slugHint")} error={errors.slug}>
              <Input
                value={draft.slug}
                maxLength={SLUG_MAX_LENGTH}
                onChange={(event) => set("slug", event.target.value)}
                disabled={disabled}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field
              id="exam-language"
              label={t("exam.contentLanguage")}
              required
              hint={t("exam.contentLanguageHint")}
              error={errors.content_language}
            >
              <Select
                value={draft.content_language}
                onChange={(event) => set("content_language", event.target.value as ExamDraft["content_language"])}
                disabled={disabled}
              >
                {CONTENT_LANGUAGES.map((value) => (
                  <option key={value} value={value}>
                    {t(`language.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="exam-category" label={t("exam.category")} required error={errors.category}>
              <Select
                value={draft.category}
                // A subject of another category is invalid: the choice is cleared.
                onChange={(event) => onChange({ ...draft, category: event.target.value, subject: "" })}
                disabled={disabled}
              >
                <option value="">{t("subjects.chooseCategory")}</option>
                {categories.map((row) => {
                  const label = name(row);
                  return (
                    <option key={row.id} value={row.id} lang={label.lang}>
                      {label.text}
                    </option>
                  );
                })}
              </Select>
            </Field>
            <Field id="exam-subject" label={t("exam.subject")} optional hint={t("exam.subjectHint")} error={errors.subject}>
              <Select value={draft.subject} onChange={(event) => set("subject", event.target.value)} disabled={disabled || !draft.category}>
                <option value="">{draft.category ? t("exam.wholeCategory") : t("questions.chooseCategoryFirst")}</option>
                {subjectChoices.map((row) => {
                  const label = name(row);
                  return (
                    <option key={row.id} value={row.id} lang={label.lang}>
                      {label.text}
                    </option>
                  );
                })}
              </Select>
            </Field>
            <Field id="exam-type" label={t("exam.type")} required error={errors.exam_type}>
              <Select value={draft.exam_type} onChange={(event) => changeType(event.target.value as ExamDraft["exam_type"])} disabled={disabled}>
                {EXAM_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {t(`examType.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="exam-access" label={t("exam.access")} required hint={t("exam.accessHint")} error={errors.access_type}>
              <Select
                value={draft.access_type}
                onChange={(event) => set("access_type", event.target.value as ExamDraft["access_type"])}
                disabled={disabled}
              >
                {ACCESS_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {t(`access.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {rules.live && (
            <Alert tone="info" title={t("exam.liveRules")}>
              {t("exam.liveRulesBody")}
            </Alert>
          )}
          {isNew && draft.exam_type === "practice" && <p className="text-[13px] text-ink-muted">{t("exam.practiceNote")}</p>}
          <BilingualField
            id="exam-description"
            label={t("exam.description")}
            multiline
            rows={3}
            maxLength={EXAM_TEXT_MAX_LENGTH}
            disabled={disabled}
            values={{ bn: draft.description_bn, en: draft.description_en }}
            onChange={(lang, value) => set(lang === "bn" ? "description_bn" : "description_en", value)}
            errors={{ bn: errors.description_bn, en: errors.description_en }}
          />
          <BilingualField
            id="exam-instructions"
            label={t("exam.instructions")}
            hint={t("exam.instructionsHint")}
            multiline
            rows={3}
            maxLength={EXAM_TEXT_MAX_LENGTH}
            disabled={disabled}
            values={{ bn: draft.instructions_bn, en: draft.instructions_en }}
            onChange={(lang, value) => set(lang === "bn" ? "instructions_bn" : "instructions_en", value)}
            errors={{ bn: errors.instructions_bn, en: errors.instructions_en }}
          />
          <Switch
            id="exam-featured"
            label={t("exam.featured")}
            hint={t("exam.featuredHint")}
            checked={draft.is_featured}
            onChange={(value) => set("is_featured", value)}
            disabled={disabled}
          />
        </FormSection>
      </SectionAnchor>

      <SectionAnchor section="schedule">
        <FormSection title={t("exam.sectionSchedule")} description={t("exam.sectionScheduleHint")}>
          <div className="grid gap-5 md:grid-cols-3">
            <Field
              id="exam-start"
              label={t("exam.startAt")}
              required={rules.live}
              optional={!rules.live}
              hint={t("exam.timeZoneNote")}
              error={errors.start_at}
            >
              <Input type="datetime-local" value={draft.start_at} onChange={(event) => set("start_at", event.target.value)} disabled={disabled} />
            </Field>
            <Field
              id="exam-end"
              label={t("exam.endAt")}
              required={rules.live}
              optional={!rules.live}
              hint={t("exam.timeZoneNote")}
              error={errors.end_at}
            >
              <Input type="datetime-local" value={draft.end_at} onChange={(event) => set("end_at", event.target.value)} disabled={disabled} />
            </Field>
            <Field id="exam-duration" label={t("exam.duration")} required hint={t("exam.durationHint")} error={errors.duration_minutes}>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={draft.duration_minutes}
                onChange={(event) => set("duration_minutes", event.target.value)}
                disabled={disabled}
              />
            </Field>
          </div>
        </FormSection>
      </SectionAnchor>

      <SectionAnchor section="scoring">
        <FormSection title={t("exam.sectionScoring")} description={t("exam.sectionScoringHint")}>
          <div className="grid gap-5 md:grid-cols-2">
            <Field id="exam-total" label={t("exam.totalQuestions")} required hint={t("exam.totalQuestionsHint")} error={errors.total_questions}>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={draft.total_questions}
                onChange={(event) => set("total_questions", event.target.value)}
                disabled={disabled}
              />
            </Field>
            <Field id="exam-default-marks" label={t("exam.defaultMarks")} hint={t("exam.defaultMarksHint")} error={errors.default_marks}>
              <Input
                type="number"
                inputMode="decimal"
                min={0.01}
                step={0.01}
                value={draft.default_marks}
                onChange={(event) => set("default_marks", event.target.value)}
                disabled={disabled}
              />
            </Field>
            <Field id="exam-negative" label={t("exam.negativeMarks")} error={errors.negative_marks}>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step={0.01}
                value={draft.negative_marks}
                onChange={(event) => set("negative_marks", event.target.value)}
                disabled={disabled}
              />
            </Field>
            <Field id="exam-pass" label={t("exam.passMarks")} optional hint={t("exam.passMarksHint")} error={errors.pass_marks}>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step={0.01}
                value={draft.pass_marks}
                onChange={(event) => set("pass_marks", event.target.value)}
                disabled={disabled}
              />
            </Field>
          </div>
        </FormSection>
      </SectionAnchor>

      <SectionAnchor section="attempts">
        <FormSection title={t("exam.sectionAttempts")} description={t("exam.sectionAttemptsHint")}>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-3">
              <Switch
                id="exam-retake"
                label={t("exam.allowRetake")}
                hint={rules.retakeLocked ? t("exam.liveRules") : t("exam.allowRetakeHint")}
                checked={rules.retakeLocked ? false : draft.allow_retake}
                onChange={(value) => set("allow_retake", value)}
                disabled={disabled || rules.retakeLocked}
              />
              {errors.allow_retake && <p className="text-[13px] text-danger-700">{errors.allow_retake}</p>}
            </div>
            {rules.singleAttempt ? (
              <div>
                <p className="text-sm font-medium text-ink">{t("exam.maxAttempts")}</p>
                <p className="mt-1 flex items-center gap-1.5 text-[13px] text-ink-muted">
                  {rules.live && <Radio className="size-3.5" aria-hidden />}
                  {t("exam.oneAttempt")}
                </p>
                {errors.max_attempts && <p className="mt-1.5 text-[13px] text-danger-700">{errors.max_attempts}</p>}
              </div>
            ) : (
              <Field id="exam-max-attempts" label={t("exam.maxAttempts")} optional hint={t("exam.maxAttemptsHint")} error={errors.max_attempts}>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={2}
                  step={1}
                  value={draft.max_attempts}
                  onChange={(event) => set("max_attempts", event.target.value)}
                  disabled={disabled}
                />
              </Field>
            )}
            <Switch
              id="exam-shuffle-questions"
              label={t("exam.shuffleQuestions")}
              hint={t("exam.shuffleQuestionsHint")}
              checked={draft.shuffle_questions}
              onChange={(value) => set("shuffle_questions", value)}
              disabled={disabled}
            />
            <Switch
              id="exam-shuffle-options"
              label={t("exam.shuffleOptions")}
              hint={t("exam.shuffleOptionsHint")}
              checked={draft.shuffle_options}
              onChange={(value) => set("shuffle_options", value)}
              disabled={disabled}
            />
          </div>
        </FormSection>
      </SectionAnchor>

      <SectionAnchor section="merit">
        <FormSection title={t("exam.sectionMerit")} description={t("exam.sectionMeritHint")}>
          <div className="grid gap-5 md:grid-cols-2">
            <Switch
              id="exam-merit"
              label={t("exam.meritEnabled")}
              hint={t("exam.meritEnabledHint")}
              checked={draft.merit_enabled}
              onChange={(value) => set("merit_enabled", value)}
              disabled={disabled}
            />
            <Field
              id="exam-merit-strategy"
              label={t("exam.meritStrategy")}
              hint={rules.strategyLocked ? t("exam.liveRules") : undefined}
              error={errors.merit_strategy}
            >
              <Select
                value={rules.strategyLocked ? "first_attempt" : draft.merit_strategy}
                onChange={(event) => set("merit_strategy", event.target.value as ExamDraft["merit_strategy"])}
                disabled={disabled || rules.strategyLocked || !draft.merit_enabled}
              >
                {MERIT_STRATEGIES.map((value) => (
                  <option key={value} value={value}>
                    {t(`merit.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </FormSection>
      </SectionAnchor>

      <SectionAnchor section="review">
        <FormSection title={t("exam.sectionReview")} description={t("exam.sectionReviewHint")}>
          <div className="grid gap-5 md:grid-cols-2">
            <Field id="exam-visibility" label={t("exam.resultVisibility")} hint={t("exam.resultVisibilityHint")} error={errors.result_visibility}>
              <Select
                value={draft.result_visibility}
                onChange={(event) => set("result_visibility", event.target.value as ExamDraft["result_visibility"])}
                disabled={disabled}
              >
                {RESULT_VISIBILITIES.map((value) => (
                  <option key={value} value={value}>
                    {t(`visibility.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="md:pt-7">
              <Switch
                id="exam-review"
                label={t("exam.allowReview")}
                hint={t("exam.allowReviewHint")}
                checked={draft.allow_answer_review}
                onChange={(value) => set("allow_answer_review", value)}
                disabled={disabled}
              />
            </div>
          </div>
        </FormSection>
      </SectionAnchor>
    </div>
  );
}
