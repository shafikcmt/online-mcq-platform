import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/** Milestone 7D — Results against the real stack (nginx → Django + Next.js). Uses the
 * results seeded by `e2e/stack/seed.py` (two exams, four students, five submitted results,
 * merit not generated) and runs ONLY on the disposable stack (`e2e/stack/run.sh`): the
 * suite generates merit and publishes/hides results, and its database is dropped after. */
const MOBILE = process.env.E2E_ADMIN_MOBILE ?? "";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";
const SHOTS = process.env.SCREENSHOT_DIR ?? "test-results/screens";
const PHYSICS = "E2E Results Physics";
const MANUAL = "E2E Results Manual";

test.skip(!MOBILE || !PASSWORD, "Set E2E_ADMIN_MOBILE and E2E_ADMIN_PASSWORD");
if (process.env.E2E_DISPOSABLE_DB !== "destroy-and-recreate") {
  throw new Error("results.spec.ts needs the seeded disposable database: run it with e2e/stack/run.sh");
}
test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
const ids: { physics: number; manual: number } = { physics: 0, manual: 0 };

async function signIn(target: Page) {
  await target.goto("/login");
  await target.getByLabel("Mobile number").fill(MOBILE);
  await target.getByLabel("Password").fill(PASSWORD);
  await target.getByRole("button", { name: "Sign in" }).click();
  await expect(target).toHaveURL(/\/dashboard$/);
}

async function api<T>(path: string): Promise<T> {
  const response = await page.request.get(`/api/v1${path}`, { headers: { Accept: "application/json" } });
  expect(response.status()).toBe(200);
  return (await response.json()) as T;
}

async function expectNoHorizontalOverflow(target: Page) {
  const overflow = await target.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const main = () => page.getByRole("main");
const table = () => main().getByRole("table", { name: "Results" });
const bodyRows = () => table().locator("tbody tr");
const toast = () => page.getByRole("region", { name: "Notification" });
const resultsSection = () => page.getByRole("region", { name: /^Exam results:/ });

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  await signIn(page);
  for (const [key, title] of [
    ["physics", PHYSICS],
    ["manual", MANUAL],
  ] as const) {
    const found = await api<{ results: { id: number; title_en: string }[] }>(`/admin/exams/?search=${encodeURIComponent(title)}`);
    ids[key] = found.results.find((exam) => exam.title_en === title)!.id;
  }
});

test.afterAll(async () => {
  await context.close(); // run.sh drops this suite's database
});

test("list: seeded results with exam titles, newest first", async () => {
  await page.goto("/results");
  await expect(page.getByRole("heading", { level: 1, name: "Results" })).toBeVisible();
  await expect(bodyRows()).toHaveCount(5);
  await expect(bodyRows().first()).toContainText("Ayesha Siddika"); // submitted last
  await expect(bodyRows().first()).toContainText(MANUAL);
  await expect(table()).toContainText(PHYSICS);
  await expect(table()).toContainText("মাহমুদা আক্তার");
  await expect(table()).toContainText("Not ranked");
  await expect(table().getByRole("columnheader", { name: /Submitted/ })).toHaveAttribute("aria-sort", "descending");
  await page.screenshot({ path: `${SHOTS}/results-list-1440.png`, fullPage: true });
});

test("search by student name (server-side, in the URL)", async () => {
  await page.getByLabel("Search").fill("ayesha");
  await expect(page).toHaveURL(/search=ayesha/);
  await expect(bodyRows()).toHaveCount(2);
  await expect(table()).not.toContainText("Tanvir Ahmed");
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(bodyRows()).toHaveCount(5);
});

test("choose an exam: server search picker, exam context with server visibility", async () => {
  await page.getByRole("button", { name: "Choose exam" }).click();
  const picker = page.getByRole("dialog", { name: "Choose an exam" });
  await picker.getByRole("searchbox").fill("Physics");
  await picker.getByRole("button", { name: `Show results of ${PHYSICS}` }).click();
  await expect(picker).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`exam=${ids.physics}`));
  await expect(bodyRows()).toHaveCount(4);
  await expect(resultsSection()).toContainText(PHYSICS);
  await expect(resultsSection()).toContainText("Immediately after submission"); // the setting
  await expect(resultsSection()).toContainText("Students can see the results now"); // server value
  await expect(resultsSection()).toContainText("These actions apply to all results for this exam.");
});

test("pass/fail filter and ordering by percentage", async () => {
  await page.locator("#filter-outcome").selectOption("false");
  await expect(page).toHaveURL(/is_passed=false/);
  await expect(bodyRows()).toHaveCount(2);
  await expect(table()).toContainText("Rafiq Islam");
  await expect(table()).not.toContainText("Tanvir Ahmed");
  await page.locator("#filter-outcome").selectOption("true");
  await expect(bodyRows()).toHaveCount(2);
  await expect(table()).toContainText("Passed");
  await page.locator("#filter-outcome").selectOption("");
  await page.locator("#filter-ordering").selectOption("-percentage");
  await expect(page).toHaveURL(/ordering=-percentage/);
  await expect(bodyRows().first()).toContainText("Ayesha Siddika");
  await expect(bodyRows().first()).toContainText("100.00%");
  await page.locator("#filter-ordering").selectOption("percentage");
  await expect(bodyRows().first()).toContainText("Rafiq Islam");
  // Back restores the previous list state from the URL.
  await page.goBack();
  await expect(page).toHaveURL(/ordering=-percentage/);
  await expect(bodyRows().first()).toContainText("Ayesha Siddika");
});

