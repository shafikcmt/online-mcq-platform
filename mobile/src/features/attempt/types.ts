/** Exam engine payloads (`/exams/{slug}/attempts/`, `/attempts/{id}/…`; backend
 * `attempts.api`). The room never contains correct answers or explanations. */
export type AttemptStatus = "in_progress" | "submitted" | "auto_submitted";

export type RoomOption = { id: number; text: string; text_bn?: string; text_en?: string };

export type RoomQuestion = {
  question_id: number;
  number: number;
  text: string;
  text_bn?: string;
  text_en?: string;
  image: string | null;
  marks: string;
  options: RoomOption[];
  selected_option_id: number | null;
  is_marked_for_review: boolean;
};

export type AttemptSummary = {
  attempt_id: string;
  attempt_no: number;
  status: AttemptStatus;
  server_time: string;
  started_at: string;
  deadline_at: string;
  remaining_seconds: number;
  can_edit: boolean;
  can_submit: boolean;
  submitted_at: string | null;
  submit_source: "manual" | "client_timeout" | "server_auto" | null;
};

export type Room = AttemptSummary & {
  content_language: "bn" | "en";
  exam: {
    slug: string;
    title: string;
    instructions: string;
    exam_type: "practice" | "regular" | "live";
    content_language: "bn" | "en" | "both";
    duration_minutes: number;
    total_questions: number;
    negative_marks: string;
  };
  questions: RoomQuestion[];
};

export type AnswerChange = {
  question_id: number;
  selected_option_id?: number | null;
  is_marked_for_review?: boolean;
  client_saved_at: string;
};

export type AnswerState = {
  question_id: number;
  status: "saved" | "stale" | "deadline_passed";
  selected_option_id: number | null;
  is_marked_for_review: boolean;
};

export type SaveResult = { server_time: string; deadline_at: string; remaining_seconds: number; answers: AnswerState[] };

export type ResultSummary = {
  attempt_id: string;
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
};

export type SubmitResult = AttemptSummary & { answers: AnswerState[]; result_available: boolean; result: ResultSummary | null };
