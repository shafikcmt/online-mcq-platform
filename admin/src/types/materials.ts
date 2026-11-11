/** Study materials (apps/materials/api/serializers.py: MaterialAdminSerializer). */
export type MaterialKind = "video" | "pdf";
export const MATERIAL_KINDS: MaterialKind[] = ["video", "pdf"];
export type MaterialState = "draft" | "scheduled" | "live";

export type Material = {
  id: number;
  kind: MaterialKind;
  title_bn: string;
  title_en: string;
  description_bn: string;
  description_en: string;
  /** Only the 11-character ID is stored; the pasted link is write-only. */
  youtube_id: string;
  watch_url: string;
  pdf: { available: boolean; name: string; size_bytes: number };
  category: number | null;
  category_label: string;
  subject: number | null;
  subject_label: string;
  exam: number | null;
  exam_label: string;
  teacher: string;
  sort_order: number;
  published_at: string | null;
  state: MaterialState;
  created_at: string;
  updated_at: string;
};

export const MATERIAL_LIMITS = { title: 200, description: 2000, teacher: 100, link: 300 } as const;
