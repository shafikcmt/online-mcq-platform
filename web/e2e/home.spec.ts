import { expect, test, type Page } from "@playwright/test";

/** The public website's foundation and Home page on the real backend (E2E seed: three
 * free exams open now, three packages, no notices or FAQs, empty site settings).
 * Disposable stack only (admin/e2e/stack/run.sh with E2E_PROJECT_DIR=web). */
if (process.env.E2E_DISPOSABLE_DB !== "destroy-and-recreate") {
  throw new Error("home.spec.ts needs the disposable stack: run it with admin/e2e/stack/run.sh");
}
const SHOTS = process.env.SCREENSHOT_DIR ?? "e2e/test-results/screens";

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

test("/ goes to Bangla by default and to English for an English browser; the choice is remembered", async ({ browser }) => {
  const bangla = await (await browser.newContext({ locale: "bn-BD" })).newPage();
  await bangla.goto("/");
  await expect(bangla).toHaveURL(/\/bn$/);
  const english = await (await browser.newContext({ locale: "en-GB" })).newPage();
  await english.goto("/");
  await expect(english).toHaveURL(/\/en$/);
  await english.getByRole("navigation", { name: "Language" }).first().getByRole("link", { name: "বাংলা" }).click();
  await expect(english).toHaveURL(/\/bn$/);
  await english.goto("/");
  await expect(english).toHaveURL(/\/bn$/); // the saved choice wins over the browser
});

test("SEO basics: lang, title, description, canonical and hreflang", async ({ page }) => {
  await page.goto("/en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("Live Model Test — online model tests and live exams");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Practice model tests/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://livemodeltest.com/en");
  await expect(page.locator('link[rel="alternate"][hreflang="bn-BD"]')).toHaveAttribute("href", "https://livemodeltest.com/bn");
  await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute("href", "https://livemodeltest.com/bn");
  await page.goto("/bn");
  await expect(page.locator("html")).toHaveAttribute("lang", "bn");
  const robots = await page.request.get("/robots.txt");
  expect(await robots.text()).toContain("Sitemap: https://livemodeltest.com/sitemap.xml");
  const sitemap = await (await page.request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("https://livemodeltest.com/bn");
  expect(sitemap).toContain("https://livemodeltest.com/en");
});

test("Home shows live data from the API: open exams and packages; empty sections say so", async ({ page }) => {
  await page.goto("/en");
  const exams = page.getByRole("region", { name: "Exams" });
  await expect(exams.getByRole("heading", { name: "E2E seed exam" })).toBeVisible();
  await expect(exams.getByRole("heading", { name: "E2E Results Physics" })).toBeVisible();
  await expect(exams.getByText("E2E Paid Mock")).toHaveCount(0); // a draft is never public
  const packages = page.getByRole("region", { name: "Packages" });
  await expect(packages.getByText("৳500")).toBeVisible();
  await expect(packages.getByText("Popular")).toBeVisible();
  await expect(page.getByRole("region", { name: "Latest notices" }).getByText("No notices right now.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Common questions" })).toHaveCount(0); // no FAQs yet
  // No store link set yet: the button says so and leads to the "coming soon" section.
  await expect(page.getByRole("link", { name: "Coming soon to Google Play" }).first()).toHaveAttribute("href", "/en#get-app");
});

for (const [width, height] of [[360, 780], [768, 1024], [1280, 900]] as const) {
  test(`responsive at ${width}px in both languages`, async ({ browser }) => {
    for (const lang of ["bn", "en"] as const) {
      const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
      await page.goto(`/${lang}`);
      await noHorizontalOverflow(page);
      await page.screenshot({ path: `${SHOTS}/web-home-${lang}-${width}.png`, fullPage: true });
      await page.close();
    }
  });
}

test("phone menu: opens, closes with Escape, focus returns; the skip link comes first", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await page.goto("/en");
  await page.getByRole("button", { name: "Menu" }).click();
  const dialog = page.getByRole("dialog", { name: "Menu" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Home" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Menu" })).toBeFocused(); // focus returns to the button
  await page.goto("/en");
  await page.keyboard.press("Tab"); // the first stop on a fresh page
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
});
