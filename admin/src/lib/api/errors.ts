/** The backend's standard error shape (docs/API_PLAN.md §1.1), parsed safely.
 * Anything that is not that shape (an HTML error page from a proxy, an empty body, a dropped
 * connection, a timeout) becomes a generic error with a stable `code`; its raw text is never
 * shown. The UI turns codes into translated text with `describeError`. */
export type FieldErrors = Record<string, string[]>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: FieldErrors;
  /** true when `message` is the backend's own (already localized) message. */
  readonly fromServer: boolean;

  constructor(status: number, code: string, message: string, fieldErrors: FieldErrors = {}, fromServer = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.fromServer = fromServer;
  }

  get isUnauthenticated() {
    return this.status === 401;
  }
  get isForbidden() {
    return this.status === 403;
  }
  get isNetwork() {
    return this.code === "network_error" || this.code === "timeout";
  }
}

const GENERIC = "Something went wrong. Please try again.";

export async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  if ((response.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  }
  const error =
    body && typeof body === "object" && "error" in body
      ? (body as { error: Record<string, unknown> }).error
      : null;
  if (!error) {
    // HTML/plain-text error page or empty body: never surface its content.
    const code = response.status >= 500 ? "server_error" : `http_${response.status}`;
    return new ApiError(response.status, code, GENERIC);
  }
  const code = typeof error.code === "string" && error.code ? error.code : `http_${response.status}`;
  const message = typeof error.message === "string" && error.message ? error.message : GENERIC;
  const fieldErrors =
    error.field_errors && typeof error.field_errors === "object" ? (error.field_errors as FieldErrors) : {};
  return new ApiError(response.status, code, message, fieldErrors, typeof error.message === "string" && !!error.message);
}

export function networkError(): ApiError {
  return new ApiError(0, "network_error", "Can't reach the server.");
}

export function timeoutError(): ApiError {
  return new ApiError(0, "timeout", "The server took too long to respond.");
}

const SESSION_CODES = new Set(["not_authenticated", "authentication_failed"]);

/** Translated, user-safe text for any error (the caller passes its `t`). */
export function describeError(error: unknown, t: (key: "error.network" | "error.timeout" | "error.server" | "error.unauthenticated" | "error.forbidden" | "error.rateLimited" | "error.generic") => string): string {
  if (!(error instanceof ApiError)) return t("error.generic");
  if (error.code === "network_error") return t("error.network");
  if (error.code === "timeout") return t("error.timeout");
  // A lost session reads the same everywhere (DRF's own wording is technical); a wrong
  // password at sign-in (401 invalid_credentials) keeps the server's message.
  if (error.status === 401 && SESSION_CODES.has(error.code)) return t("error.unauthenticated");
  if (error.fromServer) return error.message; // the backend localizes its own messages
  if (error.status === 401) return t("error.unauthenticated");
  if (error.status === 403) return t("error.forbidden");
  if (error.status === 429) return t("error.rateLimited");
  if (error.status >= 500) return t("error.server");
  return t("error.generic");
}
