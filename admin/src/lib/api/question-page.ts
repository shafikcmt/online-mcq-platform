import "server-only";

import { notFound } from "next/navigation";

import type { Category, Question, Subject } from "@/types/content";

import { adminLookup } from "./lists";
import { ApiError, adminRead } from "./server";

/** Data for the question editor page: categories for the picker and the subjects of the
 * selected category, fetched in parallel (no client request on first render). */
export async function questionEditorData(categoryId: number | null) {
  const [categories, subjects] = await Promise.all([
    adminLookup<Category>("/admin/categories/"),
    categoryId ? adminLookup<Subject>("/admin/subjects/", `category=${categoryId}`) : Promise.resolve({ rows: [] as Subject[] }),
  ]);
  return { categories: categories.rows, subjects: subjects.rows };
}

export async function readQuestion(rawId: string): Promise<Question> {
  if (!/^\d{1,9}$/.test(rawId) || Number(rawId) <= 0) notFound();
  try {
    return await adminRead<Question>(`/admin/questions/${Number(rawId)}/`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}
