import { ApiError, describeError } from "./api/errors";
import type { MessageKey } from "./i18n/messages";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Failure text for a delete: `409 in_use` explains why (the server's own, localized,
 * message names what still uses it); `404` means someone else already deleted it. */
export function describeDeleteError(error: unknown, t: T): { title?: string; message: string } {
  if (error instanceof ApiError && error.status === 409) {
    return { title: t("error.inUseTitle"), message: error.fromServer ? error.message : t("error.generic") };
  }
  if (error instanceof ApiError && error.status === 404) return { message: t("error.notFound") };
  return { message: describeError(error, t) };
}

export function isQuestionLocked(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === "question_locked";
}
