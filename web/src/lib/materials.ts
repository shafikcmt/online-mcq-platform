import type { Page } from "./api";

/** A published study material (`GET /api/v1/public/materials/`). Videos carry only the YouTube ID;
 * PDFs are opened through the API address (never a file path). */
export type Material = {
  id: number;
  kind: "video" | "pdf";
  title: string;
  description: string;
  teacher: string;
  youtube_id: string;
  pdf: { available: boolean; name: string; size_bytes: number };
  category: { slug: string; name: string } | null;
  subject: { slug: string; name: string } | null;
  exam: { slug: string; name: string } | null;
  published_at: string;
};

export type MaterialPage = Page<Material>;
export const PAGE_SIZE = 12;
export const KINDS = ["video", "pdf"] as const;

export type MaterialFilters = { kind: "" | (typeof KINDS)[number]; category: string; page: number };

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** Untrusted address values → valid filters (unknown values are dropped, never sent on). */
export function parseMaterialFilters(raw: Record<string, string | string[] | undefined>): MaterialFilters {
  const one = (name: string) => {
    const value = raw[name];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const kind = (KINDS as readonly string[]).includes(one("kind")) ? (one("kind") as MaterialFilters["kind"]) : "";
  const category = SLUG.test(one("category")) ? one("category") : "";
  const page = /^\d{1,4}$/.test(one("page")) ? Math.max(1, Number(one("page"))) : 1;
  return { kind, category, page };
}

export function apiPath(filters: MaterialFilters): string {
  const query = new URLSearchParams({ page: String(filters.page), page_size: String(PAGE_SIZE) });
  if (filters.kind) query.set("kind", filters.kind);
  if (filters.category) query.set("category", filters.category);
  return `materials/?${query.toString()}`;
}

export function materialsHref(lang: string, filters: Partial<MaterialFilters>): string {
  const query = new URLSearchParams();
  if (filters.kind) query.set("kind", filters.kind);
  if (filters.category) query.set("category", filters.category);
  if (filters.page && filters.page > 1) query.set("page", String(filters.page));
  const text = query.toString();
  return `/${lang}/materials${text ? `?${text}` : ""}`;
}

/** The only addresses ever built from a stored ID (which the server already restricts to 11 safe characters). */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
export const isYoutubeId = (value: string) => YOUTUBE_ID.test(value);
export const embedUrl = (id: string) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
export const thumbnailUrl = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
