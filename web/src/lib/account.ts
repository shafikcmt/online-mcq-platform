import "server-only";

import { cookies } from "next/headers";

import { sessionSeconds } from "./account-helpers";
import type { Lang } from "./i18n";

/** Student sign-in and checkout, on the server only.
 *
 * The website never talks to the student API from the browser: Server Actions and pages
 * call it from here with the student's access token, which lives ONLY in an HttpOnly,
 * Secure, SameSite=Lax cookie (never in page JavaScript, a URL or local storage). There is
 * no long-lived refresh token on the website: the access token lasts a few minutes
 * (JWT_ACCESS_TOKEN_LIFETIME_SECONDS), which is enough to pick a package and pay; after
 * that the student signs in again.
 *
 * `ACCOUNT_API_ORIGIN` is the host that serves the whole `/api/v1/` (the admin host in
 * production: the website's own host serves only `/api/v1/public/`). */
const ORIGIN = (process.env.ACCOUNT_API_ORIGIN ?? process.env.API_ORIGIN ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const TIMEOUT_MS = 10_000;

export const SESSION_COOKIE = "lmt_session";

export type Failure = { ok: false; status: number; code: string };
export type Result<T> = { ok: true; data: T } | Failure;

export type StudentPackage = {
  id: number;
  slug: string;
  name: string;
  description: string;
  features: string[];
  price: string;
  currency: string;
  validity_days: number;
  is_featured: boolean;
  subscription: { active_now: boolean; expires_at: string } | null;
};

export type PaymentStatus = "pending" | "success" | "failed" | "cancelled";

export type Payment = {
  payment_id: string;
  status: PaymentStatus;
  is_test?: boolean;
  package: { slug: string; name: string };
  checkout_url: string | null;
};

type Page<T> = { count: number; results: T[] };
/** `GET /payments/methods/`: one way to pay. `gateway` (the merchant account's identifier) is what
 * is sent back when buying; `provider` is the adapter (bkash, sslcommerz…). `is_test` marks a
 * sandbox gateway shown to a designated tester. */
export type PaymentMethod = {
  provider: string;
  gateway: string;
  label: string;
  name: string;
  description: string;
  logo_url: string;
  min_amount: string | null;
  max_amount: string | null;
  is_test: boolean;
};
type Tokens = { access: string };

async function call<T>(
  path: string,
  { method = "GET", token, body, lang, headers }: { method?: "GET" | "POST"; token?: string; body?: unknown; lang: Lang; headers?: Record<string, string> },
): Promise<Result<T>> {
  try {
    const response = await fetch(`${ORIGIN}/api/v1${path}`, {
      method,
      cache: "no-store",
      redirect: "manual",
      headers: {
        Accept: "application/json",
        "Accept-Language": lang,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, status: response.status, code: await errorCode(response) };
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false, status: 0, code: "network_error" };
  }
}

/** The API's stable error code (`{"error": {"code": ...}}`); its message is never shown. */
async function errorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } };
    if (typeof body.error?.code === "string" && body.error.code) return body.error.code;
  } catch {
    // not JSON (a proxy error page): use the status
  }
  return `http_${response.status}`;
}

// --------------------------------------------------------------------------------------
// Session cookie
// --------------------------------------------------------------------------------------
export async function getToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value || null;
}

/** Keeps the access token in the cookie for as long as the token is valid. */
export async function setSession(accessToken: string): Promise<boolean> {
  const maxAge = sessionSeconds(accessToken);
  if (maxAge <= 0) return false;
  const store = await cookies();
  store.set(SESSION_COOKIE, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // sent when the payment provider sends the student back to the site
    path: "/",
    maxAge,
  });
  return true;
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

// --------------------------------------------------------------------------------------
// API
// --------------------------------------------------------------------------------------
export function login(mobileNumber: string, password: string, lang: Lang) {
  return call<Tokens>("/auth/login/", { method: "POST", body: { mobile_number: mobileNumber, password }, lang });
}

/** Packages with the `id` to buy with and the student's own subscription to each. */
export function listPackages(token: string, lang: Lang) {
  return call<Page<StudentPackage>>("/packages/?page_size=50", { token, lang });
}

/** The payment methods the student can choose from now (empty while payments are off). */
export function listMethods(token: string, lang: Lang) {
  // The website's own list: gateways switched off for the website are not returned.
  return call<{ results: PaymentMethod[] }>("/payments/methods/?channel=web", { token, lang });
}

/** Starts buying a package: only the package (and, if the student chose one, the payment
 * method) is sent; the price comes from the server. The same Idempotency-Key returns the same
 * payment, so a double click cannot pay twice. */
export function startPayment(token: string, packageId: number, idempotencyKey: string, lang: Lang, choice: { gateway?: string; provider?: string } = {}) {
  // `channel: "web"` selects the website's availability and return page on the server.
  const body: Record<string, unknown> = { package_id: packageId, channel: "web" };
  if (choice.gateway) body.gateway = choice.gateway;
  else if (choice.provider) body.provider = choice.provider;
  return call<Payment>("/payments/", {
    method: "POST",
    token,
    body,
    headers: { "Idempotency-Key": idempotencyKey },
    lang,
  });
}

/** The payment as the server knows it: the only source of "paid". */
export function getPayment(token: string, paymentId: string, lang: Lang) {
  return call<Payment>(`/payments/${encodeURIComponent(paymentId)}/`, { token, lang });
}
