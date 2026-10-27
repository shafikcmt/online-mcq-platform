import type { Lang } from "./i18n";

const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";

export function digits(value: string | number, lang: Lang): string {
  const text = String(value);
  return lang === "bn" ? text.replace(/[0-9]/g, (d) => BANGLA_DIGITS[Number(d)]) : text;
}

/** A decimal from the API ("500.00") without trailing zeros, in the page's digits. */
export function decimal(value: string, lang: Lang): string {
  const trimmed = value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
  return digits(trimmed, lang);
}

export function money(amount: string, currency: string, lang: Lang): string {
  return currency === "BDT" ? `৳${decimal(amount, lang)}` : `${decimal(amount, lang)} ${currency}`;
}

const locale = (lang: Lang) => (lang === "bn" ? "bn-BD" : "en-GB");

/** Dates in Bangladesh time (the site's audience), in the page's language. */
export function date(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dhaka" }).format(new Date(iso));
}

export function dateTime(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Dhaka" }).format(new Date(iso));
}
