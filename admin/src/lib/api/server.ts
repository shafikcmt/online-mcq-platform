import "server-only";

import { cookies, headers } from "next/headers";

import { ApiError, networkError, timeoutError, toApiError } from "./errors";

/** Server-side reads (server components): call Django directly over the internal network
 * (API_ORIGIN, read at RUNTIME — not baked into the build) and forward the visitor's own
 * cookies, so the backend applies the same session/role checks. */
const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:8000";
const SERVER_TIMEOUT_MS = 15_000;

export async function serverFetch<T>(path: string): Promise<T> {
  const cookieHeader = (await cookies()).toString();
  const language = (await cookies()).get("admin_lang")?.value;
  const accept = language ?? (await headers()).get("accept-language") ?? "en";
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}/api/v1${path}`, {
      headers: { Accept: "application/json", Cookie: cookieHeader, "Accept-Language": accept },
      cache: "no-store",
      signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
    });
  } catch (error) {
    throw error instanceof DOMException && error.name === "TimeoutError" ? timeoutError() : networkError();
  }
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as T;
}

export { ApiError };

/** Read for a panel page: a lost or non-admin session goes to sign-in (decided here on the
 * server, because production hides server error messages from error boundaries). */
export async function adminRead<T>(path: string): Promise<T> {
  const { redirect } = await import("next/navigation");
  try {
    return await serverFetch<T>(path);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      redirect("/login?expired=1");
    }
    throw error;
  }
}
