import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/** Milestone 7G — Subscriptions against the real stack, plus the grant/extend/cancel
 * actions (grant-idempotency follow-up). Uses the subscriptions seeded by
 * `e2e/stack/seed.py` through the normal services: Tanvir Ahmed — E2E Gold (active),
 * মাহমুদা আক্তার — E2E Silver (scheduled), Rafiq Islam — E2E Gold (cancelled).
 * Runs ONLY on the disposable stack (`e2e/stack/run.sh`). The read-only checks run first;
 * the tests that change subscriptions run last (serial suite). Expired subscriptions are
 * covered by the backend's frozen-time tests. */
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

test("list: newest first, effective statuses, masked mobiles, one Grant action", async () => {
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
  await expect(main().getByRole("button", { name: /grant|extend|renew|cancel subscription|delete/i })).toHaveCount(1);
  await expect(main().getByRole("button", { name: "Grant subscription" })).toBeVisible();
  await expect(table().getByRole("button", { name: /grant|extend|renew|cancel|delete/i })).toHaveCount(0);
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

test("detail: effective and stored status, period, masked mobile, links, actions", async () => {
  await bodyRows().filter({ hasText: "Tanvir Ahmed" }).getByRole("link", { name: "Open subscription of Tanvir Ahmed" }).click();
  await expect(page).toHaveURL(new RegExp(`/subscriptions/${ids.active}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Tanvir Ahmed" })).toBeVisible();
  const period = main().getByRole("region", { name: "Period" });
  await expect(period).toContainText("Active");
  await expect(period).toContainText("৳ 1,500.00");
  const record = main().getByRole("region", { name: "Record" });
  await expect(record).toContainText("+88017*****102");
  await expect(record).toContainText("Partly hidden");
  await expect(main()).toContainText("Grants, extensions and cancellations are recorded in the audit log.");
  await expect(main().getByRole("button")).toHaveText(["Extend", "Cancel subscription"]);
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

// ----------------------------------------------------------------------------------------
// Actions (they change subscriptions — last in this serial suite)
// ----------------------------------------------------------------------------------------
type Sub = { id: number; price_paid: string; expires_at: string; status: string; effective_status: string };

async function subscriptionsOf(userId: number, packageSlug?: string): Promise<(Sub & { package: { slug: string } })[]> {
  const rows = (JSON.parse(await apiText(`/admin/subscriptions/?user=${userId}&page_size=100`)) as {
    results: (Sub & { package: { slug: string } })[];
  }).results;
  return packageSlug ? rows.filter((row) => row.package.slug === packageSlug) : rows;
}

async function studentId(name: string): Promise<number> {
  const body = JSON.parse(await apiText(`/admin/users/?role=student&search=${encodeURIComponent(name)}`)) as { results: { id: number }[] };
  return body.results[0].id;
}

const grantDialog = (name: RegExp | string) => page.getByRole("dialog", { name });

test("grant: a new subscription; a double click grants once", async () => {
  const ayesha = await studentId("Ayesha");
  expect(await subscriptionsOf(ayesha)).toHaveLength(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await context.addCookies([{ name: "admin_lang", value: "en", url: test.info().project.use.baseURL ?? "http://localhost:8088" }]);
  await page.goto("/subscriptions");
  await main().getByRole("button", { name: "Grant subscription" }).click();
  const dialog = grantDialog("Grant a subscription");
  await dialog.getByRole("button", { name: "Choose student" }).click();
  const students = page.getByRole("dialog", { name: "Choose a student" });
  await students.getByRole("searchbox").fill("Ayesha");
  await students.getByRole("button", { name: "Choose Ayesha Siddika" }).click();
  await dialog.getByRole("button", { name: "Choose package" }).click();
  const packages = page.getByRole("dialog", { name: "Choose a package" });
  await packages.getByRole("searchbox").fill("silver");
  await packages.getByRole("button", { name: "Choose E2E Silver" }).click();
  await expect(dialog).toContainText("৳ 250.00 · 60 days");
  await dialog.getByLabel(/Price paid/).fill("100");
  await expect(dialog).toHaveCSS("opacity", "1");
  await page.screenshot({ path: `${SHOTS}/subscription-grant-dialog-1440.png` });
  await dialog.getByRole("button", { name: "Grant" }).dblclick();
  await expect(page).toHaveURL(/\/subscriptions\/\d+$/);
  await expect(page.getByText("Subscription granted.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Ayesha Siddika" })).toBeVisible();
  const rows = await subscriptionsOf(ayesha);
  expect(rows).toHaveLength(1);
  expect(rows[0].price_paid).toBe("100.00");
  await expect(main().getByRole("region", { name: "Period" })).toContainText("৳ 100.00");
});

test("extend from the detail page: added once, even with a double click", async () => {
  await page.goto(`/subscriptions/${ids.active}`); // Tanvir — E2E Gold, ৳ 1,500.00
  const [before] = await subscriptionsOf(ids.tanvir, "e2e-gold");
  await main().getByRole("button", { name: "Extend" }).click();
  const dialog = grantDialog("Extend this subscription");
  await expect(dialog.getByRole("button", { name: /Change|Choose/ })).toHaveCount(0);
  await expect(dialog.getByLabel(/^Start/)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Extend" }).dblclick();
  await expect(page.getByText("Subscription extended.")).toBeVisible();
  await expect(main().getByRole("region", { name: "Period" })).toContainText("৳ 2,000.00");
  const [after] = await subscriptionsOf(ids.tanvir, "e2e-gold");
  expect(after.price_paid).toBe("2000.00");
  expect(Date.parse(after.expires_at) - Date.parse(before.expires_at)).toBe(30 * 24 * 3600 * 1000);
});

test("a lost response is retried with the same key: the server replays, nothing is added twice", async () => {
  const ayesha = await studentId("Ayesha");
  const [sub] = await subscriptionsOf(ayesha, "e2e-silver"); // ৳ 100.00 from the grant test
  await page.goto(`/subscriptions/${sub.id}`);
  const keys: string[] = [];
  let dropped = false;
  await page.route("**/api/v1/admin/subscriptions/grant/", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    if (!dropped) {
      dropped = true;
      await route.fetch(); // the server processes it …
      await route.abort("connectionreset"); // … but the answer never arrives
      return;
    }
    await route.continue();
  });
  await main().getByRole("button", { name: "Extend" }).click();
  const dialog = grantDialog("Extend this subscription");
  await dialog.getByRole("button", { name: "Extend" }).click();
  await expect(dialog.getByRole("alert")).toContainText("safe to try again");
  expect((await subscriptionsOf(ayesha, "e2e-silver"))[0].price_paid).toBe("350.00"); // applied once
  await dialog.getByRole("button", { name: "Extend" }).click();
  await expect(page.getByText("This grant had already been made — nothing was granted twice.")).toBeVisible();
  await page.unroute("**/api/v1/admin/subscriptions/grant/");
  expect(keys).toHaveLength(2);
  expect(keys[0]).toMatch(/^[A-Za-z0-9._:-]{1,64}$/);
  expect(keys[1]).toBe(keys[0]);
  const [after] = await subscriptionsOf(ayesha, "e2e-silver");
  expect(after.price_paid).toBe("350.00");
  expect(Date.parse(after.expires_at) - Date.parse(sub.expires_at)).toBe(60 * 24 * 3600 * 1000);
});

test("cancel: asks first, then access ends; only Grant again remains", async () => {
  const ayesha = await studentId("Ayesha");
  const [sub] = await subscriptionsOf(ayesha, "e2e-silver");
  await page.goto(`/subscriptions/${sub.id}`);
  await main().getByRole("button", { name: "Cancel subscription" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Cancel this subscription?" });
  await expect(dialog).toContainText("Ayesha Siddika loses access to E2E Silver immediately.");
  await expect(dialog.getByRole("button", { name: "Keep subscription" })).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel subscription" }).click();
  await expect(page.getByText("Subscription cancelled.")).toBeVisible();
  await expect(main().getByRole("region", { name: "Period" })).toContainText("Cancelled");
  await expect(main().getByRole("button")).toHaveText(["Grant again"]);
  expect((await subscriptionsOf(ayesha, "e2e-silver"))[0].status).toBe("cancelled");
});

test("grant dialog in Bangla at phone width", async () => {
  await context.addCookies([{ name: "admin_lang", value: "bn", url: test.info().project.use.baseURL ?? "http://localhost:8088" }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/subscriptions");
  await main().getByRole("button", { name: "সাবস্ক্রিপশন দিন" }).click();
  const dialog = page.getByRole("dialog", { name: "সাবস্ক্রিপশন দিন" });
  await expect(dialog.getByRole("button", { name: "শিক্ষার্থী বাছাই করুন" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expect(dialog).toHaveCSS("opacity", "1"); // after the opening fade
  await page.screenshot({ path: `${SHOTS}/subscription-grant-dialog-bn-390.png` }); // what the phone shows
  await dialog.getByRole("button", { name: "বাতিল" }).click();
  await context.addCookies([{ name: "admin_lang", value: "en", url: test.info().project.use.baseURL ?? "http://localhost:8088" }]);
});
