import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/** Milestone 7E — read-only Users and the Results student filter against the real stack
 * (nginx → Django + Next.js). Uses the users seeded by `e2e/stack/seed.py` (the admin,
 * four students with results, one inactive student with an email) and runs ONLY on the
 * disposable stack (`e2e/stack/run.sh`). Nothing here changes a user. */
const MOBILE = process.env.E2E_ADMIN_MOBILE ?? "";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";
const SHOTS = process.env.SCREENSHOT_DIR ?? "test-results/screens";

test.skip(!MOBILE || !PASSWORD, "Set E2E_ADMIN_MOBILE and E2E_ADMIN_PASSWORD");
if (process.env.E2E_DISPOSABLE_DB !== "destroy-and-recreate") {
  throw new Error("users.spec.ts needs the seeded disposable database: run it with e2e/stack/run.sh");
}
test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
const ids: Record<"ayesha" | "nusrat", number> = { ayesha: 0, nusrat: 0 };

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

/** No full mobile number or email anywhere in the page's HTML (text, attributes, data). */
async function expectNoRawContact(target: Page) {
  const html = await target.content();
  for (const raw of ["01700000101", "1700000101", "01700000105", "nusrat.jahan", "example.org", MOBILE]) {
    expect(html).not.toContain(raw);
  }
}

const main = () => page.getByRole("main");
const table = () => main().getByRole("table", { name: "Users" });
const bodyRows = () => table().locator("tbody tr");
const resultsTable = () => main().getByRole("table", { name: "Results" });
const filters = () => main().getByRole("group", { name: "Filters" });
const searchBox = () => main().getByRole("searchbox", { name: "Search" });

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  await signIn(page);
  for (const [key, name] of [
    ["ayesha", "Ayesha Siddika"],
    ["nusrat", "Nusrat Jahan"],
  ] as const) {
    const found = JSON.parse(await apiText(`/admin/users/?search=${encodeURIComponent(name)}`)) as {
      results: { id: number; full_name: string }[];
    };
    ids[key] = found.results.find((user) => user.full_name === name)!.id;
  }
});

test.afterAll(async () => {
  await context.close(); // run.sh drops this suite's database
});

test("the API itself never sends a full mobile number or email", async () => {
  for (const path of ["/admin/users/", `/admin/users/${ids.nusrat}/`, "/admin/users/?search=01700000105"]) {
    const body = await apiText(path);
    expect(body).not.toContain("mobile_number");
    expect(body).not.toMatch(/"email"\s*:/);
    expect(body).not.toContain("nusrat.jahan");
    expect(body).not.toContain("+8801700000105");
  }
});

test("list: seeded users newest first, contact details masked", async () => {
  await page.getByRole("link", { name: "Users" }).click();
  await expect(page).toHaveURL(/\/users$/);
  await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
  await expect(bodyRows()).toHaveCount(6); // admin + five students
  const nusrat = bodyRows().first();
  await expect(nusrat).toContainText("Nusrat Jahan"); // created last
  await expect(nusrat).toContainText("+88017*****105");
  await expect(nusrat).toContainText("n***@e***.org");
  await expect(nusrat).toContainText("Inactive");
  await expect(table().getByRole("columnheader", { name: /Contact \(partly hidden\)/ })).toBeVisible();
  await expect(table().getByRole("columnheader", { name: /Joined/ })).toHaveAttribute("aria-sort", "descending");
  await expect(main().getByRole("button", { name: /edit|delete|deactivate|reveal|copy/i })).toHaveCount(0);
  await expectNoRawContact(page);
  await page.screenshot({ path: `${SHOTS}/users-list-1440.png`, fullPage: true });
});

