import { localizeDigits } from "./text";

function locale(language: string): string {
  return language === "bn" ? "bn-BD" : "en-GB";
}

function format(iso: string, language: string, options: Intl.DateTimeFormatOptions, fallback: (date: Date) => string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale(language), options).format(date);
  } catch {
    return fallback(date);
  }
}

/** Dates in the UI language (Bangla months and digits for `bn`). */
export function formatDate(iso: string, language: string): string {
  return format(iso, language, { day: "numeric", month: "long", year: "numeric" }, (date) => date.toISOString().slice(0, 10));
}

// Bangla names the part of the day before the time ("সকাল ৯:০০") instead of AM/PM, which
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

/** Day, short month and clock time in the phone's time zone: "30 Oct, 9:00 pm" /
 * "৩০ অক্টো, রাত ৯:০০". */
export function formatDateTime(iso: string, language: string): string {
  if (language !== "bn") {
    return format(
      iso,
      language,
      { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true },
      (date) => date.toISOString().slice(0, 16).replace("T", " "),
    );
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = format(iso, language, { day: "numeric", month: "short" }, (d) => d.toISOString().slice(0, 10));
  const hours = date.getHours();
  const clock = `${hours % 12 || 12}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${day}, ${bnDayPeriod(hours)} ${localizeDigits(clock, "bn")}`;
}

/** A decimal from the API ("45.00", "37.50") without trailing zeros ("45", "37.5"), in
 * the UI language's digits. Values are shown as the server computed them, never re-rounded
 * into a different number. */
export function formatDecimal(value: string, language: string): string {
  const trimmed = value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
  return localizeDigits(trimmed, language);
}
