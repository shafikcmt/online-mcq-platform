import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/** Milestone 7F — read-only Attempts against the real stack (nginx → Django + Next.js).
 * Uses the attempts seeded by `e2e/stack/seed.py` (five submitted with results, one open —
 * Tanvir Ahmed in "E2E Results Manual") and runs ONLY on the disposable stack
 * (`e2e/stack/run.sh`). Nothing here changes an attempt. Overdue is not asserted here:
 * it depends on the wall clock and is covered by the backend's frozen-time tests. */
const MOBILE = process.env.E2E_ADMIN_MOBILE ?? "";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";
const SHOTS = process.env.SCREENSHOT_DIR ?? "test-results/screens";
const PHYSICS = "E2E Results Physics";
const MANUAL = "E2E Results Manual";

test.skip(!MOBILE || !PASSWORD, "Set E2E_ADMIN_MOBILE and E2E_ADMIN_PASSWORD");
if (process.env.E2E_DISPOSABLE_DB !== "destroy-and-recreate") {
  throw new Error("attempts.spec.ts needs the seeded disposable database: run it with e2e/stack/run.sh");
}
test.describe.configure({ mode: "serial" });

type Row = { attempt_id: string; user_id: number; user_full_name: string; exam_title_en: string; status: string };

let context: BrowserContext;
let page: Page;
const ids = { open: "", finished: "", ayesha: 0 };

async function signIn(target: Page) {
  await target.goto("/login");
  await target.getByLabel("Mobile number").fill(MOBILE);
  await target.getByLabel("Password").fill(PASSWORD);
  await target.getByRole("button", { name: "Sign in" }).click();
  await expect(target).toHaveURL(/\/dashboard$/);
}

async function apiText(path: string): Promise<string> {
  const response = await page.request.get(`/api/v1${path}`, { headers: { Accept: "application/json" } });
  expect(response.status()).toBe(200);
  return response.text();
}

async function expectNoHorizontalOverflow(target: Page) {
  const overflow = await target.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const main = () => page.getByRole("main");
const table = () => main().getByRole("table", { name: "Attempts" });
const bodyRows = () => table().locator("tbody tr");
const filters = () => main().getByRole("group", { name: "Filters" });

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  await signIn(page);
  const rows = (JSON.parse(await apiText("/admin/attempts/?page_size=100")) as { results: Row[] }).results;
  const open = rows.find((row) => row.status === "in_progress")!;
  const finished = rows.find((row) => row.user_full_name === "Ayesha Siddika" && row.exam_title_en === PHYSICS)!;
  ids.open = open.attempt_id;
  ids.finished = finished.attempt_id;
  ids.ayesha = finished.user_id;
});

test.afterAll(async () => {
  await context.close(); // run.sh drops this suite's database
});

test("the API itself never sends answers, device info or idempotency keys", async () => {
  for (const path of ["/admin/attempts/", `/admin/attempts/${ids.open}/`, `/admin/attempts/${ids.finished}/`]) {
    const body = await apiText(path);
    for (const key of ["client_info", "idempotency_key", "selected_option", "option_order", "is_correct", "explanation", '"answers"', '"id"']) {
      expect(body).not.toContain(key);
    }
  }
});

test("list: seeded attempts, newest start first, open attempt without result", async () => {
  await page.getByRole("link", { name: "Attempts" }).click();
  await expect(page).toHaveURL(/\/attempts$/);
  await expect(page.getByRole("heading", { level: 1, name: "Attempts" })).toBeVisible();
  await expect(bodyRows()).toHaveCount(6);
  const open = bodyRows().first();
  await expect(open).toContainText("Tanvir Ahmed");
  await expect(open).toContainText(MANUAL);
  await expect(open).toContainText("In progress");
  await expect(open).toContainText("Not submitted");
  await expect(open).toContainText("No result yet");
  await expect(table()).toContainText("Submitted");
  await expect(table()).toContainText("মাহমুদা আক্তার");
  await expect(table().getByRole("columnheader", { name: /Started/ })).toHaveAttribute("aria-sort", "descending");
  await expect(main().getByRole("searchbox")).toHaveCount(0); // pickers, not free text
  await page.screenshot({ path: `${SHOTS}/attempts-list-1440.png`, fullPage: true });
});

