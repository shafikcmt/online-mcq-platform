import type { ContentLanguage } from "@/types/content";
import type { AccessType, Exam, ExamType, MeritStrategy, ResultVisibility } from "@/types/exams";

/** Exam settings editor state and its conversion to the API payload.
 *
 * Inputs hold strings (what the admin typed); `toExamPayload` converts them. Business
 * rules stay on the server (apps/exams/services.py): the payload states what the admin
 * chose, and the server answers with field errors. Two rules are shown in the form
 * because they decide which controls make sense, and are sent as shown:
 * - live exams: one attempt, no retakes, merit by the first attempt;
 * - no retakes: one attempt.
 */
export type ExamDraft = {
  title_bn: string;
  title_en: string;
  slug: string;
  description_bn: string;
  description_en: string;
  instructions_bn: string;
  instructions_en: string;
  content_language: ContentLanguage;
  category: string;
  subject: string;
  exam_type: ExamType;
  access_type: AccessType;
  duration_minutes: string;
  total_questions: string;
  default_marks: string;
  negative_marks: string;
  pass_marks: string;
  /** Asia/Dhaka wall time, "YYYY-MM-DDTHH:mm" (datetime-local), or "". */
  start_at: string;
  end_at: string;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  allow_retake: boolean;
  /** With retakes: "" = unlimited. */
  max_attempts: string;
  merit_enabled: boolean;
  merit_strategy: MeritStrategy;
  result_visibility: ResultVisibility;
  allow_answer_review: boolean;
  is_featured: boolean;
};

// ----------------------------------------------------------------------------------
// Schedule: shown and entered in Asia/Dhaka (UTC+6 all year, no daylight saving),
// sent as timezone-aware ISO 8601 (the API rejects times without a zone).
// ----------------------------------------------------------------------------------
export const SCHEDULE_TIME_ZONE = "Asia/Dhaka";
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const LOCAL_INPUT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** API ISO time → datetime-local value in Asia/Dhaka. */
export function toDhakaInput(iso: string | null): string {
  if (!iso) return "";
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  return new Date(time + DHAKA_OFFSET_MS).toISOString().slice(0, 16);
}

/** datetime-local value (Asia/Dhaka) → ISO with the +06:00 offset, or null when empty.
 * Anything else is sent as typed so the server reports it on the field. */
export function fromDhakaInput(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  return LOCAL_INPUT.test(text) ? `${text}:00+06:00` : text;
}

// ----------------------------------------------------------------------------------
// Draft ⇄ API
// ----------------------------------------------------------------------------------
export function draftFromExam(exam: Exam): ExamDraft {
  return {
    title_bn: exam.title_bn,
    title_en: exam.title_en,
    slug: exam.slug,
    description_bn: exam.description_bn,
    description_en: exam.description_en,
    instructions_bn: exam.instructions_bn,
    instructions_en: exam.instructions_en,
    content_language: exam.content_language,
    category: String(exam.category),
    subject: exam.subject === null ? "" : String(exam.subject),
    exam_type: exam.exam_type,
    access_type: exam.access_type,
    duration_minutes: String(exam.duration_minutes),
    total_questions: String(exam.total_questions),
    default_marks: exam.default_marks,
    negative_marks: exam.negative_marks,
    pass_marks: exam.pass_marks ?? "",
    start_at: toDhakaInput(exam.start_at),
    end_at: toDhakaInput(exam.end_at),
    shuffle_questions: exam.shuffle_questions,
    shuffle_options: exam.shuffle_options,
    allow_retake: exam.allow_retake,
    max_attempts: exam.max_attempts === null ? "" : String(exam.max_attempts),
    merit_enabled: exam.merit_enabled,
    merit_strategy: exam.merit_strategy,
    result_visibility: exam.result_visibility,
    allow_answer_review: exam.allow_answer_review,
    is_featured: exam.is_featured,
  };
}

/** A new exam: the model's defaults (apps/exams/models.py). */
export function newExamDraft(category = ""): ExamDraft {
  return {
    title_bn: "",
    title_en: "",
    slug: "",
    description_bn: "",
    description_en: "",
    instructions_bn: "",
    instructions_en: "",
    content_language: "bn",
    category,
    subject: "",
    exam_type: "regular",
    access_type: "free",
    duration_minutes: "",
    total_questions: "",
    default_marks: "1.00",
    negative_marks: "0.00",
    pass_marks: "",
    start_at: "",
    end_at: "",
    shuffle_questions: false,
    shuffle_options: false,
    allow_retake: false,
    max_attempts: "",
    merit_enabled: true,
    merit_strategy: "first_attempt",
    result_visibility: "immediate",
    allow_answer_review: true,
    is_featured: false,
  };
}

