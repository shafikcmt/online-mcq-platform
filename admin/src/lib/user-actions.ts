"use client";

/** Admin user action: activate or deactivate a **student** account. Deactivating signs
 * the student out everywhere at once (the server revokes every session); their results,
 * payments and subscriptions are kept. Staff accounts answer 409 `not_a_student`. Asking
 * for the state the account already has changes nothing. */
import type { AdminUserDetail } from "@/types/users";

import { apiFetch } from "./api/client";

export function setUserActive(id: number, active: boolean): Promise<AdminUserDetail> {
  return apiFetch<AdminUserDetail>(`/admin/users/${id}/${active ? "activate" : "deactivate"}/`, { method: "POST" });
}

/** Erase a student's personal data on their request (they cannot use the app). Irreversible: the name,
 * mobile number, e-mail and nickname are replaced and every session ends; results and payments stay,
 * without the name. Staff accounts answer 409. */
export function anonymiseUser(id: number): Promise<AdminUserDetail> {
  return apiFetch<AdminUserDetail>(`/admin/users/${id}/anonymise/`, { method: "POST", body: { confirm: true } });
}
