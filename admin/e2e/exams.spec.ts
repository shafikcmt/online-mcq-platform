import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/** Milestone 7C — exams and the question picker against the real stack (nginx → Django +
 * Next.js). The full lifecycle is exercised, including publishing — and a published exam,
 * its locked questions and their history can never be deleted (by design; no test-only
 * bypass exists). So this suite runs ONLY on the disposable stack (`e2e/stack/run.sh`):
 * a fresh copy of a seeded database for this suite, dropped afterwards with everything
 * the suite created. */
const MOBILE = process.env.E2E_ADMIN_MOBILE ?? "";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";
const SHOTS = process.env.SCREENSHOT_DIR ?? "test-results/screens";
const STAMP = `${Date.now()}`.slice(-7);
const EXAM_EN = `QA7C Exam ${STAMP}`;
const EXAM_BN = `কিউএ পরীক্ষা ${STAMP}`;
const QUESTION_COUNT = 25;

test.skip(!MOBILE || !PASSWORD, "Set E2E_ADMIN_MOBILE and E2E_ADMIN_PASSWORD");
if (process.env.E2E_DISPOSABLE_DB !== "destroy-and-recreate") {
  throw new Error("exams.spec.ts creates records that can't be deleted: run it with e2e/stack/run.sh (disposable database)");
}
test.describe.configure({ mode: "serial" });

const created: { category?: number; subject?: number; questions: number[] } = { questions: [] };
let examId = 0;
let copyId = 0;
let context: BrowserContext;
let page: Page;

async function signIn(target: Page) {
  await target.goto("/login");
  await target.getByLabel("Mobile number").fill(MOBILE);
  await target.getByLabel("Password").fill(PASSWORD);
  await target.getByRole("button", { name: "Sign in" }).click();
  await expect(target).toHaveURL(/\/dashboard$/);
}

async function api<T = unknown>(method: string, path: string, data?: unknown): Promise<{ status: number; body: T }> {
  const csrf = (await context.cookies()).find((cookie) => cookie.name === "csrftoken")?.value ?? "";
  const response = await page.request.fetch(`/api/v1${path}`, {
    method,
    headers: { "X-CSRFToken": csrf, Accept: "application/json", ...(data ? { "Content-Type": "application/json" } : {}) },
    data: data ? JSON.stringify(data) : undefined,
  });
  const text = await response.text();
  return { status: response.status(), body: (text ? JSON.parse(text) : null) as T };
}

async function expectNoHorizontalOverflow(target: Page) {
  const overflow = await target.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const main = () => page.getByRole("main");
const toast = () => page.getByRole("region", { name: "Notification" });
const questionText = (index: number) => `QA7C q${String(index).padStart(2, "0")} ${STAMP}`;
const assignedRows = () => page.getByRole("list", { name: "Assigned questions" }).locator("[data-question-row]");
const picker = () => page.getByRole("dialog", { name: "Add questions" });

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  await signIn(page);
  const category = await api<{ id: number }>("POST", "/admin/categories/", { name_en: `QA7C Category ${STAMP}`, name_bn: `কিউএ ${STAMP}` });
  expect(category.status).toBe(201);
  created.category = category.body.id;
  const subject = await api<{ id: number }>("POST", "/admin/subjects/", {
    category: created.category,
    name_en: `QA7C Subject ${STAMP}`,
    name_bn: `কিউএ বিষয় ${STAMP}`,
  });
  expect(subject.status).toBe(201);
  created.subject = subject.body.id;
  for (let index = 1; index <= QUESTION_COUNT; index += 1) {
    const question = await api<{ id: number }>("POST", "/admin/questions/", {
      subject: created.subject,
      text_en: questionText(index),
      text_bn: `কিউএ প্রশ্ন ${index} ${STAMP}`,
      difficulty: index % 2 ? "easy" : "hard",
      is_active: true,
      options: ["A", "B", "C", "D"].map((label, position) => ({
        text_en: `Option ${label}`,
        text_bn: `অপশন ${label}`,
        is_correct: position === 0,
        sort_order: position,
      })),
    });
    expect(question.status).toBe(201);
    created.questions.push(question.body.id);
  }
});

test.afterAll(async () => {
  // Nothing to undo record by record: run.sh drops this suite's database.
  await context.close();
});

