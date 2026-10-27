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

/** Day, short month and clock time in the phone's time zone, e.g. "30 Oct, 9:00 pm". */
export function formatDateTime(iso: string, language: string): string {
  return format(
    iso,
    language,
    { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true },
    (date) => date.toISOString().slice(0, 16).replace("T", " "),
  );
}

/** A decimal from the API ("45.00", "37.50") without trailing zeros ("45", "37.5"), in
 * the UI language's digits. Values are shown as the server computed them, never re-rounded
 * into a different number. */
export function formatDecimal(value: string, language: string): string {
  const trimmed = value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
  return localizeDigits(trimmed, language);
}
