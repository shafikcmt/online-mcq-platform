"use client";

import { ArrowLeft, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

import { Alert } from "@/components/ui/alert";
import { BilingualField } from "@/components/ui/bilingual-field";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FormSection, Input, Select, Switch } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { ApiError, describeError } from "@/lib/api/errors";
import { isValidationError, mapFieldErrors, type MappedErrors } from "@/lib/api/field-errors";
import { EXPLANATION_MAX_LENGTH, QUESTION_TEXT_MAX_LENGTH } from "@/lib/content-limits";
import { describeDeleteError, isQuestionLocked } from "@/lib/content-errors";
import { useI18n } from "@/lib/i18n/provider";
import { localized } from "@/lib/localized";
import {
  correctCount,
  draftFromQuestion,
  isQuestionField,
  newDraft,
  toPayload,
  type QuestionDraft,
} from "@/lib/question-form";
import { DIFFICULTIES, type Category, type Paginated, type Question, type Subject } from "@/types/content";

import { OptionsEditor } from "./options-editor";
import { QuestionImage } from "./question-image";

const NO_ERRORS: MappedErrors = { fields: {}, form: [] };

/** Create / edit a question on its own page. Saving sends the question with its COMPLETE
 * option set; the server validates everything again (languages, exactly one correct, the
 * configured number of options) and its messages appear next to the fields.
 * A question used by a published exam answers `409 question_locked`: the form keeps the
 * admin's input and explains why it cannot change (no unlock, no automatic copy). */
