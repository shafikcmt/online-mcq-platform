import type { Exam } from "./api";

/** The Exams page's filters live in the address (`/en/exams?when=upcoming&type=live`), so
 * a filtered list can be shared, bookmarked and indexed, and works without JavaScript.
 * Anything unknown in the address is dropped here, so the API never sees a bad value. */
export const WHENS = ["open", "upcoming", "ended"] as const;
export const TYPES = ["live", "regular", "practice"] as const;
export const ACCESSES = ["free", "paid"] as const;
export const PAGE_SIZE = 12;

export type When = (typeof WHENS)[number];
export type ExamFilters = {
  when: When;
  type?: (typeof TYPES)[number];
  access?: (typeof ACCESSES)[number];
  category?: string;
  page: number;
};

type Raw = Record<string, string | string[] | undefined>;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_PAGE = 1000;

function one(raw: Raw, name: string): string {
  const value = raw[name];
  return (Array.isArray(value) ? value[0] : value ?? "").trim().toLowerCase();
}

function pick<T extends string>(value: string, choices: readonly T[]): T | undefined {
  return (choices as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function parseFilters(raw: Raw): ExamFilters {
  const category = one(raw, "category");
  const page = Number(one(raw, "page"));
  return {
    when: pick(one(raw, "when"), WHENS) ?? "open",
    type: pick(one(raw, "type"), TYPES),
    access: pick(one(raw, "access"), ACCESSES),
    category: category.length <= 140 && SLUG.test(category) ? category : undefined,
    page: Number.isInteger(page) && page >= 1 && page <= MAX_PAGE ? page : 1,
  };
}

function params(filters: Partial<ExamFilters>, defaults: { when?: When }): URLSearchParams {
  const query = new URLSearchParams();
  if (filters.when && filters.when !== defaults.when) query.set("when", filters.when);
  if (filters.type) query.set("type", filters.type);
  if (filters.access) query.set("access", filters.access);
  if (filters.category) query.set("category", filters.category);
  if (filters.page && filters.page > 1) query.set("page", String(filters.page));
  return query;
}

/** The public API path for these filters. */
export function apiPath(filters: ExamFilters): string {
  const query = params(filters, {});
  query.set("page_size", String(PAGE_SIZE));
  return `exams/?${query}`;
}

/** The website address for these filters (`when=open` and page 1 are the defaults). */
export function pageHref(lang: string, filters: Partial<ExamFilters>): string {
  const query = params(filters, { when: "open" }).toString();
  return `/${lang}/exams${query ? `?${query}` : ""}`;
}

/** Where an exam's schedule stands at `now` (the same window the exam engine uses). */
export function scheduleState(exam: Pick<Exam, "start_at" | "end_at">, now: number): When {
  if (exam.end_at && Date.parse(exam.end_at) <= now) return "ended";
  if (exam.start_at && Date.parse(exam.start_at) > now) return "upcoming";
  return "open";
}
