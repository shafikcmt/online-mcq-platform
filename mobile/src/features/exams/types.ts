import type { AccessType, ExamType } from "@/features/dashboard/types";

/** Why the student can neither start nor resume now — the start endpoint's own error
 * codes (`GET /exams/` and `GET /exams/{slug}/`, backend `attempts.selectors`). */
export type LockedReason =
  | "needs_subscription"
  | "exam_not_started"
  | "exam_ended"
  | "retake_not_allowed"
  | "attempt_limit_reached";

/** `GET /exams/` item: the public exam fields plus this student's start state. Marks
 * arrive as decimal strings; titles and texts are already in the request language. */
export type StudentExam = {
  slug: string;
  title: string;
  description: string;
  instructions: string;
  exam_type: ExamType;
  access_type: AccessType;
  content_language: "bn" | "en" | "both";
  category: { slug: string; name: string };
  subject: { slug: string; name: string } | null;
  duration_minutes: number;
  total_questions: number;
  total_marks: string;
  negative_marks: string;
  pass_marks: string | null;
  start_at: string | null;
  end_at: string | null;
  is_featured: boolean;
  has_access: boolean;
  can_start: boolean;
  can_resume: boolean;
  attempt_state: "in_progress" | "finished" | null;
  locked_reason: LockedReason | null;
  attempts_used: number;
  /** null = unlimited */
  attempts_allowed: number | null;
  /** Time a new attempt would get now (less than the duration when joining late). */
  seconds_if_started_now: number | null;
  /** List rows only: the syllabus lines and how many study materials the exam has (absent from an older server). */
  syllabus?: SyllabusLine[];
  material_count?: number;
};

export type SyllabusLine = { subject: string; chapter: string; topic: string };

/** `GET /exams/{slug}/` (the exam's own screen): also the syllabus lines the admin wrote. */
export type StudentExamDetail = StudentExam & {
  server_time: string;
  syllabus: SyllabusLine[];
  /** The exam is over and its paper (questions with answers) can be read (absent from an older server). */
  questions_available?: boolean;
};

/** `GET /exams/{slug}/questions/`: the paper of an exam that is over. The Bangla / English
 * variants are present only when the exam has both languages. */
export type PaperOption = { id: number; text: string; text_bn?: string; text_en?: string; is_correct: boolean };
export type PaperQuestion = {
  question_id: number;
  number: number;
  text: string;
  text_bn?: string;
  text_en?: string;
  image: string | null;
  options: PaperOption[];
  correct_option_id: number | null;
  marks: string;
  explanation: string;
  explanation_bn?: string;
  explanation_en?: string;
};
export type ExamPaper = { slug: string; title: string; total_questions: number; questions: PaperQuestion[] };

export type ExamPage = { count: number; next: string | null; previous: string | null; results: StudentExam[]; server_time: string };

export type ExamWhen = "open" | "upcoming" | "ended";