/** Practice exams start with retakes, unlimited attempts and no merit list (the
 * server's defaults for a new practice exam, DATABASE_DESIGN §4.5). Applied when the
 * admin switches a NEW exam to practice, so the form shows what will be saved. */
export function withPracticeDefaults(draft: ExamDraft): ExamDraft {
  return { ...draft, allow_retake: true, max_attempts: "", merit_enabled: false };
}

/** The rules the form displays for the chosen type and retake setting. */
export function attemptRules(draft: Pick<ExamDraft, "exam_type" | "allow_retake">) {
  const live = draft.exam_type === "live";
  return {
    /** Live: one attempt, no retakes, first-attempt merit — fixed by the server. */
    live,
    retakeLocked: live,
    strategyLocked: live,
    /** No retakes (or live): exactly one attempt. */
    singleAttempt: live || !draft.allow_retake,
  };
}

const toInt = (value: string) => {
  const text = value.trim();
  return text === "" ? null : /^\d+$/.test(text) ? Number(text) : text;
};
const decimalOrNull = (value: string) => (value.trim() === "" ? null : value.trim());

/** The complete settings payload (create and edit send the same fields). */
export function toExamPayload(draft: ExamDraft) {
  const rules = attemptRules(draft);
  const payload: Record<string, unknown> = {
    title_bn: draft.title_bn,
    title_en: draft.title_en,
    slug: draft.slug.trim(),
    description_bn: draft.description_bn,
    description_en: draft.description_en,
    instructions_bn: draft.instructions_bn,
    instructions_en: draft.instructions_en,
    content_language: draft.content_language,
    category: draft.category ? Number(draft.category) : null,
    subject: draft.subject ? Number(draft.subject) : null,
    exam_type: draft.exam_type,
    access_type: draft.access_type,
    duration_minutes: toInt(draft.duration_minutes),
    total_questions: toInt(draft.total_questions),
    pass_marks: decimalOrNull(draft.pass_marks),
    start_at: fromDhakaInput(draft.start_at),
    end_at: fromDhakaInput(draft.end_at),
    shuffle_questions: draft.shuffle_questions,
    shuffle_options: draft.shuffle_options,
    allow_retake: rules.retakeLocked ? false : draft.allow_retake,
    max_attempts: rules.singleAttempt ? 1 : toInt(draft.max_attempts),
    merit_enabled: draft.merit_enabled,
    merit_strategy: rules.strategyLocked ? "first_attempt" : draft.merit_strategy,
    result_visibility: draft.result_visibility,
    allow_answer_review: draft.allow_answer_review,
    is_featured: draft.is_featured,
  };
  // Required decimals with server defaults: omitted when cleared (the server keeps or
  // applies its value) rather than sent as an invalid empty string.
  if (draft.default_marks.trim() !== "") payload.default_marks = draft.default_marks.trim();
  if (draft.negative_marks.trim() !== "") payload.negative_marks = draft.negative_marks.trim();
  return payload;
}

/** Field → form section, for jumping from an error summary to the right place. */
export const EXAM_FIELD_SECTIONS: Record<string, string> = {
  title_bn: "basics",
  title_en: "basics",
  slug: "basics",
  description_bn: "basics",
  description_en: "basics",
  instructions_bn: "basics",
  instructions_en: "basics",
  content_language: "basics",
  category: "basics",
  subject: "basics",
  exam_type: "basics",
  access_type: "basics",
  is_featured: "basics",
  start_at: "schedule",
  end_at: "schedule",
  duration_minutes: "schedule",
  total_questions: "scoring",
  default_marks: "scoring",
  negative_marks: "scoring",
  pass_marks: "scoring",
  allow_retake: "attempts",
  max_attempts: "attempts",
  shuffle_questions: "attempts",
  shuffle_options: "attempts",
  merit_enabled: "merit",
  merit_strategy: "merit",
  result_visibility: "review",
  allow_answer_review: "review",
  questions: "questions",
};

export const EXAM_FIELDS = new Set(Object.keys(EXAM_FIELD_SECTIONS));

/** Draft equality for the unsaved-changes guard. */
export function sameDraft(a: ExamDraft, b: ExamDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function isEditableStatus(status: Exam["status"]): boolean {
  return status === "draft" || status === "unpublished";
}