test("filter by student (picker) and by exam (picker)", async () => {
  await page.getByRole("button", { name: "Choose student" }).click();
  const students = page.getByRole("dialog", { name: "Choose a student" });
  await students.getByRole("searchbox").fill("ayesha");
  await students.getByRole("button", { name: "Show results of Ayesha Siddika" }).click();
  await expect(page).toHaveURL(new RegExp(`user=${ids.ayesha}`));
  await expect(filters()).toContainText("Student: Ayesha Siddika");
  await expect(bodyRows()).toHaveCount(2);
  await page.getByRole("button", { name: "Choose exam" }).click();
  const exams = page.getByRole("dialog", { name: "Choose an exam" });
  await exams.getByRole("searchbox").fill("Physics");
  await exams.getByRole("button", { name: `Show results of ${PHYSICS}` }).click();
  await expect(filters()).toContainText(`Exam: ${PHYSICS}`);
  await expect(bodyRows()).toHaveCount(1);
  await expect(table().getByRole("columnheader", { name: /Exam/ })).toHaveCount(0); // named in the chip
  await page.getByRole("button", { name: "Show all students" }).click();
  await expect(bodyRows()).toHaveCount(4);
  await page.getByRole("button", { name: "Show all exams" }).click();
  await expect(page).toHaveURL(/\/attempts$/);
  await expect(bodyRows()).toHaveCount(6);
});

test("status and result filters, sorting, back/forward", async () => {
  await page.locator("#filter-status").selectOption("in_progress");
  await expect(page).toHaveURL(/status=in_progress/);
  await expect(bodyRows()).toHaveCount(1);
  await expect(bodyRows().first()).toContainText("Tanvir Ahmed");
  await page.locator("#filter-status").selectOption("submitted");
  await expect(bodyRows()).toHaveCount(5);
  await page.locator("#filter-status").selectOption("");
  await page.locator("#filter-result").selectOption("false");
  await expect(page).toHaveURL(/has_result=false/);
  await expect(bodyRows()).toHaveCount(1);
  await expect(bodyRows().first()).toContainText("No result yet");
  await page.locator("#filter-result").selectOption("true");
  await expect(bodyRows()).toHaveCount(5);
  await expect(table()).not.toContainText("No result yet");
  await page.locator("#filter-result").selectOption("");
  await expect(bodyRows()).toHaveCount(6);
  // Submitted, newest first: Ayesha's manual-exam attempt (submitted last); the open
  // attempt has no submit time and stays last in both directions.
  await page.locator("#filter-ordering").selectOption("-submitted_at");
  await expect(page).toHaveURL(/ordering=-submitted_at/);
  await expect(bodyRows().first()).toContainText("Ayesha Siddika");
  await expect(bodyRows().first()).toContainText(MANUAL);
  await expect(bodyRows().last()).toContainText("Tanvir Ahmed");
  await expect(bodyRows().last()).toContainText("Not submitted");
  await page.locator("#filter-ordering").selectOption("submitted_at");
  await expect(bodyRows().first()).toContainText(PHYSICS);
  await expect(bodyRows().last()).toContainText("Not submitted");
  // Back restores the previous list state from the URL; Forward returns.
  await page.goBack();
  await expect(page).toHaveURL(/ordering=-submitted_at/);
  await expect(bodyRows().first()).toContainText(MANUAL);
  await page.goForward();
  await expect(page).toHaveURL(/ordering=submitted_at/);
  await expect(bodyRows().first()).toContainText(PHYSICS);
  await page.goto("/attempts");
});

