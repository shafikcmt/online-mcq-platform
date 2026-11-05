import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/** Website content screens (announcements, FAQ, pages) against the real stack. Each record
 * is created, edited and deleted through the panel; the PUBLIC API then shows what the
 * website would show (drafts, inactive entries and deleted records never appear).
 * Runs ONLY on the disposable stack (`e2e/stack/run.sh`). */
const MOBILE = process.env.E2E_ADMIN_MOBILE ?? "";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";
const SHOTS = process.env.SCREENSHOT_DIR ?? "test-results/screens";

test.skip(!MOBILE || !PASSWORD, "Set E2E_ADMIN_MOBILE and E2E_ADMIN_PASSWORD");
if (process.env.E2E_DISPOSABLE_DB !== "destroy-and-recreate") {
  throw new Error("cms.spec.ts needs the seeded disposable database: run it with e2e/stack/run.sh");
}
test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
const main = () => page.getByRole("main");
const table = () => main().getByRole("table");
const row = (text: string) => table().locator("tbody tr").filter({ hasText: text });

async function publicJson<T>(path: string, lang = "en"): Promise<{ status: number; body: T }> {
  const response = await page.request.get(`/api/v1/public${path}`, { headers: { Accept: "application/json", "Accept-Language": lang } });
  return { status: response.status(), body: (response.status() === 200 ? await response.json() : null) as T };
}

type Item = { title?: string; question?: string };
/** Public lists may be paginated ({results}) or plain arrays. */
type Titled = Item[] | { results?: Item[] };
const titles = (body: Titled) => (Array.isArray(body) ? body : (body.results ?? [])).map((item) => item.title ?? item.question);

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

