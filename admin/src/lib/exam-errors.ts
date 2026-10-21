import { ApiError, describeError } from "./api/errors";
import type { MessageKey } from "./i18n/messages";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** `409` codes of the exam lifecycle (apps/exams/services.py, results merit). Each gets a
 * translated title; the server's own (already localized) message explains the case. */
export const EXAM_CONFLICT_CODES = [
  "exam_locked",
  "already_published",
  "not_published",
  "not_archivable",
  "invalid_status",
  "exam_not_deletable",
  "exam_has_attempts",
  "in_use",
  "merit_disabled",
] as const;
type ConflictCode = (typeof EXAM_CONFLICT_CODES)[number];

export function isExamConflict(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 409;
}

/** Failure text for an exam action: a known conflict → its title + the server message;
 * 404 → not found; anything else → the generic description. */
export function describeExamError(error: unknown, t: T): { title?: string; message: string } {
  if (isExamConflict(error)) {
    const known = (EXAM_CONFLICT_CODES as readonly string[]).includes(error.code);
    return {
      title: known ? t(`examError.${error.code as ConflictCode}`) : t("exam.conflictTitle"),
      message: error.fromServer ? error.message : t("error.generic"),
    };
  }
  if (error instanceof ApiError && error.status === 404) return { message: t("error.notFound") };
  return { message: describeError(error, t) };
}