test("create an exam (settings only; questions come next)", async () => {
  await page.goto("/exams");
  await expect(page.getByRole("heading", { level: 1, name: "Exams" })).toBeVisible();
  await page.getByRole("link", { name: "New exam" }).first().click();
  await expect(page).toHaveURL(/\/exams\/new$/);
  await expect(page.getByText("Create the exam first, then assign its questions.")).toBeVisible();

  // Empty form → the server's field messages, the summary is focused.
  await page.getByRole("button", { name: "Create exam" }).click();
  await expect(page.getByText("Please correct the highlighted fields.")).toBeVisible();
  await expect(page.getByLabel(/^Category/)).toHaveAttribute("aria-invalid", "true");

  await page.locator("#exam-title_bn").fill(EXAM_BN);
  await page.locator("#exam-title_en").fill(EXAM_EN);
  await page.getByLabel(/^Category/).selectOption(String(created.category));
  await page.getByLabel(/^Subject/).selectOption(String(created.subject));
  await page.getByLabel(/^Duration/).fill("30");
  await page.getByLabel(/^Number of questions/).fill("3");
  // Schedule entered in Asia/Dhaka time, sent with the +06:00 offset.
  await page.getByLabel(/^Starts at/).fill("2030-01-15T09:30");
  await page.getByLabel(/^Ends at/).fill("2030-01-15T12:00");
  const request = page.waitForRequest((r) => r.url().endsWith("/api/v1/admin/exams/") && r.method() === "POST");
  const response = page.waitForResponse((r) => r.url().endsWith("/api/v1/admin/exams/") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Create exam" }).click();
  const sent = (await request).postDataJSON();
  expect(sent.start_at).toBe("2030-01-15T09:30:00+06:00");
  expect(sent.end_at).toBe("2030-01-15T12:00:00+06:00");
  const body = await (await response).json();
  expect((await response).status()).toBe(201);
  examId = body.id;
  expect(body.start_at).toBe("2030-01-15T03:30:00Z"); // stored in UTC
  await expect(page).toHaveURL(new RegExp(`/exams/${examId}$`));
  await expect(toast()).toContainText("Exam created.");
  await expect(page.getByRole("heading", { level: 1, name: EXAM_EN })).toBeVisible();
  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel(/^Starts at/)).toHaveValue("2030-01-15T09:30"); // shown back in Dhaka time
  await expect(page.getByText("Assigned 0 of 3")).toBeVisible();
});

test("edit settings: live rules shown, server keeps them", async () => {
  await page.getByLabel(/^Exam type/).selectOption("live");
  await expect(page.getByText("Live exam rules").first()).toBeVisible();
  await expect(page.getByLabel("Allow retakes")).toBeDisabled();
  await expect(page.getByText("Students get one attempt.")).toBeVisible();
  await page.getByLabel(/^Negative marks/).fill("0.25");
  const response = page.waitForResponse((r) => r.url().endsWith(`/api/v1/admin/exams/${examId}/`) && r.request().method() === "PATCH");
  await page.getByRole("button", { name: "Save settings" }).click();
  const saved = await (await response).json();
  expect(saved).toMatchObject({ exam_type: "live", allow_retake: false, max_attempts: 1, merit_strategy: "first_attempt", negative_marks: "0.25" });
  await expect(toast()).toContainText("Exam settings saved.");
  await page.reload();
  await expect(page.getByLabel(/^Negative marks/)).toHaveValue("0.25");
  await expect(page.getByLabel(/^Exam type/)).toHaveValue("live");
});

