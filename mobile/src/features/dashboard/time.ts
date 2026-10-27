import type { TFunction } from "i18next";

import { formatDateTime } from "@/lib/format";
import { localizeDigits } from "@/lib/text";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "2 h 15 min" / "45 min" for gaps under a day; null for a day or more (then a date is
 * clearer than a count) or for a time already passed. */
export function shortGap(targetMs: number, nowMs: number, t: TFunction, language: string): string | null {
  const gap = targetMs - nowMs;
  if (gap <= 0 || gap >= DAY) return null;
  const minutes = Math.max(1, Math.ceil(gap / MINUTE));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const n = (value: number) => localizeDigits(value, language);
  if (hours === 0) return t("home:time.minutes", { m: n(rest) });
  if (rest === 0) return t("home:time.hours", { h: n(hours) });
  return t("home:time.hoursMinutes", { h: n(hours), m: n(rest) });
}

/** "Starts in 3 h" or "Starts 30 Oct, 9:00 am" (and the same for ends). */
export function relativeOrDate(kind: "starts" | "ends", iso: string, nowMs: number, t: TFunction, language: string): string {
  const gap = shortGap(Date.parse(iso), nowMs, t, language);
  if (gap) return t(`home:time.${kind}In`, { gap });
  return t(`home:time.${kind}At`, { date: formatDateTime(iso, language) });
}
