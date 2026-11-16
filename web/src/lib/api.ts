import "server-only";

import type { Lang } from "./i18n";

/** Public API reads, on the server only (`API_ORIGIN` is never sent to the browser).
 * Pages are regenerated at most every `REVALIDATE` seconds, so the site stays fast and the
 * backend sees few requests. A failed read returns `null` and the page shows that section's
 * fallback — the website never breaks because the API is briefly unavailable. */
export const REVALIDATE = 60;

const ORIGIN = (process.env.API_ORIGIN ?? "http://127.0.0.1:8000").replace(/\/$/, "");

export type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] };

/** `ok` with the data, `missing` for a 404 (the page shows "not found"), or
 * `unavailable` for anything else (network, 5xx…: the page says "try again later"). */
export type Fetched<T> = { state: "ok"; data: T } | { state: "missing" } | { state: "unavailable" };

export async function publicFetch<T>(path: string, lang: Lang): Promise<Fetched<T>> {
  try {
    const response = await fetch(`${ORIGIN}/api/v1/public/${path}`, {
      headers: { Accept: "application/json", "Accept-Language": lang },
      next: { revalidate: REVALIDATE },
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 404) return { state: "missing" };
    if (!response.ok) return { state: "unavailable" };
    return { state: "ok", data: (await response.json()) as T };
  } catch {
    return { state: "unavailable" };
  }
}

export async function publicGet<T>(path: string, lang: Lang): Promise<T | null> {
  const fetched = await publicFetch<T>(path, lang);
  return fetched.state === "ok" ? fetched.data : null;
}

export type Settings = {
  platform_name: string;
  tagline: string;
  address: string;
  contact_email: string;
  contact_phone: string;
  app_download_url: string;
  app_open_url: string;
  default_language: string;
};

export type Exam = {
  slug: string;
  title: string;
  description: string;
  instructions: string;
  exam_type: "practice" | "regular" | "live";
  access_type: "free" | "paid";
  content_language: "bn" | "en" | "both";
  category: { slug: string; name: string };
  subject: { slug: string; name: string } | null;
  duration_minutes: number;
  total_questions: number;
  total_marks: string;
  negative_marks: string;
  pass_marks: string | null;
  start_at: string | null;
  end_at: string | null;
  is_featured: boolean;
  /** The syllabus lines; only the exam's own page (not the list) carries them. */
  syllabus?: SyllabusLine[];
};

export type SyllabusLine = { subject: string; chapter: string; topic: string };

export type Package = {
  slug: string;
  name: string;
  description: string;
  features: string[];
  price: string;
  currency: string;
  validity_days: number;
  is_featured: boolean;
  /** What the package unlocks: every paid exam, or the listed categories (paid exams open now). */
  /** Absent from an API that has not been updated yet: treated as "unknown", never an error. */
  access?: PackageAccess;
};

export type PackageAccess = {
  scope: "all" | "selected";
  exam_count: number;
  categories: { slug: string; name: string; exam_count: number }[];
};

/** `live_count`: scheduled exams running right now (absent from an older server: treated as 0). */
export type Category = { slug: string; name: string; description: string; exam_count: number; live_count?: number; subjects: { slug: string; name: string; description: string }[] };

export type Notice = { id: number; pdf: { available: boolean; name: string; size_bytes: number }; title: string; body: string; is_pinned: boolean; published_at: string; expires_at: string | null };

export type Faq = { question: string; answer: string };

/** A simple CMS page (`about`, …): plain text written in the Admin Panel. */
export type CmsPage = { slug: string; title: string; body: string; updated_at: string };

/** An exam with a public merit list (`/public/leaderboards/`). */
export type LeaderboardExam = Exam & { ranked_count: number };

/** One merit-list row: the name is shortened by the platform's privacy setting
 * (masked by default); never a phone number or an email. */
export type LeaderboardRow = {
  position: number;
  name: string;
  obtained_marks: string;
  total_marks: string;
  percentage: string;
  time_used_seconds: number;
};

export const getSettings = (lang: Lang) => publicGet<Settings>("settings/", lang);
