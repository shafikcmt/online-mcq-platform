import "server-only";

import { notFound } from "next/navigation";

import type { AdminSubscription } from "@/types/subscriptions";

import { ApiError, adminRead } from "./server";

/** One subscription (read-only; the student's mobile number arrives masked). */
export async function readSubscription(rawId: string): Promise<AdminSubscription> {
  if (!/^\d{1,9}$/.test(rawId) || Number(rawId) <= 0) notFound();
  try {
    return await adminRead<AdminSubscription>(`/admin/subscriptions/${Number(rawId)}/`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}