test("picker: server paging/filtering keeps the selection, no duplicates", async () => {
  await page.getByRole("button", { name: "Add questions" }).click();
  await expect(picker()).toBeVisible();
  // Defaults: the exam's category, subject and language; active questions.
  await expect(picker().getByLabel("Category")).toHaveValue(String(created.category));
  await expect(picker().getByLabel("Subject")).toHaveValue(String(created.subject));
  await expect(picker().getByLabel("Language")).toHaveValue("bn");
  await picker().getByLabel("Rows per page").selectOption("10");
  await expect(picker().getByText(`Showing 1–10 of ${QUESTION_COUNT}`)).toBeVisible();
  await expect(picker().locator("[data-picker-row]")).toHaveCount(10);

  // Page 1 → add the newest question (ordering: newest first).
  const newest = created.questions[QUESTION_COUNT - 1];
  await picker().getByRole("button", { name: `Add question #${newest}` }).click();
  await expect(picker().locator(`[data-picker-row="${newest}"]`)).toContainText("Added");
  await expect(picker().getByRole("button", { name: `Remove question #${newest} from the exam` })).toBeFocused();

  // Page 2 → add another; back on page 1 the first one is still marked as added.
  const requests: string[] = [];
  page.on("request", (r) => r.url().includes("/api/v1/admin/questions/?") && requests.push(r.url()));
  await picker().getByRole("button", { name: "Next page" }).click();
  await expect(picker().getByText(`Showing 11–20 of ${QUESTION_COUNT}`)).toBeVisible();
  const second = created.questions[QUESTION_COUNT - 11];
  await picker().getByRole("button", { name: `Add question #${second}` }).click();
  await picker().getByRole("button", { name: "Previous page" }).click();
  await expect(picker().locator(`[data-picker-row="${newest}"]`)).toContainText("Added");
  await expect(picker().getByRole("button", { name: `Add question #${newest}` })).toHaveCount(0); // can't add twice
  expect(requests.every((url) => url.includes("page_size=10"))).toBe(true); // never the whole bank

  // Filter (difficulty) and search are server-side and keep the selection.
  await picker().getByLabel("Difficulty").selectOption("easy");
  await expect(picker().locator("[data-picker-row]").first()).toBeVisible();
  await picker().getByRole("searchbox").fill(questionText(QUESTION_COUNT - 10));
  await expect(picker().locator("[data-picker-row]")).toHaveCount(1);
  await expect(picker().locator(`[data-picker-row="${second}"]`)).toContainText("Added");
  await page.screenshot({ path: `${SHOTS}/exam-picker-1440.png` });
  await expect(picker().getByText("2 assigned")).toBeVisible();

  // Close and reopen: the query and the selection are both kept.
  await picker().getByRole("button", { name: "Done" }).click();
  await expect(assignedRows()).toHaveCount(2);
  await page.getByRole("button", { name: "Add questions" }).click();
  await expect(picker().getByRole("searchbox")).toHaveValue(questionText(QUESTION_COUNT - 10));
  await expect(picker().locator(`[data-picker-row="${second}"]`)).toContainText("Added");
  await page.keyboard.press("Escape");
  await expect(picker()).toBeHidden();
});

