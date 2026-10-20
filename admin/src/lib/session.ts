/** Sign-in redirects, shared by the server (panel layout, `adminRead`), the route error
 * boundary and the client (`apiFetch` → session-expired dialog). One flow: a lost admin
 * session always ends at `/login?expired=1[&next=…]`, and sign-in returns to `next`. */

export const DEFAULT_AFTER_LOGIN = "/dashboard";

/** Fired on `window` by `apiFetch` when an admin API call answers 401 (session expired or
 * missing). Not fired for the sign-in endpoints themselves (wrong password is also 401). */
export const SESSION_EXPIRED_EVENT = "admin:session-expired";

/** A same-origin path to return to after sign-in, or the dashboard. Rejects absolute and
 * protocol-relative URLs (`//host`, `/\host` — browsers treat `\` like `/`), control
 * characters, and the sign-in page itself (no redirect loops). */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || raw.length > 2048) return DEFAULT_AFTER_LOGIN;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return DEFAULT_AFTER_LOGIN;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return DEFAULT_AFTER_LOGIN;
  const path = raw.split(/[?#]/)[0];
  if (path === "/login" || path.startsWith("/login/")) return DEFAULT_AFTER_LOGIN;
  return raw;
}

/** `/login?expired=1&next=<current page>` (the `next` part only when it is worth keeping). */
export function expiredLoginPath(current?: string | null): string {
  const next = safeNextPath(current);
  if (next === DEFAULT_AFTER_LOGIN || next === "/") return "/login?expired=1";
  return `/login?expired=1&next=${encodeURIComponent(next)}`;
}

/** API paths whose 401 means "wrong credentials", not "session ended". */
export function isAuthEndpoint(path: string): boolean {
  return path.startsWith("/admin/auth/");
}

/** Full page navigation (a separate function so tests can observe it). */
export function navigateTo(url: string): void {
  window.location.assign(url);
}
