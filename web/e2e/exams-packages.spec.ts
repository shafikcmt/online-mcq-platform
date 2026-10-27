import { expect, test, type Page } from "@playwright/test";

/** The website's Exams list (tabs, filters, pages), exam pages and Packages page on the
 * real backend (E2E seed: three published free exams open any time in "E2E seed
 * category", a draft paid exam, three packages; nothing upcoming or ended).
 * Disposable stack only (admin/e2e/stack/run.sh with E2E_PROJECT_DIR=web). */
if (process.env.E2E_DISPOSABLE_DB !== "destroy-and-recreate") {
  throw new Error("exams-packages.spec.ts needs the disposable stack: run it with admin/e2e/stack/run.sh");
}
const SHOTS = process.env.SCREENSHOT_DIR ?? "e2e/test-results/screens";
const SEEDED = ["E2E seed exam", "E2E Results Physics", "E2E Results Manual"];

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

const cards = (page: Page) => page.getByRole("main").getByRole("listitem").getByRole("heading");

test("the header links to Exams and Packages", async ({ page }) => {
  await page.goto("/en");
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: "Exams" }).click();
  await expect(page).toHaveURL(/\/en\/exams$/);
  await expect(page.getByRole("heading", { level: 1, name: "Exams" })).toBeVisible();
  await nav.getByRole("link", { name: "Packages" }).click();
  await expect(page).toHaveURL(/\/en\/packages$/);
  await expect(page.getByRole("heading", { level: 1, name: "Packages" })).toBeVisible();
});

test("Exams: Open now lists the open exams; Upcoming and Ended say when they are empty", async ({ page }) => {
  await page.goto("/en/exams");
  const tabs = page.getByRole("navigation", { name: "Schedule" });
  await expect(tabs.getByRole("link", { name: "Open now" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("3 exams")).toBeVisible();
  await expect(cards(page)).toHaveText(SEEDED); // all unscheduled: in creation order
  await expect(page.getByText("E2E Paid Mock")).toHaveCount(0); // a draft is never public

  await tabs.getByRole("link", { name: "Upcoming" }).click();
  await expect(page).toHaveURL(/\/en\/exams\?when=upcoming$/);
  await expect(page.getByText("No upcoming exams yet.")).toBeVisible();
  await tabs.getByRole("link", { name: "Ended" }).click();
  await expect(page.getByText("No ended exams yet.")).toBeVisible();
  // The Bangla page, with Bangla digits.
  await page.goto("/bn/exams");
  await expect(page.getByText("৩টি পরীক্ষা")).toBeVisible();
  await expect(cards(page).filter({ hasText: "ই২ই পরীক্ষা" })).toBeVisible();
});

test("filters live in the address, work without JavaScript and can be cleared", async ({ browser }) => {
  const page = await (await browser.newContext({ javaScriptEnabled: false })).newPage();
  await page.goto("/en/exams");
  const form = page.getByRole("form", { name: "Filter exams" });
  await form.getByLabel("Category").selectOption({ label: "E2E seed category" });
  await form.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/category=e2e-seed/);
  await expect(page.getByText("3 exams")).toBeVisible();

  await page.getByRole("form", { name: "Filter exams" }).getByLabel("Type").selectOption({ label: "Live" });
  await page.getByRole("form", { name: "Filter exams" }).getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/type=live/);
  await expect(page.getByText("No exams match these filters.")).toBeVisible();
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/en\/exams$/);
  await expect(page.getByText("3 exams")).toBeVisible();

  await page.goto("/en/exams?access=paid");
  await expect(page.getByText("No exams match these filters.")).toBeVisible();
  // Unknown values are ignored (never an error page); a page past the end is just empty.
  await page.goto("/en/exams?when=soon&type=marathon&category=../x");
  await expect(page.getByText("3 exams")).toBeVisible();
  await page.goto("/en/exams?page=9");
  await expect(page.getByText("No exams are open right now.")).toBeVisible();
  // Filtered views are not indexed; the plain list is.
  await page.goto("/en/exams?type=live");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await page.goto("/en/exams");
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://livemodeltest.com/en/exams");
});

