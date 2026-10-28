import type { Locale } from "./i18n/messages";

/** Western digits in all UI numbers, in both languages (Indian grouping in `bn`). Note:
 * docs/LOCALIZATION.md §11 lists this as an open owner decision — its rule asks for Bangla
 * digits in `bn` everywhere. */
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

// Bangla names the part of the day before the time ("সকাল 9:00") instead of AM/PM, which
// Intl leaves in English for `bn`. Each entry: the hour it starts at.
const BN_DAY_PERIODS: readonly (readonly [number, string])[] = [
  [0, "রাত"],
  [4, "ভোর"],
  [6, "সকাল"],
  [12, "দুপুর"],
  [15, "বিকাল"],
  [18, "সন্ধ্যা"],
  [20, "রাত"],
];

export function bnDayPeriod(hour: number): string {
  let name = BN_DAY_PERIODS[0][1];
  for (const [from, period] of BN_DAY_PERIODS) if (hour >= from) name = period;
  return name;
}

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000; // UTC+6 all year (no daylight saving)

/** Date and time in Bangladesh time, Western digits: "27 Oct 2026, 16:29" style per locale;
 * Bangla: "27 অক্টো, 2026, বিকাল 4:29". */
export function formatDateTime(iso: string, locale: Locale = "en"): string {
  const when = new Date(iso);
  if (locale !== "bn") {
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Dhaka",
      numberingSystem: "latn",
    }).format(when);
  }
  const day = new Intl.DateTimeFormat("bn-BD", { dateStyle: "medium", timeZone: "Asia/Dhaka", numberingSystem: "latn" }).format(when);
  const dhaka = new Date(when.getTime() + DHAKA_OFFSET_MS);
  const hours = dhaka.getUTCHours();
  return `${day}, ${bnDayPeriod(hours)} ${hours % 12 || 12}:${String(dhaka.getUTCMinutes()).padStart(2, "0")}`;
}
