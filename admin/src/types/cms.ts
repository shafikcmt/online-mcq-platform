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

/** Site settings (GET/PATCH /admin/settings/ — one row; environment defaults until saved). */
export type LanguageCode = "bn" | "en";
export type LeaderboardNameMode = "masked" | "initials" | "display_name" | "full_name";
export const LEADERBOARD_NAME_MODES: LeaderboardNameMode[] = ["masked", "initials", "display_name", "full_name"];

export type SiteSettings = {
  platform_name_bn: string;
  platform_name_en: string;
  tagline_bn: string;
  tagline_en: string;
  address_bn: string;
  address_en: string;
  contact_email: string;
  contact_phone: string;
  app_download_url: string;
  app_open_url: string;
  default_language: LanguageCode;
  public_leaderboard_name_mode: LeaderboardNameMode;
  app_leaderboard_name_mode: LeaderboardNameMode;
  /** null until the settings are saved for the first time. */
  updated_at: string | null;
};

/** Contact inbox (website contact form). What the admin needs to reply — never the IP. */
export type ContactStatus = "new" | "read" | "resolved";
export const CONTACT_STATUSES: ContactStatus[] = ["new", "read", "resolved"];

export type ContactMessage = {
  id: number;
  name: string;
  phone: string;
  email: string;
  subject: string;
  message: string;
  language: LanguageCode;
  status: ContactStatus;
  handled_by: { id: number; full_name: string } | null;
  created_at: string;
  updated_at: string;
};