test("reorder + marks override, then the COMPLETE list is saved", async () => {
  const newest = created.questions[QUESTION_COUNT - 1];
  const second = created.questions[QUESTION_COUNT - 11];
  await expect(assignedRows().nth(0)).toHaveAttribute("data-question-row", String(newest));
  await page.getByRole("button", { name: `Move question #${second} up` }).click();
  await expect(assignedRows().nth(0)).toHaveAttribute("data-question-row", String(second));
  await expect(page.getByRole("button", { name: `Move question #${second} down` })).toBeFocused();
  await page.getByLabel(`Marks for question #${newest}`).fill("2.5");
  await expect(page.getByText("Save your changes first — publishing uses the saved exam.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled();

  const request = page.waitForRequest((r) => r.url().endsWith(`/api/v1/admin/exams/${examId}/questions/`) && r.method() === "PATCH");
  await page.getByRole("button", { name: "Save question list" }).click();
  expect((await request).postDataJSON()).toEqual({
    questions: [
      { question: second, sort_order: 0, marks: null },
      { question: newest, sort_order: 1, marks: "2.5" },
    ],
  });
  await expect(toast()).toContainText("Question list saved.");
  await page.reload();
  await expect(assignedRows().nth(0)).toHaveAttribute("data-question-row", String(second));
  await expect(page.getByLabel(`Marks for question #${newest}`)).toHaveValue("2.50");
  await expect(page.getByText("Assigned 2 of 3")).toBeVisible();
});

test("unsaved changes: in-app links ask first", async () => {
  await page.locator("#exam-title_en").fill(`${EXAM_EN} (edited)`);
  await page.getByRole("link", { name: "Back to exams" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Discard unsaved changes?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(new RegExp(`/exams/${examId}$`));
  // The sidebar is covered too.
  await page.getByRole("navigation").getByRole("link", { name: "Questions" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  // Sign out is a button in the top bar, not a link: it asks too.
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Discard and sign out" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/exams/${examId}$`));
  await expect(page.locator("#exam-title_en")).toHaveValue(`${EXAM_EN} (edited)`); // still unsaved, still there
  expect((await api("GET", "/admin/auth/me/")).status).toBe(200); // still signed in
  await page.locator("#exam-title_en").fill(EXAM_EN);
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
});

test("publish: validation summary links to the problem, then succeeds", async () => {
  await page.getByRole("button", { name: "Publish" }).click();
  const summary = page.getByRole("alert").filter({ hasText: "This exam can't be published yet" });
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("This exam needs 3 questions but 2 are assigned.");
  await page.screenshot({ path: `${SHOTS}/exam-publish-errors-1440.png` });
  await summary.getByRole("button", { name: "Go to Questions" }).click();
  await expect(page.locator("#exam-section-questions")).toBeFocused();

  // Add the third question, save, publish.
  await page.getByRole("button", { name: "Add questions" }).click();
  await picker().getByRole("searchbox").fill(questionText(1));
  await picker().getByRole("button", { name: `Add question #${created.questions[0]}` }).click();
  await picker().getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Save question list" }).click();
  await expect(toast()).toContainText("Question list saved.");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(toast()).toContainText("Exam published.");
  await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Published exams can't be edited.")).toBeVisible();
  await expect(page.getByText("The question list can't change while the exam is published or archived.")).toBeVisible();
  await expect(page.getByLabel(/^Duration/)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add questions" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Results", exact: true })).toBeVisible();
});

test("question_locked: a question of the published exam can't be edited", async () => {
  await page.goto(`/questions/${created.questions[0]}`);
  await page.locator("#q-text_en").fill(`${questionText(1)} changed`);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("This question is used by a published exam and cannot be edited.")).toBeVisible();
});

test("results controls on the published exam", async () => {
  await page.goto(`/exams/${examId}`);
  const results = page.getByRole("region", { name: "Results", exact: true });
  await results.getByRole("button", { name: "Publish results" }).click();
  await expect(toast()).toContainText("Results published.");
  await expect(results.getByRole("button", { name: "Hide results" })).toBeVisible();
  await results.getByRole("button", { name: "Hide results" }).click();
  await expect(toast()).toContainText("Results hidden.");
  await results.getByRole("button", { name: "Generate merit list" }).click();
  await expect(toast()).toContainText("Merit list generated: 0 ranked.");
});

test("duplicate: a new draft, schedule cleared, questions copied", async () => {
  await page.getByRole("button", { name: "Duplicate" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Duplicate this exam?" });
  const response = page.waitForResponse((r) => r.url().endsWith(`/api/v1/admin/exams/${examId}/duplicate/`));
  await dialog.getByRole("button", { name: "Duplicate" }).click();
  copyId = (await (await response).json()).id;
  await expect(page).toHaveURL(new RegExp(`/exams/${copyId}$`));
  await expect(toast()).toContainText("Copy created as a draft.");
  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel(/^Starts at/)).toHaveValue("");
  await expect(page.getByLabel(/^Ends at/)).toHaveValue("");
  await expect(page.getByLabel("Featured")).not.toBeChecked();
  await expect(assignedRows()).toHaveCount(3);
});

test("conflict: the exam was published elsewhere while editing → 409 explained", async () => {
  // Someone else publishes the copy (a regular exam without schedule can be published).
  await api("PATCH", `/admin/exams/${copyId}/`, { exam_type: "regular", start_at: null, end_at: null });
  await page.reload();
  await expect(page.getByLabel(/^Exam type/)).toHaveValue("regular");
  expect((await api("POST", `/admin/exams/${copyId}/publish/`)).status).toBe(200);
  await page.getByLabel(/^Duration/).fill("45");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "This exam can't be changed now" })).toBeVisible();
  // The current status is re-read; the form becomes read-only and keeps the typed value.
  await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel(/^Duration/)).toHaveValue("45");
  await expect(page.getByLabel(/^Duration/)).toBeDisabled();
});

test("lifecycle: unpublish, archive; delete only for drafts", async () => {
  await page.goto(`/exams/${examId}`);
  await page.getByRole("button", { name: "Unpublish" }).click();
  await page.getByRole("alertdialog", { name: "Unpublish this exam?" }).getByRole("button", { name: "Unpublish" }).click();
  await expect(toast()).toContainText("Exam unpublished.");
  await expect(page.getByText("Unpublished", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel(/^Duration/)).toBeEnabled(); // editable again
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0); // was published once

  await page.getByRole("button", { name: "Archive" }).click();
  await page.getByRole("alertdialog", { name: "Archive this exam?" }).getByRole("button", { name: "Archive" }).click();
  await expect(toast()).toContainText("Exam archived.");
  await expect(page.getByText("Archived exams can't be edited.")).toBeVisible();

  await page.goto(`/exams?search=${STAMP}`);
  await expect(main().getByRole("row")).toHaveCount(3); // header + original + copy
  await expect(main().getByRole("button", { name: /^Delete / })).toHaveCount(0); // no drafts left
});

