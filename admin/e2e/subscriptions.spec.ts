import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/** Milestone 7G — read-only Subscriptions against the real stack. Uses the subscriptions
 * seeded by `e2e/stack/seed.py` through the normal services: Tanvir Ahmed — E2E Gold
 * (active), মাহমুদা আক্তার — E2E Silver (scheduled), Rafiq Islam — E2E Gold (cancelled).
 * Runs ONLY on the disposable stack (`e2e/stack/run.sh`). Nothing here changes a
 * subscription. Expired subscriptions are covered by the backend's frozen-time tests. */
const MOBILE = process.env.E2E_ADMIN_MOBILE ?? "";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";
const SHOTS = process.env.SCREENSHOT_DIR ?? "test-results/screens";

test.skip(!MOBILE || !PASSWORD, "Set E2E_ADMIN_MOBILE and E2E_ADMIN_PASSWORD");
if (process.env.E2E_DISPOSABLE_DB !== "destroy-and-recreate") {
  throw new Error("subscriptions.spec.ts needs the seeded disposable database: run it with e2e/stack/run.sh");
}
test.describe.configure({ mode: "serial" });

type Row = { id: number; user: { id: number; full_name: string }; package: { id: number; slug: string }; effective_status: string };

let context: BrowserContext;
let page: Page;
const ids = { active: 0, tanvir: 0, gold: 0 };
const RAW = ["01700000102", "1700000102", "01700000103", "01700000104"]; // seeded students' numbers

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

async function expectNoRawMobile(target: Page) {
  const html = await target.content();
  for (const raw of RAW) expect(html).not.toContain(raw);
}

const main = () => page.getByRole("main");
const table = () => main().getByRole("table", { name: "Subscriptions" });
const bodyRows = () => table().locator("tbody tr");
const filters = () => main().getByRole("group", { name: "Filters" });

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  await signIn(page);
  const rows = (JSON.parse(await apiText("/admin/subscriptions/?page_size=100")) as { results: Row[] }).results;
  const active = rows.find((row) => row.effective_status === "active")!;
  ids.active = active.id;
  ids.tanvir = active.user.id;
  ids.gold = active.package.id;
});

test.afterAll(async () => {
  await context.close(); // run.sh drops this suite's database
});

test("the API itself sends only the masked mobile number", async () => {
  for (const path of ["/admin/subscriptions/", `/admin/subscriptions/${ids.active}/`]) {
    const body = await apiText(path);
    expect(body).not.toContain("mobile_number");
    expect(body).toContain("mobile_display");
    for (const raw of RAW) expect(body).not.toContain(raw);
  }
});

test("list: newest first, effective statuses, masked mobiles, read-only", async () => {
  await page.getByRole("link", { name: "Subscriptions" }).click();
  await expect(page).toHaveURL(/\/subscriptions$/);
  await expect(page.getByRole("heading", { level: 1, name: "Subscriptions" })).toBeVisible();
  await expect(bodyRows()).toHaveCount(3);
  const rafiq = bodyRows().nth(0); // created last
  await expect(rafiq).toContainText("Rafiq Islam");
  await expect(rafiq).toContainText("Cancelled");
  await expect(rafiq).toContainText("+88017*****104");
  const mahmuda = bodyRows().filter({ hasText: "মাহমুদা আক্তার" });
  await expect(mahmuda).toContainText("Scheduled");
  await expect(mahmuda).toContainText("E2E Silver");
  const tanvir = bodyRows().filter({ hasText: "Tanvir Ahmed" });
  await expect(tanvir).toContainText("Active");
  await expect(tanvir).toContainText("৳ 1,500.00"); // manual grant + two verified payments (7H seed)
  await expect(main().getByRole("button", { name: /grant|extend|renew|cancel subscription|delete/i })).toHaveCount(0);
  await expect(main().getByRole("searchbox")).toHaveCount(0);
  await expectNoRawMobile(page);
  await page.screenshot({ path: `${SHOTS}/subscriptions-list-1440.png`, fullPage: true });
});

test("effective-status filter, sorting, back/forward", async () => {
  await page.locator("#filter-status").selectOption("scheduled");
  await expect(page).toHaveURL(/effective_status=scheduled/);
  await expect(bodyRows()).toHaveCount(1);
  await expect(bodyRows().first()).toContainText("মাহমুদা আক্তার");
  await page.locator("#filter-status").selectOption("active");
  await expect(bodyRows()).toHaveCount(1);
  await expect(bodyRows().first()).toContainText("Tanvir Ahmed");
  await page.locator("#filter-status").selectOption("expired");
  await expect(main()).toContainText("No subscriptions match these filters");
  await page.locator("#filter-status").selectOption("");
  await expect(bodyRows()).toHaveCount(3);
  await page.locator("#filter-ordering").selectOption("-starts_at");
  await expect(page).toHaveURL(/ordering=-starts_at/);
  await expect(bodyRows().first()).toContainText("মাহমুদা আক্তার"); // starts in 3 days
  await page.locator("#filter-ordering").selectOption("starts_at");
  await expect(bodyRows().last()).toContainText("মাহমুদা আক্তার");
  await page.goBack();
  await expect(page).toHaveURL(/ordering=-starts_at/);
  await expect(bodyRows().first()).toContainText("মাহমুদা আক্তার");
  await page.goForward();
  await expect(bodyRows().last()).toContainText("মাহমুদা আক্তার");
  await page.goto("/subscriptions");
});