test("search by name and by mobile number (any form), server-side", async () => {
  await searchBox().fill("tanvir");
  await expect(page).toHaveURL(/search=tanvir/);
  await expect(bodyRows()).toHaveCount(1);
  await expect(bodyRows().first()).toContainText("Tanvir Ahmed");
  await searchBox().fill("01700000103");
  await expect(page).toHaveURL(/search=01700000103/);
  await expect(bodyRows()).toHaveCount(1);
  await expect(bodyRows().first()).toContainText("মাহমুদা আক্তার");
  await expect(bodyRows().first()).toContainText("+88017*****103");
  await searchBox().fill("০১৭০০০০০১০৩"); // Bangla digits
  await expect(bodyRows()).toHaveCount(1);
  await expect(bodyRows().first()).toContainText("মাহমুদা আক্তার");
  await searchBox().fill("nusrat.jahan@"); // email: matches, still masked
  await expect(bodyRows()).toHaveCount(1);
  await expect(bodyRows().first()).toContainText("n***@e***.org");
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(bodyRows()).toHaveCount(6);
  // Checked once the admin's own query (in the box and URL) is gone.
  await expectNoRawContact(page);
});

test("role and active filters, sorting, back/forward", async () => {
  await page.locator("#filter-role").selectOption("admin");
  await expect(page).toHaveURL(/role=admin/);
  await expect(bodyRows()).toHaveCount(1);
  await expect(bodyRows().first()).toContainText("E2E Admin");
  await expect(bodyRows().first()).toContainText("Admin");
  await page.locator("#filter-role").selectOption("student");
  await expect(bodyRows()).toHaveCount(5);
  await page.locator("#filter-active").selectOption("false");
  await expect(page).toHaveURL(/is_active=false/);
  await expect(bodyRows()).toHaveCount(1);
  await expect(bodyRows().first()).toContainText("Nusrat Jahan");
  await page.locator("#filter-active").selectOption("true");
  await expect(bodyRows()).toHaveCount(4);
  await page.locator("#filter-ordering").selectOption("full_name");
  await expect(page).toHaveURL(/ordering=full_name/);
  await expect(bodyRows().first()).toContainText("Ayesha Siddika");
  await expect(table().getByRole("columnheader", { name: /User/ })).toHaveAttribute("aria-sort", "ascending");
  await page.locator("#filter-ordering").selectOption("-date_joined");
  await expect(bodyRows().first()).toContainText("Rafiq Islam"); // newest active student
  // Back restores the previous list state from the URL; Forward returns.
  await page.goBack();
  await expect(page).toHaveURL(/ordering=full_name/);
  await expect(bodyRows().first()).toContainText("Ayesha Siddika");
  await page.goForward();
  await expect(page).not.toHaveURL(/ordering=full_name/);
  await expect(bodyRows().first()).toContainText("Rafiq Islam");
  await page.goto("/users");
  await expect(bodyRows()).toHaveCount(6);
});

test("detail: fields, masked contact, counts and the Results link", async () => {
  await searchBox().fill("ayesha");
  await expect(bodyRows()).toHaveCount(1);
  await bodyRows().first().getByRole("link", { name: "Open Ayesha Siddika" }).click();
  await expect(page).toHaveURL(new RegExp(`/users/${ids.ayesha}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Ayesha Siddika" })).toBeVisible();
  const profile = main().getByRole("region", { name: "Profile" });
  await expect(profile).toContainText("+88017*****101");
  await expect(profile).toContainText("No email");
  await expect(profile).toContainText("Partly hidden");
  await expect(main().getByRole("region", { name: "Account" })).toContainText("Not verified"); // seeded without OTP
  await expect(main()).toContainText("Mobile numbers and emails are partly hidden to protect privacy.");
  const activity = main().getByRole("region", { name: "Activity" });
  const card = (label: string) => activity.getByRole("listitem").filter({ hasText: label });
  await expect(card("Results")).toContainText("2"); // physics + manual
  await expect(card("Attempts")).toContainText("2");
  await expect(card("Active subscriptions")).toContainText("0");
  await expect(card("Payments")).toContainText("0");
  await expect(card("Payments").getByRole("link", { name: "View payments" })).toHaveAttribute("href", `/payments?user=${ids.ayesha}`);
  await expect(card("Attempts").getByRole("link", { name: "View attempts" })).toHaveAttribute("href", `/attempts?user=${ids.ayesha}`);
  await expect(card("Active subscriptions").getByRole("link", { name: "View subscriptions" })).toHaveAttribute(
    "href",
    `/subscriptions?user=${ids.ayesha}`,
  );
  await expect(activity.getByRole("link")).toHaveCount(4);
  await expectNoRawContact(page);
  await page.screenshot({ path: `${SHOTS}/user-detail-1440.png`, fullPage: true });
  await activity.getByRole("link", { name: "View results" }).click();
  await expect(page).toHaveURL(new RegExp(`/results\\?user=${ids.ayesha}$`));
  await expect(filters()).toContainText("Student: Ayesha Siddika");
  await expect(resultsTable().locator("tbody tr")).toHaveCount(2);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/users/${ids.ayesha}$`));
});

