import { CONTENT_LANGUAGES, DIFFICULTIES } from "@/types/content";
import { ACCESS_TYPES, EXAM_STATUSES, EXAM_TYPES } from "@/types/exams";

import type { ListSpec } from "./list-params";

/** URL/query contracts of the list screens — the filters and ordering fields each admin
 * endpoint accepts (apps/catalog/api/views.py, apps/questions/api/views.py,
 * apps/exams/api/views.py). */
const CATALOG_ORDERINGS = ["id", "sort_order", "name_bn", "name_en", "created_at", "updated_at"] as const;

export const CATEGORY_LIST: ListSpec = {
  filters: { is_active: "bool" },
  orderings: CATALOG_ORDERINGS,
  defaultOrdering: "sort_order",
};

export const SUBJECT_LIST: ListSpec = {
  filters: { is_active: "bool", category: "id" },
  orderings: CATALOG_ORDERINGS,
  defaultOrdering: "sort_order",
};

export const QUESTION_LIST: ListSpec = {
  filters: {
    category: "id",
    subject: "id",
    difficulty: DIFFICULTIES,
    language: CONTENT_LANGUAGES,
    is_active: "bool",
  },
  orderings: ["id", "created_at", "updated_at", "difficulty"],
  defaultOrdering: "-created_at",
};

export const EXAM_LIST: ListSpec = {
  filters: {
    status: EXAM_STATUSES,
    exam_type: EXAM_TYPES,
    content_language: CONTENT_LANGUAGES,
    access_type: ACCESS_TYPES,
    category: "id",
    subject: "id",
    is_featured: "bool",
    upcoming: "bool",
  },
  orderings: ["id", "created_at", "updated_at", "start_at"],
  defaultOrdering: "-created_at",
};
