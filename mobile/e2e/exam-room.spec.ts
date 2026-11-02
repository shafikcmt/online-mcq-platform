import { expect, test, type Page } from "@playwright/test";

import { noHorizontalOverflow, registerStudent, requireDisposableStack, SHOTS, signIn, studentToken } from "./support";

/** The exam room on the real exam engine (seed exam "E2E seed exam": 3 questions, the
 * correct option is "Option 0", results shown at once). Start → answer → connection drop
 * (answer kept, then saved) → app restarted → continue with the saved answers → submit →
 * the server's score. Disposable stack only (admin/e2e/stack/run.sh). */
requireDisposableStack("exam-room.spec.ts");
test.describe.configure({ mode: "serial" });

const NUMBER = "01555000444"; // not in the seed
const PASSWORD = "Padma-Setu-2026";
let page: Page;
let attemptId = "";

const visible = (text: string | RegExp) => page.getByText(text).filter({ visible: true });
const option = (text: RegExp) => page.getByRole("radio", { name: text }).filter({ visible: true });

async function openSeedExam() {
  await page.getByRole("tab", { name: "Exams" }).filter({ visible: true }).click();
  await page.getByTestId("exam-list").getByRole("link", { name: /E2E seed exam/ }).click();
}

test.beforeAll(async ({ browser, request }) => {
  await registerStudent(request, NUMBER, "Room Student", PASSWORD);
  page = await (await browser.newContext({ locale: "en-GB" })).newPage();
});

test("start asks first, then opens the room with the server's timer", async () => {
  await signIn(page, NUMBER, PASSWORD);
  await openSeedExam();
  await page.getByRole("button", { name: "Start exam" }).filter({ visible: true }).click();
  await expect(visible("You will have 30 min. The timer starts now and keeps running even if you leave the app.")).toBeVisible();
  await page.getByRole("button", { name: "Start exam" }).filter({ visible: true }).last().click();
  await expect(visible("Question 1 of 3")).toBeVisible();
  await expect(page.getByLabel(/^Time left: (30|29) min/).filter({ visible: true })).toBeVisible();
  attemptId = new URL(page.url()).pathname.split("/").pop() ?? "";
  expect(attemptId).toMatch(/^[0-9a-f-]{36}$/);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `${SHOTS}/room-start-en-390.png` });
});

test("answers save as they change; a connection drop keeps them until it is back", async ({ request }) => {
  await option(/Option 0$/).click();
  await expect(visible("All answers saved")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).filter({ visible: true }).click();
  await expect(visible("Question 2 of 3")).toBeVisible();

  await page.context().setOffline(true);
  await option(/Option 0$/).click();
  await page.getByRole("checkbox", { name: "Mark for review" }).filter({ visible: true }).click();
  await expect(visible("Not saved yet — kept on this phone, retrying")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/room-offline-en-390.png` });
  await page.context().setOffline(false);
  await expect(visible("All answers saved")).toBeVisible({ timeout: 15_000 });

  // The server has both answers (and the review mark).
  const access = await studentToken(request, NUMBER, PASSWORD);
  const room = await (await request.get(`/api/v1/attempts/${attemptId}/`, { headers: { Authorization: `Bearer ${access}` } })).json();
  expect(room.questions.filter((q: { selected_option_id: number | null }) => q.selected_option_id !== null)).toHaveLength(2);
  expect(room.questions[1].is_marked_for_review).toBe(true);
});

test("after the app restarts, Continue brings the saved answers back", async () => {
  await page.reload(); // the web QA build forgets the session: sign in again
  await page.getByLabel("Mobile number").filter({ visible: true }).fill(NUMBER);
  await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).click();
  await openSeedExam();
  await expect(visible("You have this exam in progress. You can continue where you left off.")).toBeVisible();
  await page.getByRole("button", { name: "Continue exam" }).filter({ visible: true }).click();
  await expect(visible("Question 1 of 3")).toBeVisible();
  await expect(option(/Option 0$/)).toBeChecked();
  await expect(visible("Answered 2/3")).toBeVisible();

  await page.getByRole("button", { name: "All questions" }).filter({ visible: true }).click();
  await expect(page.getByRole("button", { name: "Question 2: Answered, Marked" }).filter({ visible: true })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/room-palette-en-390.png` });
  await page.getByRole("button", { name: "Question 3: Not answered" }).filter({ visible: true }).click();
  await expect(visible("Question 3 of 3")).toBeVisible();
  await expect(page.getByLabel("Questions", { exact: true })).toBeHidden(); // the palette closes
});

test("submit shows a summary first, then the server's score", async () => {
  await page.getByRole("button", { name: "Submit" }).filter({ visible: true }).click();
  await expect(visible("Answered 2 of 3. Not answered: 1. Marked for review: 1. You cannot change answers after submitting.")).toBeVisible();
  await page.getByRole("button", { name: "Submit" }).filter({ visible: true }).last().click();
  await expect(visible("Answers submitted")).toBeVisible();
  await expect(visible("2/3")).toBeVisible(); // two correct, one blank, no negative marking
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `${SHOTS}/room-result-en-390.png`, fullPage: true });
  await page.getByRole("button", { name: "Done" }).filter({ visible: true }).click();
  await expect(visible("You have already taken this exam. It can be taken only once.")).toBeVisible();
});
