import "server-only";

import type { Lang } from "./i18n";

/** Public API reads, on the server only (`API_ORIGIN` is never sent to the browser).
 * Pages are regenerated at most every `REVALIDATE` seconds, so the site stays fast and the
 * backend sees few requests. A failed read returns `null` and the page shows that section's
 * fallback — the website never breaks because the API is briefly unavailable. */
export const REVALIDATE = 60;

const ORIGIN = (process.env.API_ORIGIN ?? "http://127.0.0.1:8000").replace(/\/$/, "");

export type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] };

export async function publicGet<T>(path: string, lang: Lang): Promise<T | null> {
  try {
    const response = await fetch(`${ORIGIN}/api/v1/public/${path}`, {
      headers: { Accept: "application/json", "Accept-Language": lang },
      next: { revalidate: REVALIDATE },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
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
};

export type Package = {
  slug: string;
  name: string;
  description: string;
  features: string[];
  price: string;
  currency: string;
  validity_days: number;
  is_featured: boolean;
};

export type Notice = { title: string; body: string; is_pinned: boolean; published_at: string; expires_at: string | null };

export type Faq = { question: string; answer: string };

export const getSettings = (lang: Lang) => publicGet<Settings>("settings/", lang);
