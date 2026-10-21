/** One row of GET /admin/results/ (apps/results/api/views.py AdminResultListView). Scores
 * and merit only — the admin API never returns answers, options or explanations. */
export type AttemptStatus = "in_progress" | "submitted" | "auto_submitted";
export type SubmitSource = "manual" | "client_timeout" | "server_auto";

export type AdminResult = {
  /** The attempt's public id: also this result's address (/results/[attemptId]). */
  attempt_id: string;
  attempt_no: number;
  exam_id: number;
  exam_title_bn: string;
  exam_title_en: string;
  user_id: number;
  user_full_name: string;
  status: AttemptStatus;
  submit_source: SubmitSource | "";
  submitted_at: string;
  correct_count: number;
  wrong_count: number;
  unanswered_count: number;
  obtained_marks: string;
  total_marks: string;
  percentage: string;
  /** null: the exam has no pass mark. */
  is_passed: boolean | null;
  time_used_seconds: number;
  is_merit_counted: boolean;
  /** null: not ranked (merit not generated yet, or not the counted attempt). */
  merit_position: number | null;
};
