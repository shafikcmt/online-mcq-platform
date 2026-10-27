import type { AttemptSummary } from "@/features/attempt/types";
import type { ExamType } from "@/features/dashboard/types";
import type { Page } from "@/lib/use-pages";

/** Student results API (`/results/…`, `/exams/{slug}/leaderboard/`; backend
 * `results.api`). Marks are decimal strings exactly as the server calculated them. */
export type ResultDetail = {
  attempt_id: string;
  attempt_no: number;
  status: AttemptSummary["status"];
  exam: { slug: string; title: string; exam_type: ExamType };
  submitted_at: string;
  total_questions: number;
  correct_count: number;
  wrong_count: number;
  unanswered_count: number;
  positive_marks: string;
  negative_marks_total: string;
  obtained_marks: string;
  total_marks: string;
  percentage: string;
  pass_marks: string | null;
  is_passed: boolean | null;
  time_used_seconds: number;
  is_merit_counted: boolean;
  merit_position: number | null;
  review_available: boolean;
};

export type ReviewOption = { id: number; text: string; text_bn?: string; text_en?: string; is_correct: boolean };

export type ReviewQuestion = {
  question_id: number;
  number: number;
  text: string;
  text_bn?: string;
  text_en?: string;
  image: string | null;
  options: ReviewOption[];
  selected_option_id: number | null;
  correct_option_id: number | null;
  is_correct: boolean | null;
  marks: string;
  awarded_marks: string;
  is_marked_for_review: boolean;
  explanation: string;
  explanation_bn?: string;
  explanation_en?: string;
};

export type Review = { result: ResultDetail; questions: ReviewQuestion[] };

export type LeaderboardRow = {
  position: number;
  name: string;
  obtained_marks: string;
  total_marks: string;
  percentage: string;
  time_used_seconds: number;
  is_me: boolean;
};

export type LeaderboardPage = Page<LeaderboardRow> & { my_position: number | null };

/** `GET /attempts/` row: every attempt, including ones whose result is not out yet. */
export type HistoryItem = AttemptSummary & { exam: { slug: string; title: string } };
