import { bnDayPeriod } from "@/lib/format";
import { localizeDigits } from "@/lib/text";

import type { RoutineExam } from "./types";

/** The routine grouped by day in Bangladesh time (UTC+6, no daylight saving: the audience),
 * whatever the phone's own time zone is. Pure functions, tested directly. */
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const dhaka = (iso: string) => new Date(new Date(iso).getTime() + DHAKA_OFFSET_MS);

/** `YYYY-MM-DD` of the day an instant falls on in Bangladesh. */
export function dayKey(iso: string): string {
  return dhaka(iso).toISOString().slice(0, 10);
}

export type RoutineDay = { key: string; exams: RoutineExam[] };

export function groupByDay(exams: RoutineExam[]): RoutineDay[] {
  const days = new Map<string, RoutineExam[]>();
  const scheduled = exams.filter((row) => row.start_at).sort((a, b) => Date.parse(a.start_at as string) - Date.parse(b.start_at as string));
  for (const exam of scheduled) {
    const key = dayKey(exam.start_at as string);
    days.set(key, [...(days.get(key) ?? []), exam]);
  }
  return [...days].map(([key, rows]) => ({ key, exams: rows }));
}

/** "Saturday, 14 November 2026" / "শনিবার, ১৪ নভেম্বর ২০২৬" for a day key. */
export function dayLabel(key: string, language: string): string {
  const noonUtc = new Date(`${key}T12:00:00Z`);
  const options: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" };
  try {
    return new Intl.DateTimeFormat(language === "bn" ? "bn-BD" : "en-GB", options).format(noonUtc);
  } catch {
    return key;
  }
}

/** "6:30 pm" / "সন্ধ্যা ৬:৩০" in Bangladesh time. */
export function clockTime(iso: string, language: string): string {
  const local = dhaka(iso);
  const hours = local.getUTCHours();
  const clock = `${hours % 12 || 12}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
  if (language === "bn") return `${bnDayPeriod(hours)} ${localizeDigits(clock, "bn")}`;
  return `${clock} ${hours < 12 ? "am" : "pm"}`;
}

/** "15 November" / "১৫ নভেম্বর" for a day key. */
export function shortDay(key: string, language: string): string {
  try {
    return new Intl.DateTimeFormat(language === "bn" ? "bn-BD" : "en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));
  } catch {
    return key;
  }
}

/** An end on a later day carries its date ("2:13 pm – 16 November, 2:13 pm"), so a window of a
 * day or more is not read as zero minutes. */
export function timeRange(exam: Pick<RoutineExam, "start_at" | "end_at">, language: string): string {
  if (!exam.start_at) return "";
  const start = clockTime(exam.start_at, language);
  if (!exam.end_at) return start;
  const end = clockTime(exam.end_at, language);
  const endDay = dayKey(exam.end_at);
  return endDay === dayKey(exam.start_at) ? `${start} – ${end}` : `${start} – ${shortDay(endDay, language)}, ${end}`;
}

export const isLive = (exam: Pick<RoutineExam, "start_at">, now: number): boolean => !exam.start_at || Date.parse(exam.start_at) <= now;