test("delete a draft from the list (confirm, never optimistic)", async () => {
  const draft = await api<{ id: number }>("POST", `/admin/exams/${examId}/duplicate/`);
  await page.goto(`/exams?search=${STAMP}&status=draft`);
  const row = main().getByRole("row").filter({ hasText: EXAM_EN });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: /^Delete / }).click();
  const dialog = page.getByRole("alertdialog", { name: "Delete this exam?" });
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(toast()).toContainText("Exam deleted.");
  await expect(page.getByText("No exams match these filters")).toBeVisible();
  expect((await api("GET", `/admin/exams/${draft.body.id}/`)).status).toBe(404); // really gone
});

test("list: filters and sort live in the URL", async () => {
  await page.goto(`/exams?search=${STAMP}`);
  await page.locator("#filter-status").selectOption("archived");
  await expect(page).toHaveURL(/status=archived/);
  await expect(main().getByRole("row")).toHaveCount(2);
  await page.getByRole("button", { name: /Updated/ }).click();
  await expect(page).toHaveURL(/ordering=-updated_at/);
  await page.goBack();
  await expect(page).not.toHaveURL(/ordering=/);
  await expect(page.locator("#filter-status")).toHaveValue("archived");
});

test("dirty editor + Sign out → Discard and sign out ends the session, nothing saved", async () => {
  const draft = await api<{ id: number; duration_minutes: number }>("POST", `/admin/exams/${examId}/duplicate/`);
  await page.goto(`/exams/${draft.body.id}`);
  await page.getByLabel(/^Duration/).fill("77");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Discard unsaved changes?" });
  const logout = page.waitForRequest((r) => r.url().endsWith("/api/v1/admin/auth/logout/") && r.method() === "POST");
  await dialog.getByRole("button", { name: "Discard and sign out" }).click();
  await logout;
  await expect(page).toHaveURL(/\/login$/);
  expect((await api("GET", "/admin/auth/me/")).status).toBe(401);
  await signIn(page); // the visual checks below need a session again
  const after = await api<{ duration_minutes: number }>("GET", `/admin/exams/${draft.body.id}/`);
  expect(after.body.duration_minutes).toBe(draft.body.duration_minutes); // the discarded edit was not saved
});

/** Visual QA: list, editor and picker at four widths, English and Bangla. */
for (const locale of ["en", "bn"] as const) {
  for (const width of [1440, 1280, 768, 390]) {
    test(`visual QA ${locale} at ${width}px`, async () => {
      await context.addCookies([{ name: "admin_lang", value: locale, url: test.info().project.use.baseURL ?? "http://localhost:8088" }]);
      await page.setViewportSize({ width, height: width < 800 ? 844 : 900 });
      await page.goto("/exams");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `${SHOTS}/exams-${locale}-${width}.png`, fullPage: true });
      await page.goto(`/exams/${examId}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `${SHOTS}/exam-archived-${locale}-${width}.png`, fullPage: true });
      // An editable draft with questions, and the picker open.
      await page.goto(`/exams/new?category=${created.category}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `${SHOTS}/exam-new-${locale}-${width}.png`, fullPage: true });
      const draft = await api<{ id: number }>("POST", `/admin/exams/${examId}/duplicate/`);
      await page.goto(`/exams/${draft.body.id}`);
      // Visible, not only present: React reveals streamed content after a short delay.
      await expect(page.locator("[data-question-row]").nth(2)).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `${SHOTS}/exam-editor-${locale}-${width}.png`, fullPage: true });
      await page.getByRole("button", { name: locale === "en" ? "Add questions" : "প্রশ্ন যুক্ত করুন" }).click();
      await expect(page.getByRole("dialog").locator("[data-picker-row]").first()).toBeVisible();
      await page.waitForTimeout(200);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `${SHOTS}/exam-picker-${locale}-${width}.png` });
      await page.keyboard.press("Escape");
      expect((await api("DELETE", `/admin/exams/${draft.body.id}/`)).status).toBe(204);
    });
  }
}