test("an exam's page: rules, schedule and the way to the app — in both languages", async ({ page }) => {
  await page.goto("/en/exams");
  await page.getByRole("link", { name: "E2E seed exam" }).click();
  await expect(page).toHaveURL(/\/en\/exams\/[a-z0-9-]+$/);
  const path = new URL(page.url()).pathname.replace(/^\/en/, "");
  await expect(page.getByRole("heading", { level: 1, name: "E2E seed exam" })).toBeVisible();
  await expect(page).toHaveTitle("E2E seed exam | Live Model Test");
  const facts = page.getByRole("region", { name: "Exam details" });
  await expect(facts.getByText("30 min")).toBeVisible();
  await expect(facts.getByText("Bangla and English")).toBeVisible();
  await expect(page.getByRole("region", { name: "Schedule" }).getByText("Available any time")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Take this exam in the app" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Coming soon to Google Play" }).last()).toHaveAttribute("href", "/en#get-app");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://livemodeltest.com/en${path}`);
  await expect(page.locator('link[rel="alternate"][hreflang="bn-BD"]')).toHaveAttribute("href", `https://livemodeltest.com/bn${path}`);
  // No question or answer data is anywhere on the page.
  expect(await page.content()).not.toMatch(/E2E seed exam Q|is_correct|Option 0/);

  await page.goto(`/bn${path}`);
  await expect(page.getByRole("heading", { level: 1, name: "ই২ই পরীক্ষা" })).toBeVisible();
  await expect(page.getByRole("region", { name: "পরীক্ষার তথ্য" }).getByText("৩০ মিনিট")).toBeVisible();
  await page.getByRole("link", { name: "পরীক্ষা" }).first().click();
  await expect(page).toHaveURL(/\/bn(\/exams)?$/);
});

test("an unknown or draft exam, and any unknown page, is a localized 404", async ({ page }) => {
  for (const [path, title] of [
    ["/en/exams/no-such-exam", "Page not found"],
    ["/en/exams/e2e-paid-mock", "Page not found"], // drafts are not public
    ["/bn/exams/Bad_Slug!", "পাতাটি পাওয়া যায়নি"],
    ["/en/nothing/here", "Page not found"],
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByRole("navigation", { name: /^(Main|প্রধান মেনু)$/ })).toBeAttached(); // inside the site
  }
});

test("Packages: every package, how buying works, and the paid exams", async ({ page }) => {
  await page.goto("/en/packages");
  const list = page.getByRole("region", { name: "Packages" });
  await expect(list.getByRole("heading")).toHaveText(["E2E Gold", "E2E Silver", "E2E Unused"]);
  await expect(list.getByText("৳500")).toBeVisible();
  await expect(list.getByText("Popular")).toBeVisible();
  await expect(list.getByText("Merit lists")).toBeVisible();
  await expect(page.getByRole("region", { name: "How to buy a package" }).getByRole("listitem")).toHaveCount(3);
  await page.getByRole("link", { name: "See paid exams" }).click();
  await expect(page).toHaveURL(/\/en\/exams\?access=paid$/);
  await page.goto("/bn/packages");
  await expect(page.getByRole("region", { name: "প্যাকেজ" }).getByText("৳৫০০")).toBeVisible();
});

test("Home links to all exams and all packages; the sitemap lists the new pages", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("link", { name: "See all exams" }).click();
  await expect(page).toHaveURL(/\/en\/exams$/);
  await page.goto("/en");
  await page.getByRole("link", { name: "See all packages" }).click();
  await expect(page).toHaveURL(/\/en\/packages$/);
  const sitemap = await (await page.request.get("/sitemap.xml")).text();
  for (const url of ["/bn/exams", "/en/exams", "/bn/packages", "/en/packages"]) expect(sitemap).toContain(`https://livemodeltest.com${url}<`);
  expect(sitemap).toMatch(/https:\/\/livemodeltest\.com\/en\/exams\/[a-z0-9-]+</); // each exam's page
});

for (const [width, height] of [[360, 780], [1280, 900]] as const) {
  test(`responsive at ${width}px: exams, an exam and packages in both languages`, async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
    await page.goto("/en/exams");
    const href = await page.getByRole("link", { name: "E2E seed exam" }).getAttribute("href");
    const examPath = href!.replace(/^\/en/, "");
    for (const lang of ["bn", "en"] as const) {
      for (const [name, path] of [["exams", "/exams"], ["exam", examPath], ["packages", "/packages"]] as const) {
        await page.goto(`/${lang}${path}`);
        await noHorizontalOverflow(page);
        await page.screenshot({ path: `${SHOTS}/web-${name}-${lang}-${width}.png`, fullPage: true });
      }
    }
  });
}
