import type { AttemptStatus, SubmitSource } from "./results";

/** One row of GET /admin/attempts/ (apps/attempts/api/admin_views.py). Operational data
 * only: the admin API never returns answers, options, question content, device info or
 * idempotency keys. Timing flags are the server's (never recomputed in the panel). */
export type AdminAttempt = {
  /** The attempt's public id: its address here and its result's (/results/[attemptId]). */
  attempt_id: string;
  exam_id: number;
  exam_title_bn: string;
  exam_title_en: string;
  user_id: number;
  user_full_name: string;
  attempt_no: number;
  status: AttemptStatus;
  started_at: string;
  deadline_at: string;
  /** null while the attempt is open. */
  submitted_at: string | null;
  submit_source: SubmitSource | null;
  content_language: "bn" | "en";
  /** Still open past deadline + grace: the server finalizes it. */
  is_overdue: boolean;
  has_result: boolean;
  /** Stored result values; null while there is no result. */
  obtained_marks: string | null;
  total_marks: string | null;
  percentage: string | null;
  /** null: no result, or the exam has no pass mark. */
  is_passed: boolean | null;
};

export type AdminAttemptDetail = AdminAttempt & {
  created_at: string;
  /** The server clock when this was read: every timing value is relative to it. */
  server_time: string;
  /** Seconds until the deadline at server_time (0 once finished or past it). */
  remaining_seconds: number;
  /** Deadline + submit grace: the last moment a submit is accepted. */
  can_submit_until: string;
  time_used_seconds: number | null;
  merit_position: number | null;
  is_merit_counted: boolean | null;
};

export const ATTEMPT_STATUSES: AttemptStatus[] = ["in_progress", "submitted", "auto_submitted"];
