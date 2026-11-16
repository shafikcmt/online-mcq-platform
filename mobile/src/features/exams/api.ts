import { api } from "@/api/client";
import { syncServerClock } from "@/lib/server-clock";

import type { ExamPage, ExamPaper, ExamWhen, StudentExamDetail } from "./types";

export const PAGE_SIZE = 20;

/** One page of exams for a tab ("open now", "upcoming", "past"), optionally in one category. */
export async function fetchExams(when: ExamWhen, page: number, category?: string): Promise<ExamPage> {
  const filter = category ? `&category=${encodeURIComponent(category)}` : "";
  const data = await api<ExamPage>(`/exams/?when=${when}${filter}&page=${page}&page_size=${PAGE_SIZE}`);
  syncServerClock(data.server_time);
  return data;
}

export async function fetchExam(slug: string): Promise<StudentExamDetail> {
  const data = await api<StudentExamDetail>(`/exams/${encodeURIComponent(slug)}/`);
  syncServerClock(data.server_time);
  return data;
}

/** The questions of an exam that is over, with answers and explanations (the server refuses with
 * 403 while the exam can still be taken, or when the admin keeps it closed). */
export function fetchExamPaper(slug: string): Promise<ExamPaper> {
  return api<ExamPaper>(`/exams/${encodeURIComponent(slug)}/questions/`);
}
