import type { PaymentMethod } from "./types";

/** The methods whose amount limits fit a package price. The server applies the same limits
 * when the payment starts; this only hides methods that would be refused. An unreadable price
 * hides nothing (the server decides). */
export function methodsForPrice(methods: PaymentMethod[], price: string): PaymentMethod[] {
  const amount = Number(price);
  if (!Number.isFinite(amount)) return methods;
  return methods.filter(
    (method) => (method.min_amount === null || amount >= Number(method.min_amount)) && (method.max_amount === null || amount <= Number(method.max_amount)),
  );
}

/** A logo is an admin-entered address: only https is drawn. */
export function logoUri(url: string): string | null {
  return /^https:\/\/[^\s]+$/i.test(url) ? url : null;
}
