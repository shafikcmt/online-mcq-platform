/** Exam shapes, as returned by the backend admin serializers (apps/exams/api/serializers.py). */
import type { ContentLanguage } from "./content";

export type ExamType = "practice" | "regular" | "live";
export const EXAM_TYPES: ExamType[] = ["practice", "regular", "live"];
export type ExamStatus = "draft" | "published" | "unpublished" | "archived";
export const EXAM_STATUSES: ExamStatus[] = ["draft", "published", "unpublished", "archived"];
export type AccessType = "free" | "paid";
export const ACCESS_TYPES: AccessType[] = ["free", "paid"];
export type MeritStrategy = "first_attempt" | "best_attempt" | "latest_attempt";
export const MERIT_STRATEGIES: MeritStrategy[] = ["first_attempt", "best_attempt", "latest_attempt"];
export type ResultVisibility = "immediate" | "after_exam_end" | "manual";
export const RESULT_VISIBILITIES: ResultVisibility[] = ["immediate", "after_exam_end", "manual"];

/** Only these statuses can be edited (apps/exams/models.py EDITABLE_STATUSES). */
export const EDITABLE_STATUSES: ExamStatus[] = ["draft", "unpublished"];

export type Exam = {
  id: number;
  public_id: string;
  slug: string;
  status: ExamStatus;
  title_bn: string;
  title_en: string;
  description_bn: string;
  description_en: string;
  instructions_bn: string;
  instructions_en: string;
  content_language: ContentLanguage;
  category: number;
  subject: number | null;
  group: number | null;
  exam_type: ExamType;
  access_type: AccessType;
  duration_minutes: number;
  /** The planned (required) number of questions — publishing needs exactly this many. */
  total_questions: number;
  default_marks: string;
  negative_marks: string;
  pass_marks: string | null;
  start_at: string | null;
  end_at: string | null;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  allow_retake: boolean;
  /** null = unlimited. */
  max_attempts: number | null;
  merit_enabled: boolean;
  merit_strategy: MeritStrategy;
  result_visibility: ResultVisibility;
  allow_answer_review: boolean;
  is_featured: boolean;
  result_published_at: string | null;
  /** Read-only: whether students can see the results right now — computed by the server's
   * visibility rule (never derived in the panel). */
  results_visible: boolean;
  /** Read-only: questions currently assigned. */
  question_count: number;
  /** Read-only: sum of effective marks of the assigned questions. */
  total_marks: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
};

/** One row of GET /admin/exams/{id}/questions/ (read-only text included since 7C). */
export type ExamQuestionRow = {
  question: number;
  sort_order: number;
  marks: string | null;
  effective_marks: string;
  subject: number;
  available_languages: ContentLanguage;
  is_active: boolean;
  text_bn: string;
  text_en: string;
};
