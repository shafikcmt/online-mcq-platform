"use server";

import { randomBytes } from "node:crypto";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { IDEMPOTENCY_KEY, RateLimiter, clientIp, isHttpsUrl, loginFailure, methodCode, newIdempotencyKey, safeNext, type LoginFailure } from "@/lib/account-helpers";
import { clearSession, getToken, login, setSession, startPayment } from "@/lib/account";
import { DEFAULT_LANG, isLang, type Lang } from "@/lib/i18n";

export type LoginState = { error: LoginFailure | null };

// Every website sign-in reaches Django from the website's own address, so Django's per-IP
// budget is shared by all visitors; this keeps one visitor from spending all of it.
const loginLimiter = new RateLimiter(20, 10 * 60_000);

const MAX_FIELD = 256;

function langOf(formData: FormData): Lang {
  const value = formData.get("lang");
  return isLang(value) ? value : DEFAULT_LANG;
}

const loginPath = (lang: Lang, next: string, extra = "") => `/${lang}/account/login?next=${encodeURIComponent(next)}${extra}`;

/** Signs the student in with the mobile number and password of the app account. The
 * password is sent once to the API and never stored or echoed back. */
export async function signIn(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const lang = langOf(formData);
  const mobile = String(formData.get("mobile_number") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!mobile || !password || mobile.length > MAX_FIELD || password.length > MAX_FIELD) return { error: "check" };
  if (!loginLimiter.allow(clientIp(await headers()))) return { error: "tooMany" };

  const result = await login(mobile, password, lang);
  if (!result.ok) return { error: loginFailure(result.status) };
  if (!(await setSession(result.data.access))) return { error: "unavailable" };
  redirect(safeNext(formData.get("next"), lang, `/${lang}/account/buy`));
}

export async function signOut(formData: FormData): Promise<void> {
  const lang = langOf(formData);
  await clearSession();
  redirect(`/${lang}`);
}

/** Starts the payment for a package and sends the student to the provider's secure page.
 * The price is never taken from the browser. The idempotency key is made when the page is
 * shown, so a double click (or a retry) gets the same payment, not a second one. */
export async function startCheckout(formData: FormData): Promise<void> {
  const lang = langOf(formData);
  const buy = `/${lang}/account/buy`;
  const token = await getToken();
  if (!token) redirect(loginPath(lang, buy));

  const packageId = Number(formData.get("package_id"));
  if (!Number.isInteger(packageId) || packageId <= 0) redirect(`${buy}?notice=failed`);
  const supplied = String(formData.get("idempotency_key") ?? "");
  const key = IDEMPOTENCY_KEY.test(supplied) ? supplied : newIdempotencyKey(randomBytes(8).toString("hex"));

  const result = await startPayment(token, packageId, key, lang, methodCode(formData.get("provider")));
  if (!result.ok) {
    if (result.status === 401) redirect(loginPath(lang, buy, "&expired=1"));
    redirect(`${buy}?notice=${result.code === "payment_unavailable" ? "unavailable" : "failed"}`);
  }
  if (isHttpsUrl(result.data.checkout_url, process.env.NODE_ENV !== "production")) redirect(result.data.checkout_url);
  // No open checkout (for example it was already paid): show the payment's own status.
  redirect(`/${lang}/payment-return?payment=${encodeURIComponent(result.data.payment_id)}`);
}