test("Results student picker: server search of students, chip names the student", async () => {
  await page.goto("/results");
  await page.getByRole("button", { name: "Choose student" }).click();
  const picker = page.getByRole("dialog", { name: "Choose a student" });
  await expect(picker).toContainText("Contact details stay partly hidden.");
  await picker.getByRole("searchbox").fill("E2E Admin");
  await expect(picker).toContainText("No students match this search."); // students only
  await picker.getByRole("searchbox").fill("01700000102");
  await expect(picker).toContainText("+88017*****102");
  await picker.getByRole("button", { name: "Show results of Tanvir Ahmed" }).click();
  await expect(picker).toBeHidden();
  await expect(page).toHaveURL(/user=\d+/);
  await expect(filters()).toContainText("Student: Tanvir Ahmed");
  await expect(resultsTable().locator("tbody tr")).toHaveCount(1);
  // A student with no results: the chip still names them (resolved from the users API).
  await page.goto(`/results?user=${ids.nusrat}`);
  await expect(filters()).toContainText("Student: Nusrat Jahan");
  await expect(main()).toContainText("No results match these filters");
  await filters().getByRole("button", { name: "Change student" }).click();
  await page.getByRole("dialog", { name: "Choose a student" }).getByRole("searchbox").fill("ayesha");
  await page.getByRole("button", { name: "Show results of Ayesha Siddika" }).click();
  await expect(filters()).toContainText("Student: Ayesha Siddika");
  await page.goBack();
  await expect(filters()).toContainText("Student: Nusrat Jahan");
  await page.getByRole("button", { name: "Show all students" }).click();
  await expect(page).toHaveURL(/\/results$/);
  await expect(resultsTable().locator("tbody tr")).toHaveCount(5);
});

test("unknown or malformed user address → not found", async () => {
  for (const path of ["/users/999999", "/users/abc", "/users/0"]) {
    await page.goto(path);
    await expect(page.getByText("This item no longer exists. It may have been deleted by someone else.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to users" })).toHaveAttribute("href", "/users");
  }
});

/** Visual QA: list and detail at four widths, English and Bangla. */
for (const locale of ["en", "bn"] as const) {
  for (const width of [1440, 1280, 768, 390]) {
    test(`visual QA ${locale} at ${width}px`, async () => {
      await context.addCookies([{ name: "admin_lang", value: locale, url: test.info().project.use.baseURL ?? "http://localhost:8088" }]);
      await page.setViewportSize({ width, height: width < 800 ? 844 : 900 });
      await page.goto("/users");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(main()).toContainText("+88017*****105");
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `${SHOTS}/users-${locale}-${width}.png`, fullPage: true });
      await page.goto(`/users/${ids.nusrat}`);
      await expect(page.getByRole("heading", { level: 1, name: "Nusrat Jahan" })).toBeVisible();
      await expect(main()).toContainText("n***@e***.org");
      await expectNoHorizontalOverflow(page);
      await expectNoRawContact(page);
      await page.screenshot({ path: `${SHOTS}/user-detail-${locale}-${width}.png`, fullPage: true });
    });
  }
}
