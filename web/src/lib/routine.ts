import { bnDayPeriod, digits } from "./format";
import type { Lang } from "./i18n";

/** The exam routine: scheduled exams grouped by day (Bangladesh time, UTC+6, no daylight
 * saving: the site's audience). Pure functions, tested directly. */
export type RoutineExam = {
  slug: string;
  title: string;
  category: { slug: string; name: string };
  subject: { slug: string; name: string } | null;
  start_at: string | null;
  end_at: string | null;
  duration_minutes: number;
  total_questions: number;
  total_marks: string;
  exam_type: "practice" | "regular" | "live";
  access_type: "free" | "paid";
};

export type RoutineResponse = {
  pdf: { available: boolean; size_bytes: number; updated_at: string | null };
  exams: RoutineExam[];
};

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const dhaka = (iso: string) => new Date(new Date(iso).getTime() + DHAKA_OFFSET_MS);

/** `YYYY-MM-DD` of the day an instant falls on in Bangladesh. */
export function dayKey(iso: string): string {
  return dhaka(iso).toISOString().slice(0, 10);
}

export type RoutineDay = { key: string; exams: RoutineExam[] };

/** Exams that have a start time, grouped by Bangladesh day, days and exams in time order. */
export function groupByDay(exams: RoutineExam[]): RoutineDay[] {
  const days = new Map<string, RoutineExam[]>();
  for (const exam of [...exams].filter((row) => row.start_at).sort((a, b) => Date.parse(a.start_at!) - Date.parse(b.start_at!))) {
    const key = dayKey(exam.start_at!);
    days.set(key, [...(days.get(key) ?? []), exam]);
  }
  return [...days].map(([key, rows]) => ({ key, exams: rows }));
}

/** "Saturday, 14 November 2026" / "শনিবার, ১৪ নভেম্বর ২০২৬" for a `dayKey`. */
export function dayLabel(key: string, lang: Lang): string {
  const noonUtc = new Date(`${key}T12:00:00Z`); // noon: the day never shifts in any zone
  return new Intl.DateTimeFormat(lang === "bn" ? "bn-BD" : "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(noonUtc);
}

/** The clock time of an instant in Bangladesh: "6:30 pm" / "সন্ধ্যা ৬:৩০". */
export function clockTime(iso: string, lang: Lang): string {
  const local = dhaka(iso);
  const hours = local.getUTCHours();
  const minutes = String(local.getUTCMinutes()).padStart(2, "0");
  const clock = `${hours % 12 || 12}:${minutes}`;
  if (lang === "bn") return `${bnDayPeriod(hours)} ${digits(clock, lang)}`;
  return `${clock} ${hours < 12 ? "am" : "pm"}`;
}

/** "6:30 pm – 8:30 pm" (the end only when the exam has one). */
export function timeRange(exam: Pick<RoutineExam, "start_at" | "end_at">, lang: Lang): string {
  if (!exam.start_at) return "";
  const start = clockTime(exam.start_at, lang);
  return exam.end_at ? `${start} – ${clockTime(exam.end_at, lang)}` : start;
}

export type RoutineState = "live" | "upcoming";

export function routineState(exam: Pick<RoutineExam, "start_at">, now: number): RoutineState {
  return exam.start_at && Date.parse(exam.start_at) > now ? "upcoming" : "live";
}
