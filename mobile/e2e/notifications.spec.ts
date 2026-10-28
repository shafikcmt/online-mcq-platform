import { expect, test, type Page } from "@playwright/test";

import { noHorizontalOverflow, post, registerStudent, requireDisposableStack, SHOTS, signIn, studentToken } from "./support";

/** In-app notifications on the real backend: finishing an exam whose results are shown
 * at once creates a "result published" notification (backend notifications module); the
 * bell on Home opens it, opening marks it read and leads to the result. Disposable stack
 * only. */
requireDisposableStack("notifications.spec.ts");
test.describe.configure({ mode: "serial" });

const NUMBER = "01555000777"; // not in the seed
const PASSWORD = "Surma-Nodi-2026";
let page: Page;

const visible = (text: string | RegExp) => page.getByText(text).filter({ visible: true });

test.beforeAll(async ({ browser, request }) => {
  await registerStudent(request, NUMBER, "Notified Student", PASSWORD);
  const access = await studentToken(request, NUMBER, PASSWORD);
  const room = await post(request, "/exams/e2e-results-physics/attempts/", {}, access);
  await post(request, `/attempts/${room.attempt_id}/submit/`, { source: "manual" }, access);
  page = await (await browser.newContext({ locale: "en-GB" })).newPage();
});

test("the bell shows the unread count and opens the notifications", async () => {
  await signIn(page, NUMBER, PASSWORD);
  await page.getByRole("link", { name: "1 unread notification" }).filter({ visible: true }).click();
  const list = page.getByTestId("notification-list");
  await expect(list.getByRole("link", { name: /^Unread, / })).toHaveCount(1);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `${SHOTS}/notifications-en-390.png`, fullPage: true });
});

test("opening it marks it read and shows the result; the bell clears", async () => {
  await page.getByTestId("notification-list").getByRole("link", { name: /^Unread, / }).click();
  await expect(visible("Deducted for wrong answers")).toBeVisible(); // the result details
  await page.getByRole("button", { name: "Back" }).filter({ visible: true }).click();
  await expect(page.getByTestId("notification-list").getByRole("link", { name: /^Unread, / })).toHaveCount(0);
  await page.getByRole("button", { name: "Back" }).filter({ visible: true }).click();
  await expect(page.getByLabel("No unread notifications").filter({ visible: true })).toBeVisible();
});

test("notices tab", async () => {
  await page.getByRole("link", { name: "No unread notifications" }).filter({ visible: true }).click();
  await page.getByRole("radio", { name: "Notices" }).filter({ visible: true }).click();
  await expect(page.getByTestId("notice-list")).toBeVisible();
});