test("announcements: a draft stays hidden; publishing shows it on the website; delete removes it", async () => {
  await page.getByRole("link", { name: "Announcements" }).click();
  await expect(page).toHaveURL(/\/announcements$/);
  await expect(main()).toContainText("No announcements yet");
  await main().getByRole("button", { name: "New announcement" }).first().click();
  let dialog = page.getByRole("dialog", { name: "New announcement" });
  await dialog.getByRole("button", { name: "Create" }).click();
  // Nothing filled in: the server's pair rule, shown under the title fields.
  await expect(dialog.getByRole("group", { name: /Title/ })).toContainText("Fill in both title and body in at least one language");
  await dialog.getByRole("group", { name: /Title/ }).getByLabel(/English/).fill("E2E holiday notice");
  await dialog.getByRole("group", { name: /Text/ }).getByLabel(/English/).fill("The centre is closed on Friday.");
  await dialog.getByRole("group", { name: /Title/ }).getByLabel(/Bangla/).fill("ই২ই ছুটির নোটিশ");
  await dialog.getByRole("group", { name: /Text/ }).getByLabel(/Bangla/).fill("শুক্রবার কেন্দ্র বন্ধ থাকবে।");
  await dialog.getByLabel("Shown to").selectOption("public");
  await dialog.getByLabel("Visibility").selectOption("draft"); // a new notice is otherwise published at once
  await page.screenshot({ path: `${SHOTS}/announcement-form-1440.png` });
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Announcement created.")).toBeVisible();
  await expect(row("E2E holiday notice")).toContainText("Draft");
  expect(titles((await publicJson<Titled>("/announcements/")).body)).not.toContain("E2E holiday notice");

  await row("E2E holiday notice").getByRole("button", { name: "Edit E2E holiday notice" }).click();
  dialog = page.getByRole("dialog", { name: "Edit announcement" });
  await dialog.getByLabel("Visibility").selectOption("now");
  await dialog.getByRole("switch", { name: /Pin to the top/ }).click();
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Announcement saved.")).toBeVisible();
  await expect(row("E2E holiday notice")).toContainText("Live");
  await expect(row("E2E holiday notice").getByLabel("Pinned")).toBeVisible();
  expect(titles((await publicJson<Titled>("/announcements/")).body)).toContain("E2E holiday notice");
  expect(titles((await publicJson<Titled>("/announcements/", "bn")).body)).toContain("ই২ই ছুটির নোটিশ");
  await page.screenshot({ path: `${SHOTS}/announcements-1440.png`, fullPage: true });

  await row("E2E holiday notice").getByRole("button", { name: "Delete E2E holiday notice" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Announcement deleted.")).toBeVisible();
  await expect(main()).toContainText("No announcements yet");
  expect(titles((await publicJson<Titled>("/announcements/")).body)).not.toContain("E2E holiday notice");
});

test("FAQ: active entries are public in their sort order; inactive ones are hidden", async () => {
  await page.goto("/faqs");
  for (const [question, answer, order] of [
    ["E2E second question?", "Second answer.", "2"],
    ["E2E first question?", "First answer.", "1"],
  ]) {
    await main().getByRole("button", { name: "New question" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New question" });
    await dialog.getByRole("group", { name: /Question/ }).getByLabel(/English/).fill(question);
    await dialog.getByRole("group", { name: /Answer/ }).getByLabel(/English/).fill(answer);
    await dialog.getByLabel(/Sort order/).fill(order);
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("Question added.")).toBeVisible();
    await expect(dialog).toBeHidden();
  }
  expect(titles((await publicJson<Titled>("/faqs/")).body)).toEqual(["E2E first question?", "E2E second question?"]);
  await row("E2E second question?").getByRole("button", { name: "Edit E2E second question?" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit question" });
  await dialog.getByRole("switch", { name: /Active/ }).click();
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(row("E2E second question?")).toContainText("Inactive");
  expect(titles((await publicJson<Titled>("/faqs/")).body)).toEqual(["E2E first question?"]);
  await page.screenshot({ path: `${SHOTS}/faqs-1440.png`, fullPage: true });
});

test("pages: slug address, inactive pages are not public", async () => {
  await page.goto("/pages");
  await main().getByRole("button", { name: "New page" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New page" });
  await dialog.getByLabel(/Slug/).fill("e2e-about");
  await dialog.getByRole("group", { name: /Title/ }).getByLabel(/English/).fill("E2E About us");
  await dialog.getByRole("group", { name: /Text/ }).getByLabel(/English/).fill("Who we are.");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Page created.")).toBeVisible();
  await expect(row("E2E About us")).toContainText("/pages/e2e-about");
  expect((await publicJson<{ title: string }>("/pages/e2e-about/")).body.title).toBe("E2E About us");

  // A second page with the same slug is refused by the server, under the slug field.
  await main().getByRole("button", { name: "New page" }).first().click();
  const duplicate = page.getByRole("dialog", { name: "New page" });
  await duplicate.getByLabel(/Slug/).fill("e2e-about");
  await duplicate.getByRole("group", { name: /Title/ }).getByLabel(/English/).fill("Copy");
  await duplicate.getByRole("group", { name: /Text/ }).getByLabel(/English/).fill("Copy.");
  await duplicate.getByRole("button", { name: "Create" }).click();
  await expect(duplicate.getByText("A page with this slug already exists.")).toBeVisible();
  await duplicate.getByRole("button", { name: "Cancel" }).click();

  await row("E2E About us").getByRole("button", { name: "Edit E2E About us" }).click();
  const edit = page.getByRole("dialog", { name: "Edit page" });
  await edit.getByRole("switch", { name: /Active/ }).click();
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(row("E2E About us")).toContainText("Inactive");
  expect((await publicJson("/pages/e2e-about/")).status).toBe(404);
});

/** Visual QA: the three lists in English and Bangla, desktop and phone width. */
for (const locale of ["en", "bn"] as const) {
  for (const width of [1440, 390]) {
    test(`visual QA ${locale} at ${width}px`, async () => {
      await context.addCookies([{ name: "admin_lang", value: locale, url: test.info().project.use.baseURL ?? "http://localhost:8088" }]);
      await page.setViewportSize({ width, height: width < 800 ? 844 : 900 });
      for (const path of ["/announcements", "/faqs", "/pages"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoHorizontalOverflow();
        await page.screenshot({ path: `${SHOTS}/cms${path.replace("/", "-")}-${locale}-${width}.png`, fullPage: true });
      }
      await page.goto("/faqs");
      await main().getByRole("button", { name: locale === "bn" ? "নতুন প্রশ্ন" : "New question" }).first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toHaveCSS("opacity", "1");
      await expectNoHorizontalOverflow();
      await page.screenshot({ path: `${SHOTS}/cms-faq-form-${locale}-${width}.png` });
      await page.keyboard.press("Escape");
    });
  }
}
