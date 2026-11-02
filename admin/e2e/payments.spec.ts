import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/** Milestone 7H — read-only Payments against the real stack. Uses the payments seeded by
 * `e2e/stack/seed.py` through the normal payment services and the MOCK provider: Tanvir
 * Ahmed — two successful E2E Gold payments renewing ONE subscription; মাহমুদা আক্তার —
 * E2E Silver failed; Rafiq Islam — E2E Silver cancelled and E2E Gold still pending.
 * Runs ONLY on the disposable stack (`e2e/stack/run.sh`). The panel's only payment action
 * is "Re-verify with provider" (never for a successful payment); the last test uses it on
 * the pending payment — the mock provider's answer changes nothing, and a second attempt
 * right away is refused by the server's cooldown.
 * Pagination needs more rows than the smallest page size (10): Vitest covers it. */
const MOBILE = process.env.E2E_ADMIN_MOBILE ?? "";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";
const SHOTS = process.env.SCREENSHOT_DIR ?? "test-results/screens";

test.skip(!MOBILE || !PASSWORD, "Set E2E_ADMIN_MOBILE and E2E_ADMIN_PASSWORD");
if (process.env.E2E_DISPOSABLE_DB !== "destroy-and-recreate") {
  throw new Error("payments.spec.ts needs the seeded disposable database: run it with e2e/stack/run.sh");
}
test.describe.configure({ mode: "serial" });

type Row = {
  payment_id: string;
  merchant_reference: string;
  user: { id: number; full_name: string };
  package: { id: number; slug: string };
  subscription_id: number | null;
  status: string;
  created_at: string;
};

let context: BrowserContext;
let page: Page;
const seed = {
  rows: [] as Row[],
  first: null as unknown as Row, // Tanvir's first verified payment
  renewal: null as unknown as Row,
  failed: null as unknown as Row,
  cancelled: null as unknown as Row,
  pending: null as unknown as Row,
};
const RAW_MOBILES = ["01700000102", "1700000102", "01700000103", "01700000104"];
// Values stored on the payment or its events that must never reach the panel: the mock
// provider's session key (provider_payment_id), its validation tokens and raw keys.
const FORBIDDEN = ["MOCKSESSION", "MOCKVAL", "raw_verification", "payload", "source_ip", "provider_payment_id", "checkout_url", "idempotency_key", "mobile_number", "127.0.0.1"];

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

async function expectNothingRaw(target: Page) {
  const html = await target.content();
  for (const value of [...RAW_MOBILES, "MOCKSESSION", "MOCKVAL", "raw_verification", "source_ip", "127.0.0.1"]) {
    expect(html).not.toContain(value);
  }
}

const main = () => page.getByRole("main");
const table = () => main().getByRole("table", { name: "Payments" });
const bodyRows = () => table().locator("tbody tr");
const filters = () => main().getByRole("group", { name: "Filters" });
const searchBox = () => main().getByRole("searchbox", { name: "Exact reference or transaction ID" });
const ref = (row: Row) => row.merchant_reference;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  await signIn(page);
  const rows = (JSON.parse(await apiText("/admin/payments/?page_size=100&ordering=created_at")) as { results: Row[] }).results;
  expect(rows).toHaveLength(5);
  seed.rows = rows;
  [seed.first, seed.renewal] = rows.filter((row) => row.status === "success");
  seed.failed = rows.find((row) => row.status === "failed")!;
  seed.cancelled = rows.find((row) => row.status === "cancelled")!;
  seed.pending = rows.find((row) => row.status === "pending")!;
});

test.afterAll(async () => {
  await context.close(); // run.sh drops this suite's database
});

test("the API itself returns only allow-listed data (list and every detail)", async () => {
  const paths = ["/admin/payments/", ...seed.rows.map((row) => `/admin/payments/${row.payment_id}/`)];
  for (const path of paths) {
    const body = await apiText(path);
    for (const value of [...FORBIDDEN, ...RAW_MOBILES]) expect(body, `${path} ${value}`).not.toContain(value);
    expect(body).toContain("mobile_display");
  }
  const list = await apiText("/admin/payments/");
  expect(list).not.toContain("provider_transaction_id");
  const detail = JSON.parse(await apiText(`/admin/payments/${seed.first.payment_id}/`));
  expect(detail.provider_transaction_id).toMatch(/^MOCKTXN/);
  expect(detail.verification).toEqual({ provider_status: "VALID", risk_level: null, card_brand: null, validated_on: null });
  expect(detail.events_total).toBe(detail.events.length);
  expect(detail.validity_days).toBe(30); // E2E Gold's validity at checkout
  // The renewal: both verified payments point at the same subscription.
  expect(seed.first.subscription_id).not.toBeNull();
  expect(seed.renewal.subscription_id).toBe(seed.first.subscription_id);
});

