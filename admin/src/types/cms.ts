/** Admin CMS content API (apps/cms/api/serializers.py: AnnouncementAdminSerializer,
 * FaqAdminSerializer, PageAdminSerializer). Bilingual pairs: a language counts only when
 * both of its fields are filled; at least one language is required (checked on the server). */
export type Audience = "public" | "students" | "all";
export const AUDIENCES: Audience[] = ["public", "students", "all"];
/** Computed by the server from `published_at` / `expires_at` at request time. */
export type AnnouncementState = "draft" | "scheduled" | "live" | "expired";

export type Announcement = {
  id: number;
  title_bn: string;
  title_en: string;
  body_bn: string;
  body_en: string;
  audience: Audience;
  is_pinned: boolean;
  /** null = draft (not published). */
  published_at: string | null;
  expires_at: string | null;
  state: AnnouncementState;
  created_at: string;
  updated_at: string;
};

export type Faq = {
  id: number;
  question_bn: string;
  question_en: string;
  answer_bn: string;
  answer_en: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

/** A static website page (about, terms…), shown at /pages/{slug} on the public website. */
export type CmsPage = {
  id: number;
  slug: string;
  title_bn: string;
  title_en: string;
  body_bn: string;
  body_en: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** Field limits (apps/cms/models.py). */
export const CMS_LIMITS = {
  title: 200,
  announcementBody: 5000,
  faqQuestion: 300,
  faqAnswer: 3000,
  pageBody: 20000,
  slug: 140,
} as const;
