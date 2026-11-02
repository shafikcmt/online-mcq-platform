import type { TFunction } from "i18next";

import { isApiError } from "./errors";

/** One sentence for the student: the server's localized message when it sent one (it is
 * already in the UI language — `Accept-Language`), else a translated fallback by code.
 * Never a status code, stack trace or raw technical text. */
export function describeError(error: unknown, t: TFunction): string {
  if (!isApiError(error)) return t("common:errors.unknown");
  if (error.isNetwork) return t("common:errors.network");
  if (error.code === "session_expired") return t("common:errors.sessionExpired");
  if (error.code === "server_error") return t("common:errors.server");
  if (error.status === 429 && !error.message && error.retryAfter) {
    return t("common:errors.rateLimited", { seconds: error.retryAfter });
  }
  return error.message || t("common:errors.unknown");
}

/** First server message per field, for showing under the inputs. */
export function fieldErrors(error: unknown, fields: readonly string[]): Record<string, string> {
  if (!isApiError(error)) return {};
  const out: Record<string, string> = {};
  for (const field of fields) {
    const messages = error.fieldErrors[field];
    if (messages?.length) out[field] = messages[0];
  }
  return out;
}
