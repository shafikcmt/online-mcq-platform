import { expect, test, type Page } from "@playwright/test";

import { noHorizontalOverflow, post, registerStudent, requireDisposableStack, SHOTS, signIn, studentToken } from "./support";

/** Exams tab and exam details on the real backend and the E2E seed: the student's status
 * per exam comes from `GET /exams/` (the exam engine's own start rules). Disposable stack
 * only (admin/e2e/stack/run.sh). */
requireDisposableStack("exams.spec.ts");
test.describe.configure({ mode: "serial" });

const NUMBER = "01555000333"; // not in the seed
const PASSWORD = "Kashful-Bon-2026";
let page: Page;

const visible = (text: string | RegExp) => page.getByText(text).filter({ visible: true });
/** The Exams tab's own list (the web build keeps other tabs in the page). */
const inList = (text: string | RegExp) => page.getByTestId("exam-list").getByText(text);

test.beforeAll(async ({ browser, request }) => {
  await registerStudent(request, NUMBER, "Exams Student", PASSWORD);
  page = await (await browser.newContext({ locale: "en-GB" })).newPage();
});

test("Exams tab: the seeded exams open now; upcoming and past are empty", async () => {
  await signIn(page, NUMBER, PASSWORD);
  await expect(visible("Hello, Exams")).toBeVisible();
  await page.getByRole("tab", { name: "Exams" }).filter({ visible: true }).click();
  await expect(inList("E2E Results Physics")).toBeVisible();
  await expect(inList("E2E Results Manual")).toBeVisible();
  await expect(inList("E2E seed exam")).toBeVisible();
  await expect(inList("3 exams")).toBeVisible();
  await expect(inList("Ready to start")).toHaveCount(3);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `${SHOTS}/exams-open-en-390.png`, fullPage: true });

  await page.getByRole("radio", { name: "Upcoming" }).filter({ visible: true }).click();
  await expect(inList("No upcoming exams yet.")).toBeVisible();
  await page.getByRole("radio", { name: "Past" }).filter({ visible: true }).click();
  await expect(inList("No past exams yet.")).toBeVisible();
  await page.getByRole("radio", { name: "Open now" }).filter({ visible: true }).click();
  await expect(inList("E2E Results Physics")).toBeVisible();
});

test("exam details: facts from the server and that it can start now", async () => {
  await page.getByTestId("exam-list").getByRole("link", { name: /E2E Results Physics/ }).click();
  await expect(visible("About this exam")).toBeVisible();
  await expect(visible("You can start this exam now. You will have 30 min.")).toBeVisible();
  await expect(visible("Bangla and English")).toBeVisible(); // content_language "both"
  await expect(visible("0 of 1")).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `${SHOTS}/exam-detail-ready-en-390.png`, fullPage: true });
});

test("after taking it, the details say it can be taken only once — as the start endpoint does", async ({ request }) => {
  const access = await studentToken(request, NUMBER, PASSWORD);
  const room = await post(request, "/exams/e2e-results-physics/attempts/", {}, access);
  await post(request, `/attempts/${room.attempt_id}/submit/`, { source: "manual" }, access);
  const again = await request.post("/api/v1/exams/e2e-results-physics/attempts/", { data: {}, headers: { Authorization: `Bearer ${access}` } });
  expect((await again.json()).error.code).toBe("retake_not_allowed");

  await page.getByRole("button", { name: "Back" }).filter({ visible: true }).click();
  await expect(inList("Completed")).toBeVisible(); // the list reloads when it comes back into view
  await page.getByTestId("exam-list").getByRole("link", { name: /E2E Results Physics/ }).click();
  await expect(visible("You have already taken this exam. It can be taken only once.")).toBeVisible();
  await expect(visible("1 of 1")).toBeVisible();
});

test("Bangla details", async () => {
  await page.getByRole("button", { name: "Back" }).filter({ visible: true }).click();
  await page.getByRole("tab", { name: "Profile" }).filter({ visible: true }).click();
  await page.getByRole("radio", { name: "বাংলা" }).filter({ visible: true }).click();
  await page.getByRole("tab", { name: "পরীক্ষা" }).filter({ visible: true }).click();
  await page.getByTestId("exam-list").getByRole("link", { name: /ই২ই পরীক্ষা/ }).click();
  await expect(visible("পরীক্ষার তথ্য")).toBeVisible();
  await expect(visible("আপনি এখনই পরীক্ষাটি শুরু করতে পারবেন। সময় পাবেন ৩০ মিনিট।")).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `${SHOTS}/exam-detail-bn-390.png`, fullPage: true });
});
