import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

/** Where the provider's return page sends the browser: the app's own link
 * (`livemodeltest://payment-result` in a build; the server's PAYMENT_RETURN_URL must be the
 * same). The link only closes the browser — what it says is never trusted: the app then
 * asks the server for the payment's status. */
export const RETURN_URL = Linking.createURL("payment-result");

/** Opens the provider's checkout page in an in-app browser and resolves when the student
 * comes back (the return link, or the browser closed) — whatever happened there. */
export async function openCheckout(checkoutUrl: string): Promise<void> {
  try {
    await WebBrowser.openAuthSessionAsync(checkoutUrl, RETURN_URL);
  } catch {
    // Could not open the in-app browser: try the system browser; the status check follows.
    await Linking.openURL(checkoutUrl).catch(() => undefined);
  }
}

export function newPaymentKey(): string {
  return `pay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A payment id from a link is only used to ask the server about our own payment. */
export function isPaymentId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
