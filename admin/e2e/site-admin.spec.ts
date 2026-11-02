import { expect, request, test, type BrowserContext, type Page } from "@playwright/test";

/** Site settings, the contact inbox and the audit log against the real stack. A visitor
 * message arrives through the PUBLIC contact endpoint (no login, its own request context);
 * the admin resolves it; settings changes reach the public settings API; the audit log
 * shows both changes. Runs ONLY on the disposable stack (`e2e/stack/run.sh`). */
const MOBILE = process.env.E2E_ADMIN_MOBILE ?? "";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";
const SHOTS = process.env.SCREENSHOT_DIR ?? "test-results/screens";
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:8088";

test.skip(!MOBILE || !PASSWORD, "Set E2E_ADMIN_MOBILE and E2E_ADMIN_PASSWORD");
if (process.env.E2E_DISPOSABLE_DB !== "destroy-and-recreate") {
  throw new Error("site-admin.spec.ts needs the seeded disposable database: run it with e2e/stack/run.sh");
}
test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
const main = () => page.getByRole("main");
const row = (text: string) => main().getByRole("table").locator("tbody tr").filter({ hasText: text });

async function expectNoHorizontalOverflow() {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(MOBILE);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test.afterAll(async () => {
  await context.close();
});

test("site settings: saved values reach the public settings API; invalid links are refused", async () => {
  await page.getByRole("link", { name: "Site settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole("group", { name: /Tagline/ }).getByLabel(/English/).fill("E2E practise every day");
  await page.getByLabel(/App download link/).fill("http://not-https.example");
  await page.getByRole("button", { name: "Save settings" }).first().click();
  await expect(page.getByText("Enter a full https:// address.")).toBeVisible();
  await page.getByLabel(/App download link/).fill("https://play.google.com/store/apps/details?id=example.e2e");
  await page.getByLabel("Names on the website leaderboard").selectOption("initials");
  await page.getByRole("button", { name: "Save settings" }).first().click();
  await expect(page.getByText("Settings saved.")).toBeVisible();
  await expect(main()).toContainText("Last saved");
  await page.screenshot({ path: `${SHOTS}/settings-1440.png`, fullPage: true });
  const visitor = await request.newContext({ baseURL: BASE });
  const publicSettings = await (await visitor.get("/api/v1/public/settings/", { headers: { "Accept-Language": "en" } })).json();
  expect(JSON.stringify(publicSettings)).toContain("E2E practise every day");
  await visitor.dispose();
  await page.reload();
  await expect(page.getByRole("group", { name: /Tagline/ }).getByLabel(/English/)).toHaveValue("E2E practise every day");
});

test("contact inbox: a visitor's message arrives as New; the admin resolves it", async () => {
  const visitor = await request.newContext({ baseURL: BASE });
  const sent = await visitor.post("/api/v1/public/contact/", {
    headers: { "Accept-Language": "en" },
    data: { name: "E2E Visitor", email: "visitor@example.org", subject: "E2E question", message: "When is the next model test?" },
  });
  expect(sent.status()).toBe(202);
  await visitor.dispose();

  await page.getByRole("link", { name: "Contact messages" }).click();
  await expect(row("E2E Visitor")).toContainText("New");
  await row("E2E Visitor").getByRole("button", { name: "Open message from E2E Visitor" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Message from E2E Visitor" });
  await expect(dialog).toContainText("When is the next model test?");
  await expect(dialog.getByRole("link", { name: "E-mail: visitor@example.org" })).toHaveAttribute("href", "mailto:visitor@example.org");
  // Opening does not change it (the page behind the dialog is hidden from roles: ask the API).
  const inbox = await (await page.request.get("/api/v1/admin/contact-messages/?search=E2E%20Visitor")).json();
  expect(inbox.results[0].status).toBe("new");
  await page.screenshot({ path: `${SHOTS}/contact-message-1440.png` });
  await dialog.getByRole("button", { name: "Mark resolved" }).click();
  await expect(page.getByText("Marked as Resolved.")).toBeVisible();
  await expect(dialog).toContainText("Last changed by E2E Admin");
  await page.keyboard.press("Escape");
  await expect(row("E2E Visitor")).toContainText("Resolved");
  await page.locator("#filter-status").selectOption("new");
  await expect(main()).toContainText("No messages match these filters");
});

test("audit log: both changes are listed with the admin's name; filters and details", async () => {
  await page.getByRole("link", { name: "Audit log" }).click();
  await expect(page).toHaveURL(/\/audit-log$/);
  const settingsRow = main().getByRole("table").locator("tbody tr").filter({ hasText: "Site settings changed" }).first();
  await expect(settingsRow).toContainText("E2E Admin");
  await expect(main().getByRole("table").locator("tbody tr").filter({ hasText: "Contact message status changed" })).toHaveCount(1);
  await page.locator("#filter-action").selectOption("site_settings.update");
  await expect(page).toHaveURL(/action=site_settings\.update/);
  await expect(main().getByRole("table").locator("tbody tr")).toHaveCount(1);
  await main().getByRole("table").getByRole("button", { name: /Details of entry/ }).click();
  const dialog = page.getByRole("dialog", { name: /Audit entry #/ });
  await expect(dialog).toContainText("E2E practise every day");
  await expect(dialog).toContainText("initials");
  await expect(dialog).toHaveCSS("opacity", "1"); // after the opening fade
  await page.screenshot({ path: `${SHOTS}/audit-details-1440.png` });
  await dialog.getByRole("link", { name: "Open this record" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  const body = await (await page.request.get("/api/v1/admin/audit-logs/?action=site_settings.update")).json();
  expect(body.results[0].actor_name).toBe("E2E Admin");
  expect(await page.request.post("/api/v1/admin/audit-logs/", { data: {} }).then((r) => r.status())).toBe(403); // CSRF first; never writable
});

for (const locale of ["en", "bn"] as const) {
  for (const width of [1440, 390]) {
    test(`visual QA ${locale} at ${width}px`, async () => {
      await context.addCookies([{ name: "admin_lang", value: locale, url: BASE }]);
      await page.setViewportSize({ width, height: width < 800 ? 844 : 900 });
      for (const path of ["/settings", "/contact-messages", "/audit-log"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoHorizontalOverflow();
        await page.screenshot({ path: `${SHOTS}/site-admin${path.replace("/", "-")}-${locale}-${width}.png`, fullPage: true });
      }
    });
  }
}
