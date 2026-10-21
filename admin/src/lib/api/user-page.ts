import "server-only";

import { notFound } from "next/navigation";

import type { AdminUserDetail } from "@/types/users";

import { ApiError, adminRead } from "./server";

const USER_ID = /^\d{1,9}$/;

/** One user with their activity counts (read-only; contact details arrive masked). */
export async function readUser(rawId: string): Promise<AdminUserDetail> {
  if (!USER_ID.test(rawId) || Number(rawId) <= 0) notFound();
  try {
    return await adminRead<AdminUserDetail>(`/admin/users/${Number(rawId)}/`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}

/** The student behind a results filter; `null` when the user does not exist. */
export async function readUserOrNull(id: number): Promise<AdminUserDetail | null> {
  try {
    return await adminRead<AdminUserDetail>(`/admin/users/${id}/`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
