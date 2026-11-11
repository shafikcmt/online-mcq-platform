/** `GET /public/materials/` (no login): published study materials, text already in the request
 * language. Videos carry only the YouTube ID; PDFs open through the API address. */
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
