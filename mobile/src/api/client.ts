import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from "@/auth/token-store";

import { ApiError, errorFromResponse } from "./errors";

/** One small fetch wrapper for the whole app:
 * - base URL from `EXPO_PUBLIC_API_URL` (public build-time config, see `.env.example`);
 * - `Accept-Language` = the UI language on every request (server messages come back in it);
 * - `Authorization: Bearer <access>` on authenticated calls;
 * - on `401` an authenticated call refreshes the token pair ONCE (all concurrent callers
 *   share one refresh — rotation blacklists the old refresh token, so two parallel
 *   refreshes would sign the user out) and retries; if the refresh itself is refused the
 *   tokens are cleared and the session-expired listener runs (the app shows sign-in);
 * - errors become `ApiError` (`network_error` when there is no answer). */
const BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8000/api/v1").replace(/\/+$/, "");
const TIMEOUT_MS = 20_000;

let language = "bn";
let onSessionExpired: (() => void) | null = null;
let refreshing: Promise<boolean> | null = null;

export function setApiLanguage(next: string): void {
  language = next;
}

export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Send the access token (default true). Public/auth endpoints pass false. */
  auth?: boolean;
  headers?: Record<string, string>;
};

async function send(path: string, options: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json", "Accept-Language": language, ...options.headers };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError({ status: 0, code: "network_error", message: "" });
  } finally {
    clearTimeout(timer);
  }
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) throw errorFromResponse(response.status, body, response.headers.get("Retry-After"));
  return body as T;
}

/** Exchange the stored refresh token for a new pair. False = the session is over. Network
 * failures throw (the session may still be fine — the caller shows "offline"). */
export function refreshTokens(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const refresh = await getRefreshToken();
      if (!refresh) return false;
      const response = await send("/auth/token/refresh/", { method: "POST", body: { refresh }, auth: false }, null);
      if (response.status === 401 || response.status === 400) {
        await clearTokens();
        return false;
      }
      await saveTokens(await parse<{ access: string; refresh: string }>(response));
      return true;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const auth = options.auth ?? true;
  let response = await send(path, options, auth ? getAccessToken() : null);
  if (auth && response.status === 401) {
    if (await refreshTokens()) response = await send(path, options, getAccessToken());
    else {
      onSessionExpired?.();
      throw new ApiError({ status: 401, code: "session_expired", message: "" });
    }
    if (response.status === 401) {
      await clearTokens();
      onSessionExpired?.();
    }
  }
  return parse<T>(response);
}
