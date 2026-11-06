import { api } from "@/api/client";
import type { Page } from "@/lib/use-pages";

import type { Package, Payment, PaymentMethod } from "./types";

export function fetchPackages(page: number) {
  return api<Page<Package>>(`/packages/?page=${page}&page_size=50`);
}

/** Starts buying a package. Only the package (and the chosen method) is sent: the price comes from the server.
 * The same Idempotency-Key returns the same payment (a double tap cannot pay twice). */
export function initiatePayment(packageId: number, idempotencyKey: string, provider?: string) {
  return api<Payment>("/payments/", {
    method: "POST",
    body: provider ? { package_id: packageId, provider } : { package_id: packageId },
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

/** The payment methods the student can choose from now, in display order (the first is the
 * default). Empty while payments are off. */
export async function fetchPaymentMethods(): Promise<PaymentMethod[]> {
  const answer = await api<{ results: PaymentMethod[] }>("/payments/methods/");
  return answer.results;
}

/** The payment as the server knows it — the only source of "paid". */
export function fetchPayment(paymentId: string) {
  return api<Payment>(`/payments/${encodeURIComponent(paymentId)}/`);
}

export function fetchPayments(page: number) {
  return api<Page<Payment>>(`/payments/?page=${page}&page_size=20`);
}
