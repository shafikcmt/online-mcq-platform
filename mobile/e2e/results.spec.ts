import { expect, test, type Page } from "@playwright/test";

import { noHorizontalOverflow, registerStudent, requireDisposableStack, SHOTS, signIn, studentToken } from "./support";

/** Results, answer review and leaderboard on the real backend. The student takes the
 * seed exam "E2E seed exam" through the exam engine API (question 1 right, question 2
 * wrong, question 3 blank), then reads the result in the app. Disposable stack only. */
requireDisposableStack("results.spec.ts");
test.describe.configure({ mode: "serial" });

const NUMBER = "01555000555"; // not in the seed
const PASSWORD = "Meghna-Nodi-2026";
let page: Page;

const visible = (text: string | RegExp) => page.getByText(text).filter({ visible: true });

type RoomQuestion = { question_id: number; options: { id: number; text: string }[] };

test.beforeAll(async ({ browser, request }) => {
  await registerStudent(request, NUMBER, "Results Student", PASSWORD);
  const access = await studentToken(request, NUMBER, PASSWORD);
  const headers = { Authorization: `Bearer ${access}`, "Accept-Language": "en" };
  const exams = await (await request.get("/api/v1/exams/?search=E2E seed exam", { headers })).json();
  const slug = exams.results[0].slug as string;
  const room = await (await request.post(`/api/v1/exams/${slug}/attempts/`, { data: {}, headers })).json();
  const [first, second] = room.questions as RoomQuestion[];
  const pick = (q: RoomQuestion, right: boolean) => q.options.find((o) => (o.text === "Option 0") === right)!.id;
  const now = new Date().toISOString();
  const answers = [
    { question_id: first.question_id, selected_option_id: pick(first, true), client_saved_at: now },
    { question_id: second.question_id, selected_option_id: pick(second, false), client_saved_at: now },
  ];
  const submit = await request.post(`/api/v1/attempts/${room.attempt_id}/submit/`, { data: { source: "manual", answers }, headers });
  expect(submit.ok()).toBeTruthy();
  page = await (await browser.newContext({ locale: "en-GB" })).newPage();
});

test("Results tab lists the result; details show the server's numbers", async () => {
  await signIn(page, NUMBER, PASSWORD);
  await page.getByRole("tab", { name: "Results" }).filter({ visible: true }).click();
  await page.getByTestId("results-list").getByRole("link", { name: /E2E seed exam/ }).click();
  await expect(visible("Deducted for wrong answers")).toBeVisible();
  await expect(visible("1/3")).toBeVisible(); // one right, one wrong, one blank; no negative marking
  await expect(visible("33.33%")).toBeVisible();
  await expect(visible("Not ranked yet")).toBeVisible(); // the merit list is generated later
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `${SHOTS}/result-detail-en-390.png`, fullPage: true });
});

test("answer review: correct answers and the student's wrong choice, with filters", async () => {
  await page.getByRole("button", { name: "Review answers" }).filter({ visible: true }).click();
  await expect(visible("Correct").first()).toBeVisible();
  await expect(page.getByLabel(/Option 0, Correct answer, Your answer/).filter({ visible: true })).toHaveCount(1);
  await expect(page.getByLabel(/Your answer$/).filter({ visible: true })).toHaveCount(2); // the right pick and the wrong one
  await expect(page.getByLabel(/^[A-D]\. Option [1-3], Your answer$/).filter({ visible: true })).toHaveCount(1); // the wrong one
  await page.getByRole("radio", { name: "Skipped (1)" }).filter({ visible: true }).click();
  await expect(page.getByLabel(/Your answer/).filter({ visible: true })).toHaveCount(0);
  await noHorizontalOverflow(page);
  await page.getByRole("radio", { name: "All (3)" }).filter({ visible: true }).click();
  await page.screenshot({ path: `${SHOTS}/review-en-390.png`, fullPage: true });
});

test("leaderboard before the merit list is generated", async () => {
  await page.getByRole("button", { name: "Back" }).filter({ visible: true }).click();
  await page.getByRole("button", { name: "Leaderboard" }).filter({ visible: true }).click();
  await expect(visible("You are not on this list yet.")).toBeVisible();
  await expect(visible("The merit list has not been prepared yet.")).toBeVisible();
});

test("history shows the submitted attempt; Bangla details", async () => {
  await page.getByRole("button", { name: "Back" }).filter({ visible: true }).click();
  await page.getByRole("button", { name: "Back" }).filter({ visible: true }).click();
  await page.getByRole("radio", { name: "History" }).filter({ visible: true }).click();
  await expect(page.getByTestId("history-list").getByText("Submitted")).toBeVisible();
  await page.getByRole("tab", { name: "Profile" }).filter({ visible: true }).click();
  await page.getByRole("radio", { name: "বাংলা" }).filter({ visible: true }).click();
  await page.getByRole("tab", { name: "ফলাফল" }).filter({ visible: true }).click();
  await page.getByRole("radio", { name: "ফলাফল" }).filter({ visible: true }).click();
  await page.getByTestId("results-list").getByRole("link").first().click();
  await expect(visible("ভুল উত্তরের জন্য কাটা")).toBeVisible(); // the details screen
  await expect(visible("উত্তীর্ণ").or(visible("অনুত্তীর্ণ"))).toHaveCount(0); // the seed exam has no pass mark
  await expect(visible("৩৩.৩৩%").last()).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `${SHOTS}/result-detail-bn-390.png`, fullPage: true });
});