test("list: newest first, masked mobiles, server statuses and reasons, no transaction IDs, read-only", async () => {
  await page.getByRole("link", { name: "Payments" }).click();
  await expect(page).toHaveURL(/\/payments$/);
  await expect(page.getByRole("heading", { level: 1, name: "Payments" })).toBeVisible();
  await expect(bodyRows()).toHaveCount(5);
  const newest = bodyRows().nth(0);
  await expect(newest).toContainText(ref(seed.pending));
  await expect(newest).toContainText("Rafiq Islam");
  await expect(newest).toContainText("+88017*****104");
  await expect(newest).toContainText("Pending");
  await expect(newest).toContainText("E2E Gold");
  await expect(newest).toContainText("৳ 500.00");
  await expect(newest).toContainText("Mock (development)");
  const failed = bodyRows().filter({ hasText: ref(seed.failed) });
  await expect(failed).toContainText("মাহমুদা আক্তার");
  await expect(failed).toContainText("Failed");
  await expect(failed).toContainText("Reason: Failed"); // the mock sends no reason: the server stores "failed"
  await expect(failed).toContainText("৳ 250.00");
  await expect(bodyRows().filter({ hasText: ref(seed.cancelled) })).toContainText("Cancelled");
  const success = bodyRows().filter({ hasText: ref(seed.first) });
  await expect(success).toContainText("Successful");
  await expect(success).toContainText("Verified");
  await expect(table()).not.toContainText("MOCKTXN");
  await expect(main().getByRole("button", { name: /re-?verify|mark|retry|refund|delete|reconcile/i })).toHaveCount(0);
  await expectNothingRaw(page);
  await page.screenshot({ path: `${SHOTS}/payments-list-1440.png`, fullPage: true });
});

test("exact reference search only", async () => {
  await searchBox().fill(ref(seed.failed));
  await searchBox().press("Enter");
  await expect(page).toHaveURL(new RegExp(`search=${ref(seed.failed)}`));
  await expect(bodyRows()).toHaveCount(1);
  await expect(bodyRows().first()).toContainText("মাহমুদা আক্তার");
  await searchBox().fill(ref(seed.failed).slice(0, -3)); // partial → nothing
  await searchBox().press("Enter");
  await expect(main()).toContainText("No payments match these filters");
  await expect(main()).toContainText("Search needs the exact reference or transaction ID.");
  await searchBox().fill("Rafiq"); // names are never searched
  await searchBox().press("Enter");
  await expect(main()).toContainText("No payments match these filters");
  await page.goto("/payments");
  await expect(bodyRows()).toHaveCount(5);
});

test("status and provider filters, sorting, back/forward", async () => {
  await page.locator("#filter-status").selectOption("success");
  await expect(page).toHaveURL(/status=success/);
  await expect(bodyRows()).toHaveCount(2);
  await page.locator("#filter-provider").selectOption("sslcommerz");
  await expect(page).toHaveURL(/provider=sslcommerz/);
  await expect(main()).toContainText("No payments match these filters");
  await page.locator("#filter-provider").selectOption("mock");
  await expect(bodyRows()).toHaveCount(2);
  await page.goto("/payments");
  await page.locator("#filter-ordering").selectOption("amount");
  await expect(page).toHaveURL(/ordering=amount/);
  await expect(bodyRows().first()).toContainText("৳ 250.00");
  await page.locator("#filter-ordering").selectOption("-verified_at");
  await expect(page).toHaveURL(/ordering=-verified_at/);
  await expect(bodyRows().first()).toContainText(ref(seed.renewal)); // newest verified
  await expect(bodyRows().nth(1)).toContainText(ref(seed.first));
  await expect(bodyRows().nth(2)).not.toContainText("Successful"); // unverified last
  await page.locator("#filter-ordering").selectOption("verified_at");
  await expect(bodyRows().first()).toContainText(ref(seed.first));
  await expect(bodyRows().last()).not.toContainText("Successful"); // still last
  await page.goBack();
  await expect(page).toHaveURL(/ordering=-verified_at/);
  await expect(bodyRows().first()).toContainText(ref(seed.renewal));
  await page.goForward();
  await expect(bodyRows().first()).toContainText(ref(seed.first));
  await page.goto("/payments");
});