test("generate merit: server ranks, the list re-reads, merit view", async () => {
  await resultsSection().getByRole("button", { name: "Generate merit list" }).click();
  await expect(toast()).toContainText("Merit list generated: 4 ranked.");
  await expect(table()).not.toContainText("Not ranked");
  await page.getByRole("button", { name: "Merit view" }).click();
  await expect(page).toHaveURL(/merit_counted=true/);
  await expect(page).toHaveURL(/ordering=merit_position/);
  await expect(page.getByRole("button", { name: "Merit view" })).toHaveAttribute("aria-pressed", "true");
  const names = ["Ayesha Siddika", "Tanvir Ahmed", "মাহমুদা আক্তার", "Rafiq Islam"];
  for (const [index, name] of names.entries()) {
    await expect(bodyRows().nth(index)).toContainText(name);
    await expect(bodyRows().nth(index)).toContainText(`Position ${index + 1}`);
  }
  await page.screenshot({ path: `${SHOTS}/results-merit-1440.png`, fullPage: true });
});

test("result detail by attempt id: score, timing, merit, visibility — no answers", async () => {
  await bodyRows().filter({ hasText: "Tanvir Ahmed" }).getByRole("link", { name: "Open result of Tanvir Ahmed" }).click();
  await expect(page).toHaveURL(/\/results\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Tanvir Ahmed" })).toBeVisible();
  await expect(main()).toContainText(PHYSICS);
  const score = main().getByRole("region", { name: "Score" });
  await expect(score).toContainText("2.00 of 3.00");
  await expect(score).toContainText("66.67%");
  await expect(score).toContainText("Passed");
  await expect(score.getByText("Correct").locator("..")).toContainText("2");
  await expect(score.getByText("Unanswered").locator("..")).toContainText("1");
  const attempt = main().getByRole("region", { name: "Attempt and timing" });
  await expect(attempt).toContainText("By the student");
  await expect(attempt).toContainText(/\d+ s/); // time used
  await expect(main().getByRole("region", { name: "Merit" })).toContainText("2");
  await expect(main().getByRole("region", { name: "Visibility" })).toContainText("Students can see the results now");
  await expect(main()).not.toContainText("Option 0"); // no answer content at all
  await expect(main()).not.toContainText(`${PHYSICS} Q0`);
  await page.screenshot({ path: `${SHOTS}/result-detail-1440.png`, fullPage: true });
  await page.getByRole("link", { name: "Back to results" }).click();
  await expect(page).toHaveURL(new RegExp(`/results\\?exam=${ids.physics}$`));
});

test("unknown or malformed result address → not found", async () => {
  await page.goto("/results/00000000-0000-4000-8000-000000000000");
  await expect(page.getByText("This item no longer exists. It may have been deleted by someone else.")).toBeVisible();
  await page.goto("/results/not-a-uuid");
  await expect(page.getByText("This item no longer exists. It may have been deleted by someone else.")).toBeVisible();
});

test("manual exam: publish and hide results at exam level (server visibility)", async () => {
  await page.goto(`/results?exam=${ids.manual}`);
  await expect(bodyRows()).toHaveCount(1);
  await expect(resultsSection()).toContainText("When an admin publishes results");
  await expect(resultsSection()).toContainText("Students can't see the results now");
  await resultsSection().getByRole("button", { name: "Publish results" }).click();
  await expect(toast()).toContainText("Results published.");
  await expect(resultsSection()).toContainText("Students can see the results now");
  await resultsSection().getByRole("button", { name: "Hide results" }).click();
  await expect(toast()).toContainText("Results hidden.");
  await expect(resultsSection()).toContainText("Students can't see the results now");
  // The student filter from a row, and the chip to clear it.
  await bodyRows().first().getByRole("button", { name: "All results of Ayesha Siddika" }).click();
  await expect(page).toHaveURL(/user=\d+/);
  await expect(main().getByText("Student:")).toBeVisible();
  await page.getByRole("button", { name: "Show all exams" }).click();
  await expect(bodyRows()).toHaveCount(2); // Ayesha's results in both exams
});

/** Visual QA: list (with exam context) and detail at four widths, English and Bangla. */
for (const locale of ["en", "bn"] as const) {
  for (const width of [1440, 1280, 768, 390]) {
    test(`visual QA ${locale} at ${width}px`, async () => {
      await context.addCookies([{ name: "admin_lang", value: locale, url: test.info().project.use.baseURL ?? "http://localhost:8088" }]);
      await page.setViewportSize({ width, height: width < 800 ? 844 : 900 });
      await page.goto(`/results?exam=${ids.physics}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(main().locator("[data-results-visible]").first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `${SHOTS}/results-${locale}-${width}.png`, fullPage: true });
      const list = await api<{ results: { attempt_id: string; user_full_name: string }[] }>(
        `/admin/results/?exam=${ids.physics}&search=${encodeURIComponent("মাহমুদা")}`,
      );
      await page.goto(`/results/${list.results[0].attempt_id}`);
      await expect(page.getByRole("heading", { level: 1, name: "মাহমুদা আক্তার" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `${SHOTS}/result-detail-${locale}-${width}.png`, fullPage: true });
    });
  }
}
