import "server-only";

import { notFound } from "next/navigation";

import type { Category, Subject } from "@/types/content";
import type { Exam, ExamQuestionRow } from "@/types/exams";

import { adminLookup } from "./lists";
import { ApiError, adminRead } from "./server";

/** Categories and subjects for the exam editor (its own selects and the question
 * picker's filters), fetched in parallel on the server. */
export async function examLookups() {
  const [categories, subjects] = await Promise.all([
    adminLookup<Category>("/admin/categories/"),
    adminLookup<Subject>("/admin/subjects/"),
  ]);
  return {
    categories: categories.rows,
    subjects: subjects.rows,
    lookupTruncated: categories.truncated || subjects.truncated,
  };
}

/** The exam and its COMPLETE assigned question list (one request, no pagination: the
 * list is bounded by EXAM_MAX_QUESTIONS and rows carry no answer data). */
export async function readExam(rawId: string): Promise<{ exam: Exam; questions: ExamQuestionRow[] }> {
  if (!/^\d{1,9}$/.test(rawId) || Number(rawId) <= 0) notFound();
  const id = Number(rawId);
  try {
    const [exam, list] = await Promise.all([
      adminRead<Exam>(`/admin/exams/${id}/`),
      adminRead<{ questions: ExamQuestionRow[] }>(`/admin/exams/${id}/questions/`),
    ]);
    return { exam, questions: list.questions };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}
