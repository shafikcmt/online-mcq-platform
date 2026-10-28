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

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000; // UTC+6 all year (no daylight saving)

/** Day, short month and time in Bangladesh time: "27 Oct, 6:29 am" / "২৭ অক্টো, সকাল ৬:২৯". */
export function dateTime(iso: string, lang: Lang): string {
  const when = new Date(iso);
  if (lang !== "bn") {
    return new Intl.DateTimeFormat(locale(lang), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Dhaka" }).format(when);
  }
  const day = new Intl.DateTimeFormat(locale(lang), { day: "numeric", month: "short", timeZone: "Asia/Dhaka" }).format(when);
  const dhaka = new Date(when.getTime() + DHAKA_OFFSET_MS);
  const hours = dhaka.getUTCHours();
  const clock = `${hours % 12 || 12}:${String(dhaka.getUTCMinutes()).padStart(2, "0")}`;
  return `${day}, ${bnDayPeriod(hours)} ${digits(clock, lang)}`;
}

/** Seconds as a clock: "4:05", or "1:02:09" from an hour on, in the page's digits. */
export function clock(seconds: number, lang: Lang): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return digits(h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`, lang);
}
