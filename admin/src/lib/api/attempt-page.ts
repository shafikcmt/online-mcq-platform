import "server-only";

import { notFound } from "next/navigation";

import { ATTEMPT_ID } from "@/lib/results";
import type { AdminAttemptDetail } from "@/types/attempts";

import { ApiError, adminRead } from "./server";

/** One attempt by its public id (read-only; no answers in the admin API). */
export async function readAttempt(rawId: string): Promise<AdminAttemptDetail> {
  if (!ATTEMPT_ID.test(rawId)) notFound();
  try {
    return await adminRead<AdminAttemptDetail>(`/admin/attempts/${rawId.toLowerCase()}/`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}