test("open attempt detail: server timing, no result link, no answers", async () => {
  await bodyRows().first().getByRole("link", { name: "Open attempt of Tanvir Ahmed" }).click();
  await expect(page).toHaveURL(new RegExp(`/attempts/${ids.open}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Tanvir Ahmed" })).toBeVisible();
  await expect(main()).toContainText(MANUAL);
  await expect(main()).toContainText("In progress");
  const timeline = main().getByRole("region", { name: "Timeline" });
  for (const label of ["Started", "Deadline", "Submit cutoff (deadline + grace)", "Server time", "Time left at server time"]) {
    await expect(timeline.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(timeline).toContainText("Not submitted");
  const result = main().getByRole("region", { name: "Result" });
  await expect(result).toContainText("Result not available yet");
  await expect(result.getByRole("link")).toHaveCount(0);
  await expect(main()).toContainText("Answers are not shown in the Admin Panel.");
  await expect(main()).not.toContainText("Option 0"); // no answer content at all
  await expect(main()).not.toContainText(`${MANUAL} Q0`);
  await expect(main().getByRole("button")).toHaveCount(0); // read-only
  await page.screenshot({ path: `${SHOTS}/attempt-open-1440.png`, fullPage: true });
});

test("finished attempt detail: stored result summary → Open result → Open attempt", async () => {
  await page.goto(`/attempts/${ids.finished}`);
  await expect(page.getByRole("heading", { level: 1, name: "Ayesha Siddika" })).toBeVisible();
  const timeline = main().getByRole("region", { name: "Timeline" });
  await expect(timeline).toContainText("By the student");
  await expect(timeline).toContainText("Finished");
  const result = main().getByRole("region", { name: "Result" });
  await expect(result).toContainText("3.00 / 3.00");
  await expect(result).toContainText("100.00%");
  await expect(result).toContainText("Passed");
  await expect(main()).not.toContainText(`${PHYSICS} Q0`);
  await page.screenshot({ path: `${SHOTS}/attempt-finished-1440.png`, fullPage: true });
  await result.getByRole("link", { name: "Open result" }).click();
  await expect(page).toHaveURL(new RegExp(`/results/${ids.finished}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Ayesha Siddika" })).toBeVisible();
  await main().getByRole("link", { name: "Open attempt" }).click();
  await expect(page).toHaveURL(new RegExp(`/attempts/${ids.finished}$`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/results/${ids.finished}$`));
});

test("User detail → View attempts", async () => {
  await page.goto(`/users/${ids.ayesha}`);
  await main().getByRole("link", { name: "View attempts" }).click();
  await expect(page).toHaveURL(new RegExp(`/attempts\\?user=${ids.ayesha}$`));
  await expect(filters()).toContainText("Student: Ayesha Siddika");
  await expect(bodyRows()).toHaveCount(2);
});

test("unknown or malformed attempt address → not found", async () => {
  for (const path of ["/attempts/00000000-0000-4000-8000-000000000000", "/attempts/not-a-uuid", "/attempts/1"]) {
    await page.goto(path);
    await expect(page.getByText("This item no longer exists. It may have been deleted by someone else.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to attempts" })).toHaveAttribute("href", "/attempts");
  }
});

/** Visual QA: list and both details at four widths, English and Bangla. */
for (const locale of ["en", "bn"] as const) {
  for (const width of [1440, 1280, 768, 390]) {
    test(`visual QA ${locale} at ${width}px`, async () => {
      await context.addCookies([{ name: "admin_lang", value: locale, url: test.info().project.use.baseURL ?? "http://localhost:8088" }]);
      await page.setViewportSize({ width, height: width < 800 ? 844 : 900 });
      await page.goto("/attempts");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(main()).toContainText("মাহমুদা আক্তার");
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `${SHOTS}/attempts-${locale}-${width}.png`, fullPage: true });
      for (const [name, id] of [
        ["open", ids.open],
        ["finished", ids.finished],
      ] as const) {
        await page.goto(`/attempts/${id}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoHorizontalOverflow(page);
        await page.screenshot({ path: `${SHOTS}/attempt-${name}-${locale}-${width}.png`, fullPage: true });
      }
    });
  }
}
