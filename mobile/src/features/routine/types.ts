import type { AccessType, ExamType } from "@/features/dashboard/types";

/** `GET /public/routine/` (no login): every scheduled exam that has not ended, earliest first,
 * and whether a routine PDF is published (`GET /public/routine/pdf/`). Marks are decimal
 * strings; titles and names are already in the request language. */
export type RoutineExam = {
  slug: string;
  title: string;
  category: { slug: string; name: string };
  subject: { slug: string; name: string } | null;
  start_at: string | null;
  end_at: string | null;
  duration_minutes: number;
  total_questions: number;
  total_marks: string;
  exam_type: ExamType;
  access_type: AccessType;
};

export type RoutineResponse = {
  pdf: { available: boolean; size_bytes: number; updated_at: string | null };
  exams: RoutineExam[];
};
