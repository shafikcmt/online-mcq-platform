import { readFileSync } from "node:fs";

import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** Shared steps for the suites that need a signed-in student (not auth.spec.ts, which
 * tests registration itself through the app). Disposable stack only. */
export const LOG = process.env.E2E_DJANGO_LOG ?? "";
export const SHOTS = process.env.SCREENSHOT_DIR ?? "e2e/test-results/screens";

export function requireDisposableStack(suite: string) {
  if (process.env.E2E_DISPOSABLE_DB !== "destroy-and-recreate" || !LOG) {
    throw new Error(`${suite} needs the disposable stack: run it with admin/e2e/stack/run.sh`);
  }
}

/** The newest mock-SMS code sent to `number` after `since` (log length). */
export async function smsCode(number: string, since: number): Promise<string> {
  for (let i = 0; i < 60; i += 1) {
    const hit = readFileSync(LOG, "utf8")
      .slice(since)
      .split("\n")
      .reverse()
      .find((line) => line.includes("[MOCK SMS") && line.includes(`*****${number.slice(-3)}`));
    const code = hit?.match(/\b(\d{6})\b/)?.[1];
    if (code) return code;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("no SMS code arrived");
}

export async function post(request: APIRequestContext, path: string, data: object, token?: string) {
  const response = await request.post(`/api/v1${path}`, { data, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.json();
}

/** Registers a student through the public API (SMS code from the mock log). */
export async function registerStudent(request: APIRequestContext, number: string, fullName: string, password: string) {
  const e164 = `+88${number}`;
  const since = readFileSync(LOG, "utf8").length;
  await post(request, "/auth/otp/request/", { mobile_number: e164, purpose: "registration", language: "en" });
  const { verification_token } = await post(request, "/auth/otp/verify/", { mobile_number: e164, purpose: "registration", code: await smsCode(number, since) });
  await post(request, "/auth/register/", { verification_token, mobile_number: e164, full_name: fullName, password, preferred_language: "en" });
}

/** A student token for driving the exam engine directly (as the exam room will). */
export async function studentToken(request: APIRequestContext, number: string, password: string): Promise<string> {
  return (await post(request, "/auth/login/", { mobile_number: `+88${number}`, password })).access;
}

/** First launch in English, then sign in through the app. */
export async function signIn(page: Page, number: string, password: string) {
  await page.goto("/");
  await page.getByRole("radio", { name: "English" }).filter({ visible: true }).click();
  await page.getByLabel("Mobile number").filter({ visible: true }).fill(number);
  await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).click();
}

export async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}