test("student and package pickers; chips name them from the server", async () => {
  await page.getByRole("button", { name: "Choose package" }).click();
  const packages = page.getByRole("dialog", { name: "Choose a package" });
  await packages.getByRole("searchbox").fill("gold");
  await packages.getByRole("button", { name: "Show subscriptions of E2E Gold" }).click();
  await expect(page).toHaveURL(new RegExp(`package=${ids.gold}`));
  await expect(filters()).toContainText("Package: E2E Gold");
  await expect(bodyRows()).toHaveCount(2); // Tanvir (active) + Rafiq (cancelled)
  await page.getByRole("button", { name: "Choose student" }).click();
  const students = page.getByRole("dialog", { name: "Choose a student" });
  await students.getByRole("searchbox").fill("tanvir");
  await students.getByRole("button", { name: "Show results of Tanvir Ahmed" }).click();
  await expect(filters()).toContainText("Student: Tanvir Ahmed");
  await expect(bodyRows()).toHaveCount(1);
  await page.getByRole("button", { name: "Show all packages" }).click();
  await expect(bodyRows()).toHaveCount(1);
  await page.getByRole("button", { name: "Show all students" }).click();
  await expect(page).toHaveURL(/\/subscriptions$/);
  await expect(bodyRows()).toHaveCount(3);
});

test("detail: effective and stored status, period, masked mobile, links, no actions", async () => {
  await bodyRows().filter({ hasText: "Tanvir Ahmed" }).getByRole("link", { name: "Open subscription of Tanvir Ahmed" }).click();
  await expect(page).toHaveURL(new RegExp(`/subscriptions/${ids.active}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Tanvir Ahmed" })).toBeVisible();
  const period = main().getByRole("region", { name: "Period" });
  await expect(period).toContainText("Active");
  await expect(period).toContainText("৳ 1,500.00");
  const record = main().getByRole("region", { name: "Record" });
  await expect(record).toContainText("+88017*****102");
  await expect(record).toContainText("Partly hidden");
  await expect(main()).toContainText("Granting, extending and cancelling are not available in the Admin Panel yet.");
  await expect(main().getByRole("button")).toHaveCount(0);
  await expectNoRawMobile(page);
  await page.screenshot({ path: `${SHOTS}/subscription-detail-1440.png`, fullPage: true });
  await record.getByRole("link", { name: "E2E Gold" }).click();
  await expect(page).toHaveURL(new RegExp(`/packages/${ids.gold}$`));
  await page.goBack();
  await main().getByRole("region", { name: "Record" }).getByRole("link", { name: "Tanvir Ahmed" }).click();
  await expect(page).toHaveURL(new RegExp(`/users/${ids.tanvir}$`));
});

test("User detail → View subscriptions", async () => {
  await page.goto(`/users/${ids.tanvir}`);
  const card = main().getByRole("region", { name: "Activity" }).getByRole("listitem").filter({ hasText: "Active subscriptions" });
  await expect(card).toContainText("1");
  await card.getByRole("link", { name: "View subscriptions" }).click();
  await expect(page).toHaveURL(new RegExp(`/subscriptions\\?user=${ids.tanvir}$`));
  await expect(filters()).toContainText("Student: Tanvir Ahmed");
  await expect(bodyRows()).toHaveCount(1);
});

test("unknown or malformed subscription address → not found", async () => {
  for (const path of ["/subscriptions/999999", "/subscriptions/abc"]) {
    await page.goto(path);
    await expect(page.getByText("This item no longer exists. It may have been deleted by someone else.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to subscriptions" })).toHaveAttribute("href", "/subscriptions");
  }
});

/** Visual QA: list and detail at four widths, English and Bangla. */
for (const locale of ["en", "bn"] as const) {
  for (const width of [1440, 1280, 768, 390]) {
    test(`visual QA ${locale} at ${width}px`, async () => {
      await context.addCookies([{ name: "admin_lang", value: locale, url: test.info().project.use.baseURL ?? "http://localhost:8088" }]);
      await page.setViewportSize({ width, height: width < 800 ? 844 : 900 });
      await page.goto("/subscriptions");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(main()).toContainText("মাহমুদা আক্তার");
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `${SHOTS}/subscriptions-${locale}-${width}.png`, fullPage: true });
      await page.goto(`/subscriptions/${ids.active}`);
      await expect(page.getByRole("heading", { level: 1, name: "Tanvir Ahmed" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNoRawMobile(page);
      await page.screenshot({ path: `${SHOTS}/subscription-${locale}-${width}.png`, fullPage: true });
    });
  }
}
