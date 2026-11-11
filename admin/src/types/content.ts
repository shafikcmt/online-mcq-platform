/** Content-management shapes, as returned by the backend admin serializers
 * (apps/catalog/api/serializers.py, apps/questions/api/serializers.py). */
export type Paginated<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

type CatalogEntry = {
  id: number;
  name_bn: string;
  name_en: string;
  slug: string;
  description_bn: string;
  description_en: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Category = CatalogEntry & { subject_count: number };
export type Subject = CatalogEntry & { category: number };

export type Difficulty = "easy" | "medium" | "hard";
export const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
export type ContentLanguage = "bn" | "en" | "both";
export const CONTENT_LANGUAGES: ContentLanguage[] = ["bn", "en", "both"];

export type QuestionOption = {
  id?: number;
  text_bn: string;
  text_en: string;
  is_correct: boolean;
  sort_order: number;
};

export type Question = {
  id: number;
  subject: number;
  category: number;
  text_bn: string;
  text_en: string;
  explanation_bn: string;
  explanation_en: string;
  /** Where the question sits in the syllabus (free text; may be empty). */
  chapter: string;
  topic: string;
  difficulty: Difficulty | "";
  is_active: boolean;
  available_languages: ContentLanguage;
  image: string | null;
  options: QuestionOption[];
  created_by: number | null;
  created_at: string;
  updated_at: string;
};
