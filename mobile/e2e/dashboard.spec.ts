import { expect, test, type Page } from "@playwright/test";

import { noHorizontalOverflow, post, registerStudent, requireDisposableStack, SHOTS, signIn, studentToken } from "./support";

/** Home dashboard against the real backend and the E2E seed (admin/e2e/stack/seed.py):
 * a new student sees the seeded open exams, no package and no results; after finishing an
 * exam (through the real exam engine API), the result and the "Completed" state appear
 * when Home is opened again. Runs ONLY on the disposable stack (admin/e2e/stack/run.sh). */
requireDisposableStack("dashboard.spec.ts");
test.describe.configure({ mode: "serial" });

const NUMBER = "01555000222"; // not in the seed
const PASSWORD = "Shapla-Pukur-2026";
let page: Page;

const visible = (text: string | RegExp) => page.getByText(text).filter({ visible: true });

test.beforeAll(async ({ browser, request }) => {
  // The account is created through the public API (registration itself is covered by
  // auth.spec.ts); the student then signs in through the app.
  await registerStudent(request, NUMBER, "Dashboard Student", PASSWORD);
  page = await (await browser.newContext({ locale: "en-GB" })).newPage();
});

test("a new student's Home: open exams from the seed, no package, no results yet", async () => {
  await signIn(page, NUMBER, PASSWORD);
  await expect(visible("Hello, Dashboard")).toBeVisible();

  await expect(visible("E2E Results Physics")).toBeVisible();
  await expect(visible("E2E seed exam")).toBeVisible();
  await expect(visible("E2E Paid Mock")).toHaveCount(0); // a draft: never listed
  await expect(visible("No active package")).toBeVisible();
  await expect(visible("Your results will appear here after you finish an exam.")).toBeVisible();
  await expect(page.getByLabel("No unread notifications").filter({ visible: true })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `${SHOTS}/home-dashboard-new-en-390.png`, fullPage: true });
});

test("after finishing an exam, coming back to Home shows the result", async ({ request }) => {
  const access = await studentToken(request, NUMBER, PASSWORD);
  const room = await post(request, "/exams/e2e-results-physics/attempts/", {}, access);
  await post(request, `/attempts/${room.attempt_id}/submit/`, { source: "manual" }, access);

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
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `${SHOTS}/home-dashboard-bn-390.png`, fullPage: true });
});
