"use client";

import { Archive, ArrowLeft, Copy, EyeOff, Plus, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormSection } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { ApiError, describeError } from "@/lib/api/errors";
import { isValidationError, mapFieldErrors, type MappedErrors } from "@/lib/api/field-errors";
import { describeExamError, isExamConflict } from "@/lib/exam-errors";
import {
  EXAM_FIELD_SECTIONS,
  EXAM_FIELDS,
  draftFromExam,
  isEditableStatus,
  newExamDraft,
  sameDraft,
  toExamPayload,
  type ExamDraft,
} from "@/lib/exam-form";
import { fromRows, questionIdsInMessages, sameAssignment, toQuestionsPayload, totalMarks, type AssignedQuestion } from "@/lib/exam-questions";
import { formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey } from "@/lib/i18n/messages";
import { useUnsavedGuard } from "@/lib/use-unsaved-guard";
import { cn } from "@/lib/utils";
import type { Category, Subject } from "@/types/content";
import type { Exam, ExamQuestionRow } from "@/types/exams";
import type { SyllabusLineData } from "@/types/syllabus";

import { AssignedQuestions } from "./assigned-questions";
import { ExamStatusBadge, examTitle } from "./exam-cells";
import { ExamResults } from "./exam-results";
import { ExamSyllabus } from "./exam-syllabus";
import { ExamSettings, SectionAnchor, sectionElementId, type SectionId } from "./exam-settings";
import { QuestionPicker, initialPickerQuery, type PickerQuery } from "./question-picker";

const NO_ERRORS: MappedErrors = { fields: {}, form: [] };

const SECTION_TITLES: Record<SectionId, MessageKey> = {
  basics: "exam.sectionBasics",
  schedule: "exam.sectionSchedule",
  scoring: "exam.sectionScoring",
  attempts: "exam.sectionAttempts",
  merit: "exam.sectionMerit",
  review: "exam.sectionReview",
  questions: "examQuestions.title",
};

/** One entry of the publish error summary: the server's messages for one field. */
export type PublishProblem = { field: string; section?: SectionId; messages: string[] };

/** `400` from publish → summary entries (in the order of the form's sections). */
export function publishProblems(error: ApiError): PublishProblem[] {
  const order = Object.keys(SECTION_TITLES);
  return Object.entries(error.fieldErrors)
    .map(([field, value]) => ({
      field,
      section: EXAM_FIELD_SECTIONS[field] as SectionId | undefined,
      messages: (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === "string"),
    }))
    .filter((problem) => problem.messages.length > 0)
    .sort((a, b) => (a.section ? order.indexOf(a.section) : 99) - (b.section ? order.indexOf(b.section) : 99));
}

/** Save errors for the question list: per-row errors (`questions.<index>.<field>`) are
 * shown on that row (by question id), everything else above the list. */
export function questionSaveErrors(error: unknown, sent: AssignedQuestion[]): { form: string[]; rows: Record<number, string> } {
  const mapped = mapFieldErrors(error, (key) => /^questions\.\d+\./.test(key));
  const rows: Record<number, string> = {};
  for (const [key, message] of Object.entries(mapped.fields)) {
    const item = sent[Number(key.split(".")[1])];
    if (item) rows[item.question] = rows[item.question] ? `${rows[item.question]} ${message}` : message;
    else mapped.form.push(message);
  }
  return { form: mapped.form, rows };
}

type Confirm = "unpublish" | "archive" | "duplicate" | "delete";

/** Create / edit an exam: settings, its question list (with the question-bank picker),
 * lifecycle actions and — once published — result controls.
 *
 * Settings and the question list are saved separately (two endpoints). Lifecycle
 * actions act on the SAVED exam, so they wait until nothing is unsaved. The server
 * decides every rule; its messages are shown where they belong. */
