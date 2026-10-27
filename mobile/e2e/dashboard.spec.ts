import { readFileSync } from "node:fs";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/** Home dashboard against the real backend and the E2E seed (admin/e2e/stack/seed.py):
 * a new student sees the seeded open exams, no package and no results; after finishing an
 * exam (through the real exam engine API), the result and the "Completed" state appear
 * when Home is opened again. Runs ONLY on the disposable stack (admin/e2e/stack/run.sh). */
const LOG = process.env.E2E_DJANGO_LOG ?? "";
const SHOTS = process.env.SCREENSHOT_DIR ?? "e2e/test-results/screens";
if (process.env.E2E_DISPOSABLE_DB !== "destroy-and-recreate" || !LOG) {
  throw new Error("dashboard.spec.ts needs the disposable stack: run it with admin/e2e/stack/run.sh");
}
test.describe.configure({ mode: "serial" });

const NUMBER = "01555000222"; // not in the seed
const E164 = "+8801555000222";
const PASSWORD = "Shapla-Pukur-2026";
let page: Page;

async function smsCode(since: number): Promise<string> {
  for (let i = 0; i < 60; i += 1) {
    const hit = readFileSync(LOG, "utf8")
      .slice(since)
      .split("\n")
      .reverse()
      .find((line) => line.includes("[MOCK SMS") && line.includes(`*****${NUMBER.slice(-3)}`));
    const code = hit?.match(/\b(\d{6})\b/)?.[1];
    if (code) return code;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("no SMS code arrived");
}

async function call(request: APIRequestContext, path: string, data: object, token?: string) {
  const response = await request.post(`/api/v1${path}`, {
    data,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.json();
}

const visible = (text: string | RegExp) => page.getByText(text).filter({ visible: true });

test.beforeAll(async ({ browser, request }) => {
  // The account is created through the public API (registration itself is covered by
  // auth.spec.ts); the student then signs in through the app.
  const since = readFileSync(LOG, "utf8").length;
  await call(request, "/auth/otp/request/", { mobile_number: E164, purpose: "registration", language: "en" });
  const { verification_token } = await call(request, "/auth/otp/verify/", {
    mobile_number: E164,
    purpose: "registration",
    code: await smsCode(since),
  });
  await call(request, "/auth/register/", {
    verification_token,
    mobile_number: E164,
    full_name: "Dashboard Student",
    password: PASSWORD,
    preferred_language: "en",
  });
  page = await (await browser.newContext({ locale: "en-GB" })).newPage();
});

test("a new student's Home: open exams from the seed, no package, no results yet", async () => {
  await page.goto("/");
  await page.getByRole("radio", { name: "English" }).filter({ visible: true }).click();
  await page.getByLabel("Mobile number").filter({ visible: true }).fill(NUMBER);
  await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).click();
  await expect(visible("Hello, Dashboard")).toBeVisible();

  await expect(visible("E2E Results Physics")).toBeVisible();
  await expect(visible("E2E seed exam")).toBeVisible();
  await expect(visible("E2E Paid Mock")).toHaveCount(0); // a draft: never listed
  await expect(visible("No active package")).toBeVisible();
  await expect(visible("Your results will appear here after you finish an exam.")).toBeVisible();
  await expect(page.getByLabel("No unread notifications").filter({ visible: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/home-dashboard-new-en-390.png`, fullPage: true });
});

test("after finishing an exam, coming back to Home shows the result", async ({ request }) => {
  const { access } = await call(request, "/auth/login/", { mobile_number: E164, password: PASSWORD });
  const room = await call(request, "/exams/e2e-results-physics/attempts/", {}, access);
  await call(request, `/attempts/${room.attempt_id}/submit/`, { source: "manual" }, access);

  await page.getByRole("tab", { name: "Profile" }).filter({ visible: true }).click();
  await page.getByRole("tab", { name: "Home" }).filter({ visible: true }).click();
  await expect(visible("0/3")).toBeVisible();
  await expect(visible("0%")).toBeVisible();
  await expect(visible("Not passed")).toBeVisible(); // the exam's pass mark is 2
  await expect(visible("Completed")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/home-dashboard-result-en-390.png`, fullPage: true });
});

test("Bangla: the same Home in Bangla, exam titles in Bangla from the server", async () => {
  await page.getByRole("tab", { name: "Profile" }).filter({ visible: true }).click();
  await page.getByRole("radio", { name: "বাংলা" }).filter({ visible: true }).click();
  await page.getByRole("tab", { name: "হোম" }).filter({ visible: true }).click();
  await expect(visible("ই২ই ফলাফল পদার্থবিজ্ঞান").first()).toBeVisible();
  await expect(visible("০/৩")).toBeVisible();
  await expect(visible("অনুত্তীর্ণ")).toBeVisible();
  await expect(visible("কোনো সক্রিয় প্যাকেজ নেই")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/home-dashboard-bn-390.png`, fullPage: true });
});
