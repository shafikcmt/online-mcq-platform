import { CONTENT_LANGUAGES, DIFFICULTIES } from "@/types/content";
import { ACCESS_TYPES, EXAM_STATUSES, EXAM_TYPES } from "@/types/exams";
import { ATTEMPT_STATUSES } from "@/types/attempts";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@/types/audit";
import { AUDIENCES, CONTACT_STATUSES } from "@/types/cms";
import { PACKAGE_STATUSES } from "@/types/packages";
import { PAYMENT_PROVIDERS, PAYMENT_STATUSES } from "@/types/payments";
import { EFFECTIVE_SUBSCRIPTION_STATUSES } from "@/types/subscriptions";
import { USER_ROLES } from "@/types/users";

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

/** Admin results: filters, search (student name) and orderings of GET /admin/results/.
 * The panel's default is newest first; ordering by merit position gives the merit view. */
export const RESULT_LIST: ListSpec = {
  filters: { exam: "id", user: "id", is_passed: "bool", merit_counted: "bool" },
  orderings: ["submitted_at", "percentage", "merit_position"],
  defaultOrdering: "-submitted_at",
};

/** Admin users (read-only): role and active filters, search (name, mobile, email) and
 * orderings of GET /admin/users/. */
export const USER_LIST: ListSpec = {
  filters: { role: USER_ROLES, is_active: "bool" },
  orderings: ["date_joined", "full_name"],
  defaultOrdering: "-date_joined",
};

/** Admin attempts (read-only monitoring): exam/student/status/overdue/result filters and
 * the orderings of GET /admin/attempts/. No free-text search: exams and students are
 * chosen with the bounded pickers. */
export const ATTEMPT_LIST: ListSpec = {
  filters: { exam: "id", user: "id", status: ATTEMPT_STATUSES, overdue: "bool", has_result: "bool" },
  orderings: ["started_at", "deadline_at", "submitted_at"],
  defaultOrdering: "-started_at",
};

/** Admin packages: status/featured filters, search (names, slug) and the orderings of
 * GET /admin/packages/. */
export const PACKAGE_LIST: ListSpec = {
  filters: { status: PACKAGE_STATUSES, is_featured: "bool" },
  orderings: ["sort_order", "price", "validity_days", "created_at", "updated_at"],
  defaultOrdering: "sort_order",
};

/** Admin subscriptions (read-only): student/package pickers and the server-computed
 * effective status. No free-text search. */
export const SUBSCRIPTION_LIST: ListSpec = {
  filters: { user: "id", package: "id", effective_status: EFFECTIVE_SUBSCRIPTION_STATUSES },
  orderings: ["created_at", "starts_at", "expires_at"],
  defaultOrdering: "-created_at",
};

/** Read-only payments (7H): exact reference/transaction-ID search; the UTC date filters
 * the API also accepts are not used by the panel yet. */
export const PAYMENT_LIST: ListSpec = {
  filters: {
    user: "id",
    package: "id",
    subscription: "id",
    gateway: "id",
    status: PAYMENT_STATUSES,
    provider: PAYMENT_PROVIDERS,
    mode: ["sandbox", "live"],
    channel: ["web", "app"],
  },
  orderings: ["created_at", "amount", "verified_at"],
  defaultOrdering: "-created_at",
};

/** CMS content (apps/cms/api/views.py): announcements newest first; FAQs by their sort
 * order; pages by slug. Search: titles / questions (pages: slug too). */
export const ANNOUNCEMENT_LIST: ListSpec = {
  filters: { audience: AUDIENCES, published: "bool", is_pinned: "bool" },
  orderings: ["id", "published_at", "expires_at", "created_at", "updated_at"],
  defaultOrdering: "-created_at",
};

/** Study materials (apps/materials/api/views.py): newest first by default order; filters by type,
 * category and whether published. Search: title or teacher. */
export const MATERIAL_LIST: ListSpec = {
  filters: { kind: ["video", "pdf"], category: "id", published: "bool" },
  orderings: ["id", "sort_order", "published_at", "created_at", "updated_at"],
  defaultOrdering: "sort_order",
};

/** Sample participants (apps/simulation/api/views.py): by name; search by name. */
export const SAMPLE_PERSON_LIST: ListSpec = {
  filters: { is_active: "bool" },
  orderings: ["id", "name", "created_at"],
  defaultOrdering: "name",
};

/** Push messages (apps/notifications/api/push_views.py): newest first; filter by kind and status. */
export const PUSH_LIST: ListSpec = {
  filters: { kind: ["manual", "exam_reminder"], status: ["pending", "sending", "sent", "failed", "disabled"] },
  orderings: ["id", "created_at", "sent_at"],
  defaultOrdering: "-created_at",
};

export const FAQ_LIST: ListSpec = {
  filters: { is_active: "bool" },
  orderings: ["id", "sort_order", "created_at", "updated_at"],
  defaultOrdering: "sort_order",
};

export const PAGE_LIST: ListSpec = {
  filters: { is_active: "bool" },
  orderings: ["id", "slug", "created_at", "updated_at"],
  defaultOrdering: "slug",
};

/** Contact inbox: status/language filters, search (name, e-mail, phone, subject). */
export const CONTACT_LIST: ListSpec = {
  filters: { status: CONTACT_STATUSES, language: ["bn", "en"] },
  orderings: ["id", "created_at", "updated_at", "status"],
  defaultOrdering: "-created_at",
};

/** Audit log (read-only, always newest first on the server): action, record type, record
 * id and actor filters. The API has no search or ordering parameters. */
export const AUDIT_LIST: ListSpec = {
  filters: { action: AUDIT_ACTIONS, entity_type: AUDIT_ENTITY_TYPES, entity_id: "id", actor: "id" },
  orderings: ["created_at"],
  defaultOrdering: "-created_at",
};
