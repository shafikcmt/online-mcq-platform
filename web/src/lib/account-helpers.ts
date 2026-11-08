import type { Lang } from "./i18n";

/** Pure helpers for the student sign-in / checkout pages (no Next.js APIs, so they are
 * unit-tested directly). The server-only parts live in `account.ts`. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A payment id from a link. It is only used to ask the server about the signed-in
 * student's OWN payment; the server decides what, if anything, is shown. */
export function isPaymentId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** The "go back to" path of a sign-in link. Only a path inside this site, under the
 * visitor's language, is accepted; anything else (another site, a protocol-relative
 * `//host`, a backslash, control characters, `..` segments) becomes `fallback`. */
export function safeNext(value: unknown, lang: Lang, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const path = value.trim();
  if (path !== `/${lang}` && !path.startsWith(`/${lang}/`)) return fallback;
  if (path.includes("//") || path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) return fallback;
  // "." / ".." segments (also percent-encoded) would climb out of the language folder.
  if (/(^|\/)(\.|%2e){1,2}(\/|$)/i.test(path.split(/[?#]/, 1)[0])) return fallback;
  return path;
}

/** Only an https page of the payment provider may be opened from the checkout button.
 * `allowLocalHttp` (development builds only) also accepts plain http on this computer
 * (localhost / 127.0.0.1), where the mock provider's page is served. */
export function isHttpsUrl(value: unknown, allowLocalHttp = false): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    return allowLocalHttp && url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

/** How long the access token is valid for (seconds), read from its `exp` claim (the
 * signature is NOT checked here — the API checks it on every call; this only sets the
 * cookie's lifetime so the cookie never outlives the token). 0 = already expired. */
export const MAX_SESSION_SECONDS = 60 * 60;
const FALLBACK_SESSION_SECONDS = 10 * 60;

export function sessionSeconds(token: string, nowMs: number = Date.now()): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: unknown };
    if (typeof payload.exp === "number") {
      const left = Math.floor(payload.exp - nowMs / 1000) - 10; // a little margin
      return Math.max(0, Math.min(left, MAX_SESSION_SECONDS));
    }
  } catch {
    // fall through to the default
  }
  return FALLBACK_SESSION_SECONDS;
}

/** The visitor's address as seen by the website's own nginx: the LAST entry of
 * `X-Forwarded-For` (nginx appends the address it saw; anything before it is client-supplied). */
export function clientIp(headers: { get(name: string): string | null }): string {
  const parts = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return (parts[parts.length - 1] ?? "unknown").slice(0, 64);
}

/** A small in-memory sliding-window limiter. It protects the shared Django per-IP sign-in
 * budget from one visitor (every website sign-in reaches Django from the website's own
 * address, so Django's per-IP limit is shared by all visitors). Best effort: it lives in
 * one server process; Django's own limits remain the real protection. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, nowMs: number = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((time) => nowMs - time < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(nowMs);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) this.prune(nowMs);
    return true;
  }

  private prune(nowMs: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((time) => nowMs - time >= this.windowMs)) this.hits.delete(key);
    }
  }
}

/** What went wrong, as a translation key of the page (`account.login.<kind>`). */
export type LoginFailure = "check" | "invalid" | "tooMany" | "unavailable";

export function loginFailure(status: number): LoginFailure {
  if (status === 401) return "invalid";
  if (status === 429) return "tooMany";
  if (status === 400) return "check";
  return "unavailable";
}

/** `web-<time>-<random>`: 1–64 characters from the set the API's Idempotency-Key accepts. */
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,64}$/;

export function newIdempotencyKey(randomHex: string, nowMs: number = Date.now()): string {
  return `web-${nowMs.toString(36)}-${randomHex}`.slice(0, 64);
}

/** A payment method code from a form (`bkash`, `sslcommerz`…): lowercase letters, digits and
 * underscore only. The server decides which codes are offered; this only keeps junk out. */
export function methodCode(value: unknown): string {
  return typeof value === "string" && /^[a-z0-9_]{1,20}$/.test(value) ? value : "";
}

/** A gateway identifier from a form (`bkash-main`): 2–40 lowercase letters, digits, hyphens. */
export function gatewayCode(value: unknown): string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{1,39}$/.test(value) ? value : "";
}

type Limits = { min_amount: string | null; max_amount: string | null };

/** The methods whose amount limits fit a package price. The server applies the same limits
 * when the payment starts; this only hides methods that would be refused. */
export function methodsForPrice<T extends Limits>(methods: T[], price: string): T[] {
  const amount = Number(price);
  if (!Number.isFinite(amount)) return methods;
  return methods.filter(
    (method) => (method.min_amount === null || amount >= Number(method.min_amount)) && (method.max_amount === null || amount <= Number(method.max_amount)),
  );
}
