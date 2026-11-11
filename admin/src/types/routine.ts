/** The exam routine (apps/exams): `GET /public/routine/` is the live schedule; the PDF is
 * managed with `GET`/`POST`/`DELETE /admin/routine/pdf/`. */
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
  exam_type: "practice" | "regular" | "live";
  access_type: "free" | "paid";
};

export type RoutinePdfInfo = { available: boolean; name: string; size_bytes: number; updated_at: string | null };

export type RoutineResponse = { pdf: Omit<RoutinePdfInfo, "name" | "updated_at"> & Partial<RoutinePdfInfo>; exams: RoutineExam[] };
