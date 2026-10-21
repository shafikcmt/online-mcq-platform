import "server-only";

import { notFound } from "next/navigation";

import { ATTEMPT_ID } from "@/lib/results";
import type { Paginated } from "@/types/content";
import type { Exam } from "@/types/exams";
import type { AdminResult } from "@/types/results";

import { ApiError, adminRead } from "./server";

/** One result, addressed by its attempt id. There is no admin result detail endpoint
 * (Milestone 7D contract): the list filtered by `attempt` must return exactly one row.
 * 0 rows → not found; more than one → the contract is broken, and the page fails safely
 * instead of picking one. */
export async function readResult(rawId: string): Promise<AdminResult> {
  if (!ATTEMPT_ID.test(rawId)) notFound();
  const page = await adminRead<Paginated<AdminResult>>(`/admin/results/?attempt=${encodeURIComponent(rawId)}`);
  if (page.count === 0 || page.results.length === 0) notFound();
  if (page.count !== 1 || page.results.length !== 1 || page.results[0].attempt_id !== rawId.toLowerCase()) {
    throw new Error("The results API returned more than one result for one attempt.");
  }
  return page.results[0];
}

/** The exam behind a result or a results filter; `null` when it does not exist. */
export async function readExamOrNull(id: number): Promise<Exam | null> {
  try {
    return await adminRead<Exam>(`/admin/exams/${id}/`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
