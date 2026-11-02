import "server-only";

import { notFound } from "next/navigation";

import { ATTEMPT_ID } from "@/lib/results";
import type { AdminPaymentDetail } from "@/types/payments";

import { ApiError, adminRead } from "./server";

/** Payment ids are UUIDs, like attempt ids. */
const PAYMENT_ID = ATTEMPT_ID;

/** One payment by its public id (read-only, allow-listed: no provider payloads, IP
 * addresses or session keys in the admin API). */
export async function readPayment(rawId: string): Promise<AdminPaymentDetail> {
  if (!PAYMENT_ID.test(rawId)) notFound();
  try {
    return await adminRead<AdminPaymentDetail>(`/admin/payments/${rawId.toLowerCase()}/`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}
