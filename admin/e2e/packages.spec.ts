import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/** Milestone 7G — Packages against the real stack (nginx → Django + Next.js). Uses the
 * packages seeded by `e2e/stack/seed.py` (E2E Gold — used, E2E Silver — used, E2E Unused)
 * and a package the suite creates itself; runs ONLY on the disposable stack
 * (`e2e/stack/run.sh`), whose database is dropped afterwards. */
const MOBILE = process.env.E2E_ADMIN_MOBILE ?? "";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";
const SHOTS = process.env.SCREENSHOT_DIR ?? "test-results/screens";
const STAMP = `pw${Date.now().toString(36)}`;
const CREATED = `E2E Created ${STAMP}`;

test.skip(!MOBILE || !PASSWORD, "Set E2E_ADMIN_MOBILE and E2E_ADMIN_PASSWORD");
if (process.env.E2E_DISPOSABLE_DB !== "destroy-and-recreate") {
  throw new Error("packages.spec.ts needs the seeded disposable database: run it with e2e/stack/run.sh");
}
test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
const ids = { gold: 0, unused: 0, created: 0 };

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
const table = () => main().getByRole("table", { name: "Packages" });
const bodyRows = () => table().locator("tbody tr");
const toast = () => page.getByRole("region", { name: "Notification" });
const rules = () => main().getByRole("region", { name: "Access rules" });

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  await signIn(page);
  const found = await api<{ results: { id: number; slug: string }[] }>("GET", "/admin/packages/?page_size=100");
  ids.gold = found.body.results.find((row) => row.slug === "e2e-gold")!.id;
  ids.unused = found.body.results.find((row) => row.slug === "e2e-unused")!.id;
});

test.afterAll(async () => {
  await context.close(); // run.sh drops this suite's database
});

test("list: seeded packages in display order with prices, validity, status and counts", async () => {
  await page.getByRole("link", { name: "Packages" }).click();
  await expect(page).toHaveURL(/\/packages$/);
  await expect(page.getByRole("heading", { level: 1, name: "Packages" })).toBeVisible();
  await expect(bodyRows()).toHaveCount(3);
  const gold = bodyRows().nth(0);
  await expect(gold).toContainText("E2E Gold");
  await expect(gold).toContainText("৳ 500.00");
  await expect(gold).toContainText("30 days");
  await expect(gold).toContainText("Featured");
  await expect(gold).toContainText("Rules: 1");
  await expect(bodyRows().nth(1)).toContainText("E2E Silver");
  await expect(bodyRows().nth(2)).toContainText("E2E Unused");
  await expect(bodyRows().nth(2)).toContainText("No rules");
  await page.screenshot({ path: `${SHOTS}/packages-list-1440.png`, fullPage: true });
});

test("search, filter and sort (server-side, in the URL), back/forward", async () => {
  await main().getByRole("searchbox", { name: "Search" }).fill("silver");
  await expect(page).toHaveURL(/search=silver/);
  await expect(bodyRows()).toHaveCount(1);
  await expect(bodyRows().first()).toContainText("E2E Silver");
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(bodyRows()).toHaveCount(3);
  await page.locator("#filter-status").selectOption("inactive");
  await expect(page).toHaveURL(/status=inactive/);
  await expect(main()).toContainText("No packages match these filters");
  await page.locator("#filter-status").selectOption("");
  await page.locator("#filter-ordering").selectOption("price");
  await expect(page).toHaveURL(/ordering=price/);
  await expect(bodyRows().first()).toContainText("E2E Unused"); // ৳ 100
  await page.locator("#filter-ordering").selectOption("-price");
  await expect(bodyRows().first()).toContainText("E2E Gold"); // ৳ 500
  await page.goBack();
  await expect(page).toHaveURL(/ordering=price$/);
  await expect(bodyRows().first()).toContainText("E2E Unused");
  await page.goForward();
  await expect(bodyRows().first()).toContainText("E2E Gold");
});

test("create a package (bilingual, features, price, validity)", async () => {
  await page.goto("/packages");
  await page.getByRole("link", { name: "New package" }).click();
  await expect(page).toHaveURL(/\/packages\/new$/);
  await expect(main()).toContainText("Create the package first, then choose its access rules.");
  await page.locator("#package-name_en").fill(CREATED);
  await page.locator("#package-name_bn").fill(`ই২ই তৈরি ${STAMP}`);
  await page.locator("#package-features_en").fill("Daily model tests\nDetailed results");
  await page.locator("#package-price").fill("300");
  await page.locator("#package-validity").fill("0");
  await page.getByRole("button", { name: "Create package" }).click();
  // The server's rule (validity ≥ 1) is shown on the field.
  await expect(page.locator("#package-validity")).toHaveAttribute("aria-invalid", "true");
  await expect(main()).toContainText("Please correct the highlighted fields.");
  await page.locator("#package-validity").fill("15");
  await page.getByRole("button", { name: "Create package" }).click();
  await expect(page).toHaveURL(/\/packages\/\d+$/);
  ids.created = Number(page.url().split("/").pop());
  await expect(toast()).toContainText("Package created.");
  await expect(page.getByRole("heading", { level: 1, name: CREATED })).toBeVisible();
  await expect(main()).toContainText("৳ 300.00 · 15 days · No rules · Subscriptions: 0");
  await expect(page.locator("#package-features_en")).toHaveValue("Daily model tests\nDetailed results");
});

