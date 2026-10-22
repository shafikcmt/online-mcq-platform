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

/** The subscription behind a payments filter; `null` when it does not exist. */
export async function readSubscriptionOrNull(id: number): Promise<AdminSubscription | null> {
  try {
    return await adminRead<AdminSubscription>(`/admin/subscriptions/${id}/`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
