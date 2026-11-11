import { API_BASE_URL, api } from "@/api/client";
import type { Page } from "@/lib/use-pages";

import type { Material } from "./types";

export type MaterialKind = "all" | "video" | "pdf";

/** `exam` (an exam slug) limits the list to the materials of one exam. */
export function fetchMaterials(kind: MaterialKind, page: number, exam = "") {
  const query = `page=${page}&page_size=20${kind === "all" ? "" : `&kind=${kind}`}${exam ? `&exam=${encodeURIComponent(exam)}` : ""}`;
  return api<Page<Material>>(`/public/materials/?${query}`, { auth: false });
}

/** Where a PDF material is served (the API itself; never a file path). */
export const materialPdfUrl = (id: number) => `${API_BASE_URL}/public/materials/${id}/pdf/`;

/** A video opens in the YouTube app or the browser (no embedded player: it keeps the app small).
 * Built only from an 11-character ID, which the server already restricts. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
export const youtubeWatchUrl = (id: string) => (YOUTUBE_ID.test(id) ? `https://www.youtube.com/watch?v=${id}` : null);

/** How many materials belong to an exam (one tiny request; 0 when none or when it cannot be loaded). */
export async function examMaterialCount(exam: string): Promise<number> {
  const page = await api<Page<Material>>(`/public/materials/?page_size=1&exam=${encodeURIComponent(exam)}`, { auth: false });
  return page.count;
}
