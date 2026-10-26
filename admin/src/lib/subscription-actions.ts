"use client";

/** Admin subscription actions: manual grant (or extension) and cancel.
 *
 * A grant must carry an `Idempotency-Key` (backend: apps/subscriptions, `GrantRequest`).
 * The panel creates ONE key per intended grant — when the grant dialog opens — and sends
 * the same key on every retry of that grant (double click, network error, timeout), so
 * the server grants it at most once. A new grant (the dialog opened again) gets a new key. */
import type { AdminSubscription } from "@/types/subscriptions";

import { apiFetch, apiRequest } from "./api/client";

/** A random key matching the server's `^[A-Za-z0-9._:-]{1,64}$` (a UUID). Falls back to
 * `getRandomValues` where `randomUUID` is unavailable (pages served over plain HTTP). */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Optional fields are left out when empty: the server then uses the package's current
 * price and starts a new subscription now. */
export type GrantInput = { user: number; package: number; price_paid?: string; starts_at?: string };

export type GrantOutcome = {
  subscription: AdminSubscription;
  /** 200 = the student's running subscription to this package was extended; 201 = new. */
  extended: boolean;
  /** The server answered a retry of a grant it had already made (nothing granted again). */
  replayed: boolean;
};

export async function grantSubscription(input: GrantInput, key: string): Promise<GrantOutcome> {
  const response = await apiRequest<AdminSubscription>("/admin/subscriptions/grant/", {
    method: "POST",
    body: input,
    headers: { "Idempotency-Key": key },
  });
  return {
    subscription: response.data,
    extended: response.status === 200,
    replayed: response.headers.get("Idempotent-Replayed") === "true",
  };
}

/** Cancel now (access ends at once). A subscription that is already cancelled or has
 * expired answers 409 (`already_cancelled` / `subscription_expired`). */
export function cancelSubscription(id: number): Promise<AdminSubscription> {
  return apiFetch<AdminSubscription>(`/admin/subscriptions/${id}/cancel/`, { method: "POST" });
}
