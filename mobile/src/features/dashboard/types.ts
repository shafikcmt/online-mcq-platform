/** `GET /me/dashboard/` (backend `apps/dashboard`). Student-safe fields only: slugs and
 * public ids, titles already in the request language. Marks arrive as decimal strings. */
export type ExamType = "practice" | "regular" | "live";
export type AccessType = "free" | "paid";

export type DashboardExam = {
  slug: string;
  title: string;
  exam_type: ExamType;
  access_type: AccessType;
  start_at: string | null;
  end_at: string | null;
  duration_minutes: number;
  /** Entitlement only: free, or covered by a current subscription. */
  has_access: boolean;
  /** A new attempt may start now (the exam engine's own rules). */
  can_start: boolean;
  /** An open attempt can be continued now. */
  can_resume: boolean;
  attempt_state: "in_progress" | "finished" | null;
};

export type ExamSection = { count: number; items: DashboardExam[] };

export type DashboardResult = {
  attempt_id: string;
  exam: { slug: string; title: string; exam_type: ExamType };
  submitted_at: string;
  obtained_marks: string;
  total_marks: string;
  percentage: string;
  is_passed: boolean | null;
  merit_position: number | null;
};

export type Dashboard = {
  server_time: string;
  exams: { available: ExamSection; upcoming: ExamSection; practice: ExamSection };
  subscription: {
    active_count: number;
    items: { package: { slug: string; name: string }; starts_at: string; expires_at: string }[];
  };
  results: { count: number; items: DashboardResult[] };
  notifications: { unread_count: number };
};
