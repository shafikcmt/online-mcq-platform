import type { Locale } from "./i18n/messages";

/** Western digits in all UI numbers (docs/LOCALIZATION.md); grouping per locale. */
export function formatNumber(value: number, locale: Locale = "en"): string {
  return new Intl.NumberFormat(locale === "bn" ? "en-IN" : "en-US").format(value);
}

/** Money from the API's decimal string, e.g. "1000.00" → "৳ 1,000.00". Never parsed
 * into a float for arithmetic — only for display. */
export function formatMoney(amount: string, currency: string, locale: Locale = "en"): string {
  const value = Number(amount);
  const digits = new Intl.NumberFormat(locale === "bn" ? "en-IN" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
  return currency === "BDT" ? `৳ ${digits}` : `${currency} ${digits}`;
}

export function formatDateTime(iso: string, locale: Locale = "en"): string {
  return new Intl.DateTimeFormat(locale === "bn" ? "bn-BD" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dhaka",
    numberingSystem: "latn",
  }).format(new Date(iso));
}
