"use client";

/** Browser-side API calls through the same-origin /api proxy.
 * The session cookie is httpOnly (never readable here); unsafe methods send the CSRF token
 * from the `csrftoken` cookie in `X-CSRFToken`. Nothing is kept in localStorage. */
import { SESSION_EXPIRED_EVENT, isAuthEndpoint } from "../session";

import { ApiError, networkError, timeoutError, toApiError } from "./errors";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
export const REQUEST_TIMEOUT_MS = 20_000;

function readCookie(name: string): string | null {
  const match = document.cookie.split("; ").find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export async function ensureCsrfToken(): Promise<string> {
  const existing = readCookie("csrftoken");
  if (existing) return existing;
  await fetch("/api/v1/admin/auth/csrf/", { credentials: "same-origin" });
  return readCookie("csrftoken") ?? "";
}

type Options = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  retried?: boolean;
  /** Extra request headers (e.g. `Idempotency-Key`); they never replace the panel's own. */
  headers?: Record<string, string>;
};

/** A successful response with its status and headers (e.g. 201 vs 200, replay markers). */
export type ApiResponse<T> = { data: T; status: number; headers: Headers };

export async function apiFetch<T>(path: string, options: Options = {}): Promise<T> {
  return (await apiRequest<T>(path, options)).data;
}

export async function apiRequest<T>(path: string, options: Options = {}): Promise<ApiResponse<T>> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {
    ...options.headers,
    Accept: "application/json",
    // The backend localizes its messages from this (the panel's current UI language).
    "Accept-Language": document.documentElement.lang || "en",
  };
  // FormData (file uploads): the browser sets the multipart boundary itself.
  const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
  if (options.body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  if (!SAFE.has(method)) headers["X-CSRFToken"] = await ensureCsrfToken();

  const timeout = AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: "same-origin",
      body: options.body === undefined ? undefined : isForm ? (options.body as FormData) : JSON.stringify(options.body),
      signal,
    });
  } catch (error) {
    if (timeout.aborted) throw timeoutError();
    if (options.signal?.aborted) throw error; // the caller cancelled
    throw networkError();
  }
  if (response.ok) {
    const data = (response.status === 204 ? undefined : await response.json()) as T;
    return { data, status: response.status, headers: response.headers };
  }
  const error = await toApiError(response);
  // A stale CSRF token (e.g. rotated at sign-in): refresh it once and retry.
  if (error.status === 403 && !SAFE.has(method) && !options.retried && /csrf/i.test(error.message)) {
    document.cookie = "csrftoken=; Max-Age=0; path=/";
    return apiRequest<T>(path, { ...options, retried: true });
  }
  // The admin session ended (expired, signed out elsewhere): tell the panel shell, which
  // offers sign-in. The caller still gets the error and keeps its form state.
  if (error.status === 401 && !isAuthEndpoint(path)) {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  }
  throw error;
}

export { ApiError };