test("student and package pickers; chips name them from the server", async () => {
  await page.getByRole("button", { name: "Choose package" }).click();
  const packages = page.getByRole("dialog", { name: "Choose a package" });
  await packages.getByRole("searchbox").fill("gold");
  await packages.getByRole("button", { name: "Show payments for E2E Gold" }).click();
  await expect(page).toHaveURL(new RegExp(`package=${seed.first.package.id}`));
  await expect(filters()).toContainText("Package: E2E Gold");
  await expect(bodyRows()).toHaveCount(3); // Tanvir ×2 + Rafiq pending
  await page.getByRole("button", { name: "Choose student" }).click();
  const students = page.getByRole("dialog", { name: "Choose a student" });
  await students.getByRole("searchbox").fill("tanvir");
  await students.getByRole("button", { name: "Show payments of Tanvir Ahmed" }).click();
  await expect(filters()).toContainText("Student: Tanvir Ahmed");
  await expect(bodyRows()).toHaveCount(2);
  await page.getByRole("button", { name: "Show all packages" }).click();
  await expect(bodyRows()).toHaveCount(2);
  await page.getByRole("button", { name: "Show all students" }).click();
  await expect(page).toHaveURL(/\/payments$/);
  await expect(bodyRows()).toHaveCount(5);
});

test("detail: safe provider summary, masked student, timeline, links, no actions", async () => {
  await bodyRows()
    .filter({ hasText: ref(seed.first) })
    .getByRole("link", { name: `Open payment ${ref(seed.first)}` })
    .click();
  await expect(page).toHaveURL(new RegExp(`/payments/${seed.first.payment_id}$`));
  await expect(page.getByRole("heading", { level: 1, name: ref(seed.first) })).toBeVisible();
  const summary = main().getByRole("region", { name: "Payment" });
  await expect(summary).toContainText("Successful");
  await expect(summary).toContainText("৳ 500.00");
  await expect(summary).toContainText("Validity bought30 days"); // the checkout snapshot
  const who = main().getByRole("region", { name: "Student and package" });
  await expect(who).toContainText("+88017*****102");
  await expect(who).toContainText("Partly hidden");
  const provider = main().getByRole("region", { name: "Provider" });
  await expect(provider).toContainText("MOCKTXN");
  await expect(provider).toContainText("VALID");
  await expect(provider).toContainText("Only a short, safe summary of the provider's answer is shown.");
  const timeline = main().getByRole("region", { name: "Timeline" });
  await expect(timeline.getByRole("listitem").first()).toContainText("Payment started");
  await expect(timeline).toContainText("Pending → Successful");
  await expect(timeline).toContainText("Browser returned from the provider");
  await expect(timeline).toContainText("Outcome: Paid");
  await expect(timeline).toContainText(/events, oldest first\./);
  await expect(main().getByRole("button")).toHaveCount(0);
  await expectNothingRaw(page);
  await page.screenshot({ path: `${SHOTS}/payment-detail-1440.png`, fullPage: true });
  await who.getByRole("link", { name: "E2E Gold" }).click();
  await expect(page).toHaveURL(new RegExp(`/packages/${seed.first.package.id}$`));
  await page.goBack();
  await main().getByRole("region", { name: "Student and package" }).getByRole("link", { name: "Tanvir Ahmed" }).click();
  await expect(page).toHaveURL(new RegExp(`/users/${seed.first.user.id}$`));
  await page.goBack();
});

test("payment → subscription → its payments (the renewal: two payments, one subscription)", async () => {
  const subscriptionId = seed.first.subscription_id!;
  await main()
    .getByRole("region", { name: "Student and package" })
    .getByRole("link", { name: `Subscription #${subscriptionId}` })
    .click();
  await expect(page).toHaveURL(new RegExp(`/subscriptions/${subscriptionId}$`));
  await main().getByRole("link", { name: "View payments" }).click();
  await expect(page).toHaveURL(new RegExp(`/payments\\?subscription=${subscriptionId}$`));
  await expect(filters()).toContainText(`Subscription: #${subscriptionId} · Tanvir Ahmed · E2E Gold`);
  await expect(bodyRows()).toHaveCount(2);
  await expect(table()).toContainText(ref(seed.first));
  await expect(table()).toContainText(ref(seed.renewal));
  await page.getByRole("button", { name: "Show payments of all subscriptions" }).click();
  await expect(page).toHaveURL(/\/payments$/);
});