export function QuestionForm({
  question: initialQuestion,
  categories,
  initialSubjects,
  initialCategory,
}: {
  question: Question | null;
  categories: Category[];
  /** Subjects of the initially selected category (server-rendered, no extra request). */
  initialSubjects: Subject[];
  initialCategory?: number;
}) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const { notify } = useToast();
  const [question, setQuestion] = useState(initialQuestion);
  const [draft, setDraft] = useState<QuestionDraft>(() =>
    initialQuestion ? draftFromQuestion(initialQuestion) : newDraft(initialCategory ? String(initialCategory) : ""),
  );
  const [errors, setErrors] = useState<MappedErrors>(NO_ERRORS);
  const [locked, setLocked] = useState(false);
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  // Subjects per category, fetched once per category when the admin picks it.
  const subjectCache = useRef(new Map<string, Subject[]>(draft.category ? [[draft.category, initialSubjects]] : []));
  const [subjects, setSubjects] = useState<Subject[]>(initialSubjects);
  const [subjectsState, setSubjectsState] = useState<"idle" | "loading" | "error">("idle");
  const subjectRequest = useRef<AbortController | null>(null);

  function update<K extends keyof QuestionDraft>(key: K, value: QuestionDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function changeCategory(category: string) {
    setDraft((current) => ({ ...current, category, subject: "" }));
    subjectRequest.current?.abort();
    const cached = subjectCache.current.get(category);
    if (!category || cached) {
      setSubjects(cached ?? []);
      setSubjectsState("idle");
      return;
    }
    const controller = new AbortController();
    subjectRequest.current = controller;
    setSubjects([]);
    setSubjectsState("loading");
    try {
      const page = await apiFetch<Paginated<Subject>>(
        `/admin/subjects/?category=${category}&page_size=100&ordering=sort_order`,
        { signal: controller.signal },
      );
      subjectCache.current.set(category, page.results);
      setSubjects(page.results);
      setSubjectsState("idle");
    } catch {
      if (!controller.signal.aborted) setSubjectsState("error"); // aborted = superseded by a newer pick
    }
  }

  function showErrors(next: MappedErrors) {
    setErrors(next);
    // Move focus to the summary so keyboard and screen-reader users learn what happened.
    requestAnimationFrame(() => summaryRef.current?.focus());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setLocked(false);
    // Exactly one correct option is a fixed rule (also enforced by the server).
    if (correctCount(draft) !== 1) {
      showErrors({ fields: { options: t("options.oneCorrect") }, form: [] });
      return;
    }
    setPending(true);
    setErrors(NO_ERRORS);
    try {
      const saved = await apiFetch<Question>(question ? `/admin/questions/${question.id}/` : "/admin/questions/", {
        method: question ? "PATCH" : "POST",
        body: toPayload(draft),
      });
      if (!question) {
        notify(t("questions.created"));
        router.push(`/questions/${saved.id}`); // another url: the edit page is fetched fresh
        return; // stay "pending" while the edit page loads
      }
      setQuestion(saved);
      setDraft(draftFromQuestion(saved)); // the server's normalized text and option order
      notify(t("questions.saved"));
      // The editor already shows the saved state (from the response); this only re-syncs
      // the server-rendered page in the background.
      router.refresh();
    } catch (error) {
      if (isQuestionLocked(error)) {
        setLocked(true);
        requestAnimationFrame(() => summaryRef.current?.focus());
      } else if (isValidationError(error)) {
        showErrors(mapFieldErrors(error, isQuestionField));
      } else if (error instanceof ApiError && error.status === 404) {
        showErrors({ fields: {}, form: [t("error.notFound")] });
      } else {
        showErrors({ fields: {}, form: [describeError(error, t)] });
      }
    }
    setPending(false);
  }

  async function remove() {
    if (!question) return;
    await apiFetch(`/admin/questions/${question.id}/`, { method: "DELETE" });
    setDeleting(false);
    notify(t("questions.deleted"));
    router.push("/questions"); // another url: the list is fetched fresh
  }

  const fieldError = (key: string) => errors.fields[key];
  const hasErrors = errors.form.length > 0 || Object.keys(errors.fields).length > 0;
  const optionErrors = Object.fromEntries(Object.entries(errors.fields).filter(([key]) => key.startsWith("options")));

  return (
    <form noValidate onSubmit={submit} className="space-y-6">
      <div className="space-y-3">
        <Link
          href="/questions"
          className="inline-flex items-center gap-1.5 rounded-control text-sm text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("questions.back")}
        </Link>
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {question ? t("questions.editTitle", { id: question.id }) : t("questions.createTitle")}
          </h1>
          {question && (
            <Button variant="secondary" onClick={() => setDeleting(true)} className="text-danger-700 hover:bg-danger-50">
              <Trash2 aria-hidden />
              {t("common.delete")}
            </Button>
          )}
        </header>
      </div>

      <div ref={summaryRef} tabIndex={-1} className="space-y-3 focus:outline-none">
        {locked && (
          <Alert tone="locked" title={t("error.questionLocked")} live>
            {t("error.questionLockedHint")}
          </Alert>
        )}
        {hasErrors && (
          // The "highlighted fields" heading only when fields are actually marked; a lost
          // session, network failure or 404 is shown as its own message.
          <Alert tone="danger" title={Object.keys(errors.fields).length ? t("form.errorSummary") : undefined} live>
            {errors.form.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-danger-700">
                {errors.form.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            )}
          </Alert>
        )}
      </div>

      <FormSection title={t("questions.sectionPlacement")} description={t("questions.sectionPlacementHint")}>
        <div className="grid gap-5 md:grid-cols-2">
          <Field id="q-category" label={t("questions.category")} required>
            <Select value={draft.category} onChange={(event) => changeCategory(event.target.value)} disabled={pending}>
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
          <Field
            id="q-subject"
            label={t("questions.subject")}
            required
            error={fieldError("subject") ?? (subjectsState === "error" ? t("error.generic") : undefined)}
            hint={
              subjectsState === "loading"
                ? t("questions.subjectsLoading")
                : draft.category && subjectsState === "idle" && !subjects.length
                  ? t("questions.noSubjects")
                  : undefined
            }
          >
            <Select
              value={draft.subject}
              onChange={(event) => update("subject", event.target.value)}
              disabled={pending || !draft.category || subjectsState === "loading"}
            >
              <option value="">{draft.category ? t("questions.chooseSubject") : t("questions.chooseCategoryFirst")}</option>
              {subjects.map((subject) => {
                const name = localized(locale, subject.name_bn, subject.name_en);
                return (
                  <option key={subject.id} value={subject.id} lang={name.lang}>
                    {name.text}
                  </option>
                );
              })}
            </Select>
          </Field>
        </div>
      </FormSection>

      <FormSection title={t("questions.sectionContent")} description={t("questions.sectionContentHint")}>
        <BilingualField
          id="q-text"
          label={t("questions.text")}
          hint={t("bilingual.oneRequired")}
          required
          multiline
          rows={4}
          maxLength={QUESTION_TEXT_MAX_LENGTH}
          disabled={pending}
          values={{ bn: draft.text_bn, en: draft.text_en }}
          onChange={(lang, value) => update(lang === "bn" ? "text_bn" : "text_en", value)}
          errors={{ bn: fieldError("text_bn"), en: fieldError("text_en") }}
        />
        <BilingualField
          id="q-explanation"
          label={t("questions.explanation")}
          hint={t("questions.explanationHint")}
          multiline
          rows={3}
          maxLength={EXPLANATION_MAX_LENGTH}
          disabled={pending}
          values={{ bn: draft.explanation_bn, en: draft.explanation_en }}
          onChange={(lang, value) => update(lang === "bn" ? "explanation_bn" : "explanation_en", value)}
          errors={{ bn: fieldError("explanation_bn"), en: fieldError("explanation_en") }}
        />
      </FormSection>

      <FormSection
        title={t("questions.sectionOptions")}
        description={t("questions.sectionOptionsHint")}
        aside={question ? <p className="max-w-xs text-xs text-ink-subtle">{t("options.replaceNote")}</p> : undefined}
      >
        <OptionsEditor
          options={draft.options}
          onChange={(options) => update("options", options)}
          errors={optionErrors}
          disabled={pending}
        />
      </FormSection>

      <FormSection title={t("questions.sectionSettings")}>
        <div className="grid gap-5 md:grid-cols-2">
          <Field id="q-chapter" label={t("questions.chapter")} optional error={fieldError("chapter")}>
            <Input id="q-chapter" value={draft.chapter} maxLength={150} onChange={(event) => update("chapter", event.target.value)} disabled={pending} />
          </Field>
          <Field id="q-topic" label={t("questions.topic")} optional error={fieldError("topic")}>
            <Input id="q-topic" value={draft.topic} maxLength={150} onChange={(event) => update("topic", event.target.value)} disabled={pending} />
          </Field>
          <Field id="q-difficulty" label={t("questions.difficulty")} optional error={fieldError("difficulty")}>
            <Select
              value={draft.difficulty}
              onChange={(event) => update("difficulty", event.target.value as QuestionDraft["difficulty"])}
              disabled={pending}
            >
              <option value="">{t("common.notSet")}</option>
              {DIFFICULTIES.map((value) => (
                <option key={value} value={value}>
                  {t(`difficulty.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="md:pt-7">
            <Switch
              id="q-active"
              label={t("field.active")}
              hint={t("questions.activeHint")}
              checked={draft.is_active}
              onChange={(value) => update("is_active", value)}
              disabled={pending}
            />
          </div>
        </div>
      </FormSection>

      <FormSection title={t("questions.sectionImage")} description={t("questions.sectionImageHint")}>
        {question ? (
          <QuestionImage question={question} onChange={setQuestion} />
        ) : (
          <p className="text-sm text-ink-muted">{t("image.saveFirst")}</p>
        )}
      </FormSection>

      <div className="sticky bottom-0 z-10 -mx-4 flex justify-end gap-2 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-card sm:border">
        <Button asChild variant="secondary">
          <Link href="/questions">{t("common.cancel")}</Link>
        </Button>
        <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
          {pending ? t("common.saving") : question ? t("common.save") : t("common.create")}
        </Button>
      </div>

      {deleting && question && (
        <ConfirmDialog
          open
          onOpenChange={setDeleting}
          title={t("questions.deleteTitle")}
          description={t("questions.deleteBody", { id: question.id })}
          confirmLabel={t("common.delete")}
          pendingLabel={t("common.deleting")}
          onConfirm={remove}
          describe={(error) => describeDeleteError(error, t)}
        />
      )}
    </form>
  );
}
