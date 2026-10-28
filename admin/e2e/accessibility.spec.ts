import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/** Milestone 10E — automated accessibility check (axe-core, WCAG 2.1 A/AA rules) of every
 * Admin Panel screen in both languages, at phone and desktop width: every list, every detail
 * page (ids from the seeded data), every "new" form, the sign-in page, the open navigation
 * drawer and an open dialog. A check like this finds the mechanical problems (contrast,
 * names, labels, landmarks, ARIA); it does not replace trying the panel with a keyboard and a
 * screen reader. Runs ONLY on the disposable stack (`e2e/stack/run.sh`); changes nothing. */
const MOBILE = process.env.E2E_ADMIN_MOBILE ?? "";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";

test.skip(!MOBILE || !PASSWORD, "Set E2E_ADMIN_MOBILE and E2E_ADMIN_PASSWORD");
if (process.env.E2E_DISPOSABLE_DB !== "destroy-and-recreate") {
  throw new Error("accessibility.spec.ts needs the seeded disposable database: run it with e2e/stack/run.sh");
}

const LISTS = [
  "/dashboard",
  "/categories",
  "/subjects",
  "/questions",
  "/exams",
  "/attempts",
  "/results",
  "/packages",
  "/subscriptions",
  "/payments",
  "/users",
  "/announcements",
  "/faqs",
  "/pages",
  "/contact-messages",
  "/settings",
  "/audit-log",
];
const NEW_FORMS = ["/questions/new", "/exams/new", "/packages/new"];

let context: BrowserContext;
let page: Page;
const details: string[] = [];

async function audit(where: string) {
  // Measure the settled screen, not a dialog half-way through its fade-in.
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const report = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.target.join(" ")).slice(0, 5).join("\n    ")}`);
  // Soft: report every page's problems in one run instead of stopping at the first.
  expect.soft(report, `${where}\n${report.join("\n")}`).toEqual([]);
}

async function api<T>(path: string): Promise<T> {
  const response = await page.request.get(`/api/v1${path}`, { headers: { Accept: "application/json" } });
  expect(response.status(), path).toBe(200);
  return (await response.json()) as T;
}

async function setLocale(locale: "en" | "bn") {
  await context.addCookies([{ name: "admin_lang", value: locale, url: test.info().project.use.baseURL ?? "http://localhost:8088" }]);
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(MOBILE);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  type Page_<T> = { results: T[] };
  const first = async <T>(path: string) => (await api<Page_<T>>(path)).results[0];
  const question = await first<{ id: number }>("/admin/questions/?page_size=1");
  const exam = await first<{ id: number }>("/admin/exams/?page_size=1");
  const pkg = await first<{ id: number }>("/admin/packages/?page_size=1");
  const attempt = await first<{ attempt_id: string }>("/admin/attempts/?page_size=1");
  const result = await first<{ attempt_id: string }>("/admin/results/?page_size=1");
  const subscription = await first<{ id: number }>("/admin/subscriptions/?page_size=1");
  const payment = await first<{ payment_id: string }>("/admin/payments/?page_size=1");
  const user = await first<{ id: number }>("/admin/users/?page_size=1");
  details.push(
    `/questions/${question.id}`,
    `/exams/${exam.id}`,
    `/packages/${pkg.id}`,
    `/attempts/${attempt.attempt_id}`,
    `/results/${result.attempt_id}`,
    `/subscriptions/${subscription.id}`,
    `/payments/${payment.payment_id}`,
    `/users/${user.id}`,
  );
});

test.afterAll(async () => {
  await context.close(); // run.sh drops this suite's database
});

test("sign-in page (signed out), both languages", async ({ browser }) => {
  for (const locale of ["en", "bn"] as const) {
    const guest = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await guest.addCookies([{ name: "admin_lang", value: locale, url: test.info().project.use.baseURL ?? "http://localhost:8088" }]);
    const signIn = await guest.newPage();
    await signIn.goto("/login");
    const { violations } = await new AxeBuilder({ page: signIn }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect.soft(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), `login ${locale}`).toEqual([]);
    await guest.close();
  }
});

for (const locale of ["en", "bn"] as const) {
  for (const [width, height] of [[1440, 900], [390, 844]] as const) {
    test(`every screen passes in ${locale} at ${width}px`, async () => {
      test.setTimeout(240_000);
      await setLocale(locale);
      await page.setViewportSize({ width, height });
      for (const path of [...LISTS, ...details, ...NEW_FORMS]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        await audit(`${path} (${locale}, ${width}px)`);
      }
    });
  }
}

test("the phone navigation drawer and an open dialog pass", async () => {
  await setLocale("en");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/categories");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await audit("navigation drawer");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  // Open again, then widen the window past the drawer's breakpoint: the drawer closes
  // instead of staying modal (and hiding the page from screen readers) while invisible.
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "New category" }).first().click();
  await expect(page.getByRole("dialog", { name: "New category" })).toBeVisible();
  await audit("new category dialog");
});
