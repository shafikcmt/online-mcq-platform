import { api } from "@/api/client";
import { syncServerClock } from "@/lib/server-clock";

import type { ExamPage, ExamPaper, ExamWhen, StudentExamDetail } from "./types";

export const PAGE_SIZE = 20;

/** One page of exams for a tab ("open now", "upcoming", "past"), optionally in one category. */
/** Which shelf of a category to list: `group` = the exams sitting directly in that group (slug),
 * `ungrouped` = the exams not in any group (what a category lists under its group rows). */
export type ExamShelf = { group?: string; ungrouped?: boolean };

export async function fetchExams(when: ExamWhen, page: number, category?: string, shelf: ExamShelf = {}): Promise<ExamPage> {
  const filter =
    (category ? `&category=${encodeURIComponent(category)}` : "") +
    (shelf.group ? `&group=${encodeURIComponent(shelf.group)}` : "") +
    (shelf.ungrouped ? "&ungrouped=true" : "");
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