export function ExamEditor({
  exam: initialExam,
  questions,
  syllabus = [],
  categories,
  subjects,
  lookupTruncated,
  initialCategory,
}: {
  exam: Exam | null;
  questions: ExamQuestionRow[];
  syllabus?: SyllabusLineData[];
  categories: Category[];
  subjects: Subject[];
  lookupTruncated: boolean;
  initialCategory?: number;
}) {
  const { locale, t } = useI18n();
  const { notify } = useToast();
  const [exam, setExam] = useState(initialExam);
  const [saved, setSaved] = useState<ExamDraft>(() =>
    initialExam ? draftFromExam(initialExam) : newExamDraft(initialCategory ? String(initialCategory) : ""),
  );
  const [draft, setDraft] = useState<ExamDraft>(saved);
  const [savedItems, setSavedItems] = useState<AssignedQuestion[]>(() => fromRows(questions));
  const [items, setItems] = useState<AssignedQuestion[]>(savedItems);

  const [errors, setErrors] = useState<MappedErrors>(NO_ERRORS);
  const [problems, setProblems] = useState<PublishProblem[]>([]);
  const [problemIds, setProblemIds] = useState<Set<number>>(() => new Set());
  const [questionErrors, setQuestionErrors] = useState<{ form: string[]; rows: Record<number, string> }>({ form: [], rows: {} });
  const [conflict, setConflict] = useState<{ title?: string; message: string } | null>(null);
  const [busy, setBusy] = useState<"settings" | "questions" | "publish" | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState<PickerQuery | null>(() => (initialExam ? initialPickerQuery(initialExam) : null));
  const [announcement, setAnnouncement] = useState("");
  const summaryRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);

  const editable = !exam || isEditableStatus(exam.status);
  const settingsDirty = !sameDraft(draft, saved);
  const questionsDirty = !sameAssignment(items, savedItems);
  const dirty = settingsDirty || questionsDirty;
  const guard = useUnsavedGuard(dirty);

  function focusSummary() {
    requestAnimationFrame(() => summaryRef.current?.focus());
  }

  function goToSection(section: SectionId) {
    const target = document.getElementById(sectionElementId(section));
    if (!target) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    target.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    target.focus({ preventScroll: true });
  }

  /** After a 409 the exam's status may have changed elsewhere: show the current one
   * (the admin's unsaved input stays in the form). */
  async function refreshExam() {
    if (!exam) return;
    try {
      setExam(await apiFetch<Exam>(`/admin/exams/${exam.id}/`));
    } catch {
      // the conflict message is already shown
    }
  }

  /** The exam as the server now has it (after an action), when nothing is unsaved. */
  function applyExam(next: Exam) {
    setExam(next);
    const nextDraft = draftFromExam(next);
    setSaved(nextDraft);
    setDraft(nextDraft);
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (busy || !editable) return;
    setBusy("settings");
    setErrors(NO_ERRORS);
    setConflict(null);
    try {
      const result = await apiFetch<Exam>(exam ? `/admin/exams/${exam.id}/` : "/admin/exams/", {
        method: exam ? "PATCH" : "POST",
        body: toExamPayload(draft),
      });
      if (!exam) {
        notify(t("exam.created"));
        guard.leave(`/exams/${result.id}`);
        return; // stay busy while the editor of the new exam loads
      }
      applyExam(result);
      setProblems([]);
      notify(t("exam.saved"));
    } catch (error) {
      if (isValidationError(error)) {
        setErrors(mapFieldErrors(error, (key) => EXAM_FIELDS.has(key) && key !== "questions"));
      } else if (isExamConflict(error)) {
        setConflict(describeExamError(error, t));
        void refreshExam();
      } else {
        setErrors({ fields: {}, form: [error instanceof ApiError && error.status === 404 ? t("error.notFound") : describeError(error, t)] });
      }
      focusSummary();
    }
    setBusy(null);
  }

  async function saveQuestions() {
    if (!exam || busy || !editable) return;
    const sent = items;
    setBusy("questions");
    setQuestionErrors({ form: [], rows: {} });
    setConflict(null);
    try {
      const result = await apiFetch<{ questions: ExamQuestionRow[] }>(`/admin/exams/${exam.id}/questions/`, {
        method: "PATCH",
        body: toQuestionsPayload(sent), // always the COMPLETE list
      });
      const next = fromRows(result.questions);
      setItems(next);
      setSavedItems(next);
      setProblemIds(new Set());
      const marks = result.questions.reduce((sum, row) => sum + Number(row.effective_marks), 0);
      setExam({ ...exam, question_count: result.questions.length, total_marks: marks.toFixed(2) });
      notify(t("examQuestions.saved"));
    } catch (error) {
      if (isValidationError(error)) {
        const mapped = questionSaveErrors(error, sent);
        setQuestionErrors(mapped);
        setProblemIds(questionIdsInMessages(mapped.form));
      } else if (isExamConflict(error)) {
        setConflict(describeExamError(error, t));
        void refreshExam();
        focusSummary();
      } else {
        setQuestionErrors({ form: [describeError(error, t)], rows: {} });
      }
    }
    setBusy(null);
  }

  async function publish() {
    if (!exam || busy || dirty) return;
    setBusy("publish");
    setProblems([]);
    setConflict(null);
    setErrors(NO_ERRORS);
    try {
      applyExam(await apiFetch<Exam>(`/admin/exams/${exam.id}/publish/`, { method: "POST" }));
      setProblemIds(new Set());
      notify(t("exam.published"));
    } catch (error) {
      if (isValidationError(error)) {
        setProblems(publishProblems(error));
        // Field messages also appear next to their fields; questions are marked by id.
        setErrors({ fields: mapFieldErrors(error, (key) => EXAM_FIELDS.has(key) && key !== "questions").fields, form: [] });
        setProblemIds(questionIdsInMessages(error.fieldErrors.questions ?? []));
      } else if (isExamConflict(error)) {
        setConflict(describeExamError(error, t));
        void refreshExam();
      } else {
        setConflict({ message: describeError(error, t) });
      }
      focusSummary();
    }
    setBusy(null);
  }

  /** Confirmed actions: the dialog stays open until the server answers and shows any
   * failure itself (409 → translated title + server message; the exam is re-read). */
  async function runConfirmed(action: Confirm) {
    if (!exam) return;
    try {
      if (action === "delete") {
        await apiFetch(`/admin/exams/${exam.id}/`, { method: "DELETE" });
        notify(t("exam.deleted"));
        guard.leave("/exams");
        return;
      }
      if (action === "duplicate") {
        const copy = await apiFetch<Exam>(`/admin/exams/${exam.id}/duplicate/`, { method: "POST" });
        notify(t("exam.duplicated"));
        guard.leave(`/exams/${copy.id}`);
        return;
      }
      applyExam(await apiFetch<Exam>(`/admin/exams/${exam.id}/${action}/`, { method: "POST" }));
      setConfirm(null);
      notify(t(action === "archive" ? "exam.archived" : "exam.unpublished"));
    } catch (error) {
      if (isExamConflict(error)) void refreshExam();
      throw error;
    }
  }

  const title = exam ? examTitle(exam, locale) : null;
  const hasFieldErrors = Object.keys(errors.fields).length > 0;
  const marks = exam ? totalMarks(items, exam.default_marks) : null;
  const n = (value: number) => formatNumber(value, locale);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link href="/exams" className="inline-flex items-center gap-1.5 rounded-control text-sm text-ink-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden />
          {t("exam.back")}
        </Link>
        <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 lang={title?.lang} className="text-2xl font-semibold tracking-tight break-words text-ink">
                {exam ? title?.text || t("exams.untitled") : t("exam.createTitle")}
              </h1>
              {exam && <ExamStatusBadge status={exam.status} />}
            </div>
            {exam && (
              <p className="text-sm text-ink-muted">
                <span className="tabular-nums">#{exam.id}</span>
                {" · "}
                {t("exam.facts", {
                  questions: t("exam.factsQuestions", { n: n(exam.question_count), total: n(exam.total_questions) }),
                  duration: n(exam.duration_minutes),
                  marks: exam.total_marks,
                })}
              </p>
            )}
          </div>
          {exam && (
            <div className="min-w-0 lg:max-w-2xl">
              <div role="group" aria-label={t("exam.actions")} className="flex flex-wrap gap-2 lg:justify-end">
                {editable && (
                  <Button onClick={publish} disabled={busy !== null || dirty} aria-busy={busy === "publish" || undefined} aria-describedby={dirty ? "exam-save-first" : undefined}>
                    <Send aria-hidden />
                    {busy === "publish" ? t("exam.publishing") : t("exam.publish")}
                  </Button>
                )}
                {exam.status === "published" && (
                  <Button variant="secondary" onClick={() => setConfirm("unpublish")} disabled={busy !== null}>
                    <EyeOff aria-hidden />
                    {t("exam.unpublish")}
                  </Button>
                )}
                {editable && (
                  <Button variant="secondary" onClick={() => setConfirm("archive")} disabled={busy !== null || dirty} aria-describedby={dirty ? "exam-save-first" : undefined}>
                    <Archive aria-hidden />
                    {t("exam.archive")}
                  </Button>
                )}
                <Button variant="secondary" onClick={() => setConfirm("duplicate")} disabled={busy !== null || dirty} aria-describedby={dirty ? "exam-save-first" : undefined}>
                  <Copy aria-hidden />
                  {t("exam.duplicate")}
                </Button>
                {exam.status === "draft" && (
                  <Button variant="secondary" onClick={() => setConfirm("delete")} disabled={busy !== null} className="text-danger-700 hover:bg-danger-50">
                    <Trash2 aria-hidden />
                    {t("common.delete")}
                  </Button>
                )}
              </div>
              {dirty && (
                <p id="exam-save-first" className="mt-2 text-[13px] text-ink-muted lg:text-right">
                  {t("exam.saveFirst")}
                </p>
              )}
            </div>
          )}
        </header>
      </div>

      {lookupTruncated && <Alert tone="warning">{t("subjects.lookupTruncated", { n: n(subjects.length) })}</Alert>}

      <div ref={summaryRef} tabIndex={-1} className="space-y-3 focus:outline-none">
        {exam && !editable && (
          <Alert tone="locked">{t(exam.status === "archived" ? "exam.readOnlyArchived" : "exam.readOnlyPublished")}</Alert>
        )}
        {conflict && (
          <Alert tone="danger" title={conflict.title} live>
            {conflict.message}
          </Alert>
        )}
        {problems.length > 0 && (
          <Alert tone="danger" title={t("exam.publishBlocked")} live>
            <p>{t("exam.publishBlockedHint")}</p>
            <ul className="mt-2 space-y-2">
              {problems.map((problem) => (
                <li key={problem.field} className="text-danger-700">
                  <ul className="list-disc space-y-0.5 pl-5">
                    {problem.messages.map((message, index) => (
                      <li key={index}>{message}</li>
                    ))}
                  </ul>
                  {problem.section && (
                    <button
                      type="button"
                      onClick={() => goToSection(problem.section as SectionId)}
                      className="mt-0.5 ml-5 rounded-control text-[13px] font-medium text-brand-700 underline underline-offset-2 hover:text-brand-600"
                    >
                      {t("exam.goToSection", { section: t(SECTION_TITLES[problem.section]) })}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {problemIds.size > 0 && <p className="mt-2">{t("exam.problemQuestions")}</p>}
          </Alert>
        )}
        {(errors.form.length > 0 || (hasFieldErrors && problems.length === 0)) && (
          <Alert tone="danger" title={hasFieldErrors ? t("form.errorSummary") : undefined} live>
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

      <form noValidate onSubmit={saveSettings} className="space-y-6">
        <ExamSettings
          draft={draft}
          onChange={setDraft}
          errors={errors.fields}
          categories={categories}
          subjects={subjects}
          isNew={!exam}
          disabled={!editable || busy !== null}
        />
        <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-card sm:border">
          {settingsDirty && (
            <span className="mr-auto inline-flex items-center gap-1.5 text-[13px] text-warning-700">
              <span className="size-2 rounded-full bg-accent-500" aria-hidden />
              {t("exam.unsaved")}
            </span>
          )}
          <Button variant="secondary" onClick={() => guard.request("/exams")}>
            {t("common.cancel")}
          </Button>
          {editable && (
            <Button type="submit" disabled={busy !== null} aria-busy={busy === "settings" || undefined}>
              {busy === "settings" ? t("common.saving") : exam ? t("exam.saveSettings") : t("exam.createExam")}
            </Button>
          )}
        </div>
      </form>

      <SectionAnchor section="questions">
        <FormSection
          title={t("examQuestions.title")}
          description={t("examQuestions.hint")}
          aside={
            exam ? (
              <div className="text-right text-[13px]">
                <p
                  className={cn(
                    "font-medium tabular-nums",
                    items.length === exam.total_questions ? "text-ink" : "text-warning-700",
                  )}
                >
                  {t("examQuestions.assigned", { n: n(items.length), total: n(exam.total_questions) })}
                </p>
                {marks !== null && <p className="text-ink-muted">{t("examQuestions.totalMarks", { n: marks })}</p>}
              </div>
            ) : undefined
          }
        >
          {!exam ? (
            <p className="text-sm text-ink-muted">{t("examQuestions.saveExamFirst")}</p>
          ) : (
            <>
              {!editable && <Alert tone="locked">{t("examQuestions.locked")}</Alert>}
              {questionErrors.form.length > 0 && (
                <Alert tone="danger" live>
                  <ul className="list-disc space-y-0.5 pl-5 text-danger-700">
                    {questionErrors.form.map((message, index) => (
                      <li key={index}>{message}</li>
                    ))}
                  </ul>
                </Alert>
              )}
              {editable && (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <Button ref={addButtonRef} variant="secondary" onClick={() => setPickerOpen(true)} disabled={busy !== null} aria-haspopup="dialog">
                    <Plus aria-hidden />
                    {t("examQuestions.add")}
                  </Button>
                  <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                    {questionsDirty && (
                      <span className="inline-flex items-center gap-1.5 text-[13px] text-warning-700">
                        <span className="size-2 rounded-full bg-accent-500" aria-hidden />
                        {t("exam.unsaved")}
                      </span>
                    )}
                    <Button
                      onClick={saveQuestions}
                      disabled={busy !== null || !questionsDirty}
                      aria-busy={busy === "questions" || undefined}
                      aria-describedby="exam-questions-replace"
                    >
                      {busy === "questions" ? t("examQuestions.saving") : t("examQuestions.save")}
                    </Button>
                  </div>
                </div>
              )}
              {editable && (
                <p id="exam-questions-replace" className="text-[13px] text-ink-subtle">
                  {t("examQuestions.replaceNote")}
                </p>
              )}
              {items.length ? (
                <AssignedQuestions
                  items={items}
                  onChange={setItems}
                  defaultMarks={exam.default_marks}
                  disabled={!editable || busy !== null}
                  problems={problemIds}
                  marksErrors={questionErrors.rows}
                  announce={setAnnouncement}
                  addButtonRef={addButtonRef}
                />
              ) : (
                <EmptyState title={t("examQuestions.empty")} description={editable ? t("examQuestions.emptyHint") : undefined} />
              )}
            </>
          )}
        </FormSection>
      </SectionAnchor>

      {exam && <ExamSyllabus examId={exam.id} initial={syllabus} />}

      {exam && exam.status !== "draft" && (
        <ExamResults
          exam={exam}
          onExamChange={setExam}
          link={
            <Link
              href={`/results?exam=${exam.id}`}
              className="rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-600"
            >
              {t("resultsExam.viewResults")}
            </Link>
          }
        />
      )}

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {exam && pickerQuery && (
        <QuestionPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          query={pickerQuery}
          onQueryChange={setPickerQuery}
          items={items}
          onItemsChange={setItems}
          categories={categories}
          subjects={subjects}
          announce={setAnnouncement}
        />
      )}

      {exam && confirm && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirm(null)}
          title={t(`exam.${confirm}Title`)}
          description={
            confirm === "delete" ? t("exam.deleteBody", { name: title?.text || `#${exam.id}` }) : t(`exam.${confirm}Body`)
          }
          confirmLabel={t(confirm === "delete" ? "common.delete" : `exam.${confirm}`)}
          pendingLabel={confirm === "delete" ? t("common.deleting") : t("exam.working")}
          confirmVariant={confirm === "delete" || confirm === "archive" ? "danger" : "primary"}
          onConfirm={() => runConfirmed(confirm)}
          describe={(error) => describeExamError(error, t)}
        />
      )}

      <Modal
        open={guard.pending !== null}
        onOpenChange={(open) => !open && guard.cancel()}
        title={t("exam.unsavedTitle")}
        description={t("exam.unsavedBody")}
        size="sm"
        role="alertdialog"
        initialFocus={keepEditingRef}
        footer={
          <>
            <Button ref={keepEditingRef} variant="secondary" onClick={guard.cancel}>
              {t("exam.keepEditing")}
            </Button>
            <Button variant="danger" onClick={guard.discard}>
              {guard.pending && "action" in guard.pending ? t("exam.discardSignOut") : t("exam.discard")}
            </Button>
          </>
        }
      />
    </div>
  );
}