test("an open payment has no subscription, transaction ID or verification", async () => {
  await page.goto(`/payments/${seed.pending.payment_id}`);
  const who = main().getByRole("region", { name: "Student and package" });
  await expect(who).toContainText("No linked subscription");
  await expect(who.getByRole("link", { name: /Subscription #/ })).toHaveCount(0);
  await expect(main().getByRole("region", { name: "Payment" })).toContainText("Not verified");
  const provider = main().getByRole("region", { name: "Provider" });
  await expect(provider).toContainText("None yet");
  await expect(provider).toContainText("No verification answer stored yet.");
  await expectNothingRaw(page);
});

test("User detail and Package detail → View payments", async () => {
  await page.goto(`/users/${seed.first.user.id}`);
  const card = main().getByRole("region", { name: "Activity" }).getByRole("listitem").filter({ hasText: "Payments" });
  await expect(card).toContainText("2");
  await card.getByRole("link", { name: "View payments" }).click();
  await expect(page).toHaveURL(new RegExp(`/payments\\?user=${seed.first.user.id}$`));
  await expect(filters()).toContainText("Student: Tanvir Ahmed");
  await expect(bodyRows()).toHaveCount(2);
  await page.goto(`/packages/${seed.failed.package.id}`);
  await main().getByRole("link", { name: "View payments" }).click();
  await expect(page).toHaveURL(new RegExp(`/payments\\?package=${seed.failed.package.id}$`));
  await expect(filters()).toContainText("Package: E2E Silver");
  await expect(bodyRows()).toHaveCount(2); // failed + cancelled
});

test("unknown or malformed payment address → not found", async () => {
  for (const path of ["/payments/00000000-0000-0000-0000-000000000000", "/payments/abc"]) {
    await page.goto(path);
    await expect(page.getByText("This item no longer exists. It may have been deleted by someone else.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to payments" })).toHaveAttribute("href", "/payments");
  }
});

/** Visual QA: list and detail at four widths, English and Bangla. */
for (const locale of ["en", "bn"] as const) {
  for (const width of [1440, 1280, 768, 390]) {
    test(`visual QA ${locale} at ${width}px`, async () => {
      await context.addCookies([{ name: "admin_lang", value: locale, url: test.info().project.use.baseURL ?? "http://localhost:8088" }]);
      await page.setViewportSize({ width, height: width < 800 ? 844 : 900 });
      await page.goto("/payments");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(main()).toContainText("মাহমুদা আক্তার");
      await expect(main()).toContainText(ref(seed.pending));
      await expectNoHorizontalOverflow(page);
      await expectNothingRaw(page);
      await page.screenshot({ path: `${SHOTS}/payments-${locale}-${width}.png`, fullPage: true });
      await page.goto(`/payments/${seed.first.payment_id}`);
      await expect(page.getByRole("heading", { level: 1, name: ref(seed.first) })).toBeVisible();
      await expect(main()).toContainText(locale === "bn" ? "টাইমলাইন" : "Timeline");
      await expectNoHorizontalOverflow(page);
      await expectNothingRaw(page);
      await page.screenshot({ path: `${SHOTS}/payment-${locale}-${width}.png`, fullPage: true });
    });
  }
}

test("re-verify the pending payment: confirm, provider answer applied, then the cooldown", async () => {
  await context.addCookies([{ name: "admin_lang", value: "en", url: test.info().project.use.baseURL ?? "http://localhost:8088" }]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/payments/${seed.first.payment_id}`);
  await expect(main().getByRole("button", { name: "Re-verify with provider" })).toHaveCount(0); // successful = final
  await page.goto(`/payments/${seed.pending.payment_id}`);
  await main().getByRole("button", { name: "Re-verify with provider" }).click();
  let dialog = page.getByRole("alertdialog", { name: "Ask the provider again?" });
  await expect(dialog).toContainText("The server asks Mock (development) for this payment");
  await dialog.getByRole("button", { name: "Ask the provider" }).click();
  await expect(page.getByText("The provider's answer did not change this payment.")).toBeVisible();
  await expect(main().getByRole("region", { name: "Timeline" })).toContainText(/Admin re-?verif/i);
  await main().getByRole("button", { name: "Re-verify with provider" }).click();
  dialog = page.getByRole("alertdialog", { name: "Ask the provider again?" });
  await dialog.getByRole("button", { name: "Ask the provider" }).click();
  await expect(dialog.getByRole("alert")).toContainText(/checked with the provider moments ago\. Try again in \d+ seconds\./);
  await page.screenshot({ path: `${SHOTS}/payment-reverify-cooldown-1440.png` });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  const detail = JSON.parse(await apiText(`/admin/payments/${seed.pending.payment_id}/`)) as { status: string; events: { event_type: string }[] };
  expect(detail.status).toBe("pending");
  expect(detail.events.filter((event) => event.event_type === "admin_reverify")).toHaveLength(1);
});
