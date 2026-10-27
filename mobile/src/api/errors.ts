/** The backend's standard error shape (docs/API_PLAN.md §1.1), plus two client-side codes:
 * `network_error` (no answer: offline, DNS, timeout) and `server_error` (5xx or not JSON). */
export type FieldErrors = Record<string, string[]>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly fieldErrors: FieldErrors;
  readonly retryAfter: number | null;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
    fieldErrors?: FieldErrors;
    retryAfter?: number | null;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? {};
    this.fieldErrors = init.fieldErrors ?? {};
    this.retryAfter = init.retryAfter ?? null;
  }

  get isNetwork(): boolean {
    return this.code === "network_error";
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Build an ApiError from a non-2xx response body (whatever it contains). */
export function errorFromResponse(status: number, body: unknown, retryAfterHeader: string | null): ApiError {
  const error = (body as { error?: Record<string, unknown> } | null)?.error;
  const header = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  const details = (error?.details as Record<string, unknown> | undefined) ?? {};
  const fromDetails = typeof details.retry_after === "number" ? details.retry_after : null;
  if (status >= 500 || !error || typeof error.code !== "string") {
    return new ApiError({ status, code: status >= 500 ? "server_error" : "unknown_error", message: "" });
  }
  return new ApiError({
    status,
    code: error.code,
    message: typeof error.message === "string" ? error.message : "",
    details,
    fieldErrors: (error.field_errors as FieldErrors | undefined) ?? {},
    retryAfter: Number.isFinite(header) ? header : fromDetails,
  });
}