test("edit: save settings; validity note shown; access rules with paid-exam picker", async () => {
  await expect(main()).toContainText("Validity changes apply to future grants and may also affect payments that have not yet been verified.");
  await page.locator("#package-price").fill("350");
  await expect(main()).toContainText("Unsaved changes");
  await page.getByRole("button", { name: "Save package" }).click();
  await expect(toast()).toContainText("Package saved.");
  await expect(page.locator("#package-price")).toHaveValue("350.00");
  // Access rules: the immediate-effect warning is always visible.
  await expect(rules().getByRole("note")).toHaveText("Access-rule changes apply immediately to existing subscribers.");
  await rules().getByRole("checkbox", { name: "E2E seed category" }).check();
  await rules().getByRole("button", { name: "Add a paid exam" }).click();
  const picker = page.getByRole("dialog", { name: "Add a paid exam" });
  await expect(picker).toContainText("Free exams cannot be added to a package.");
  await expect(picker).toContainText("E2E Paid Mock");
  await expect(picker).not.toContainText("E2E Results Physics"); // free exams are not offered
  await picker.getByRole("button", { name: "Add E2E Paid Mock" }).click();
  await expect(picker.getByText("Added", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(rules()).toContainText("E2E Paid Mock");
  await rules().getByRole("button", { name: "Save access rules" }).click();
  await expect(toast()).toContainText("Access rules saved.");
  await expect(main()).toContainText("Rules: 2");
  const saved = await api<{ rules: { rule_type: string }[] }>("GET", `/admin/packages/${ids.created}/access-rules/`);
  expect(saved.body.rules.map((rule) => rule.rule_type).sort()).toEqual(["category", "exam"]);
  await page.screenshot({ path: `${SHOTS}/package-edit-1440.png`, fullPage: true });
});

test("deactivate (confirmation explains the consequences) and activate again", async () => {
  await page.getByRole("button", { name: "Deactivate" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Deactivate this package?" });
  await expect(dialog).toContainText("New sales and manual grants stop.");
  await expect(dialog).toContainText("Existing subscriptions keep their access until they expire.");
  await expect(dialog).toContainText("may still be honoured when it is verified");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Deactivate" }).click();
  await expect(toast()).toContainText("Package deactivated.");
  await expect(page.getByRole("button", { name: "Activate" })).toBeVisible();
  expect((await api<{ status: string }>("GET", `/admin/packages/${ids.created}/`)).body.status).toBe("inactive");
  await page.getByRole("button", { name: "Activate" }).click();
  await page.getByRole("alertdialog", { name: "Activate this package?" }).getByRole("button", { name: "Activate" }).click();
  await expect(toast()).toContainText("Package activated.");
  expect((await api<{ status: string }>("GET", `/admin/packages/${ids.created}/`)).body.status).toBe("active");
});

test("delete an unused package (created and seeded)", async () => {
  for (const id of [ids.created, ids.unused]) {
    await page.goto(`/packages/${id}`);
    await page.getByRole("button", { name: "Delete" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Delete this package?" });
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(toast()).toContainText("Package deleted.");
    await expect(page).toHaveURL(/\/packages$/);
    expect((await api("GET", `/admin/packages/${id}/`)).status).toBe(404); // really gone
  }
  await expect(bodyRows()).toHaveCount(2);
});

test("a used package cannot be deleted: no Delete in the panel, the API answers 409 in_use", async () => {
  await page.goto(`/packages/${ids.gold}`);
  await expect(page.getByRole("heading", { level: 1, name: "E2E Gold" })).toBeVisible();
  await expect(main().getByRole("button", { name: "Delete" })).toHaveCount(0);
  await expect(main()).toContainText("This package has subscriptions, so it cannot be deleted.");
  await expect(main().getByRole("link", { name: "View subscriptions" })).toHaveAttribute("href", `/subscriptions?package=${ids.gold}`);
  const response = await api<{ error: { code: string } }>("DELETE", `/admin/packages/${ids.gold}/`);
  expect(response.status).toBe(409);
  expect(response.body.error.code).toBe("in_use");
});

test("unknown or malformed package address → not found", async () => {
  for (const path of ["/packages/999999", "/packages/abc"]) {
    await page.goto(path);
    await expect(page.getByText("This item no longer exists. It may have been deleted by someone else.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to packages" })).toHaveAttribute("href", "/packages");
  }
});

/** Visual QA: list and editor (with rules) at four widths, English and Bangla. */
for (const locale of ["en", "bn"] as const) {
  for (const width of [1440, 1280, 768, 390]) {
    test(`visual QA ${locale} at ${width}px`, async () => {
      await context.addCookies([{ name: "admin_lang", value: locale, url: test.info().project.use.baseURL ?? "http://localhost:8088" }]);
      await page.setViewportSize({ width, height: width < 800 ? 844 : 900 });
      await page.goto("/packages");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `${SHOTS}/packages-${locale}-${width}.png`, fullPage: true });
      await page.goto(`/packages/${ids.gold}`);
      await expect(page.locator("#package-price")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `${SHOTS}/package-${locale}-${width}.png`, fullPage: true });
    });
  }
}
