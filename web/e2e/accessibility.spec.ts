import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** Automated accessibility check (axe-core, WCAG 2.1 A/AA rules) of every website page in
 * both languages, at phone and desktop width — the phone menu and the contact form's error
 * state included. A check like this finds the mechanical problems (contrast, names, labels,
 * landmarks, heading order…); it does not replace trying the site with a keyboard and a
 * screen reader. Disposable stack only (admin/e2e/stack/run.sh with E2E_PROJECT_DIR=web). */
if (process.env.E2E_DISPOSABLE_DB !== "destroy-and-recreate") {
  throw new Error("accessibility.spec.ts needs the disposable stack: run it with admin/e2e/stack/run.sh");
}

const PAGES = ["", "/exams", "/exams?when=upcoming", "/exams/e2e-results-physics", "/exams/e2e-results-physics/leaderboard", "/packages", "/leaderboard", "/notices", "/about", "/faq", "/contact", "/no-such-page"];

async function audit(page: Page, where: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const report = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.target.join(" ")).slice(0, 5).join("\n    ")}`);
  expect(report, `${where}\n${report.join("\n")}`).toEqual([]);
}

for (const [width, height] of [[390, 844], [1280, 900]] as const) {
  for (const lang of ["bn", "en"] as const) {
    test(`every page passes at ${width}px in ${lang}`, async ({ browser }) => {
      const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
      for (const path of PAGES) {
        await page.goto(`/${lang}${path}`);
        await audit(page, `/${lang}${path} at ${width}px`);
      }
    });
  }
}

test("the phone menu and the contact form's error state pass", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await page.goto("/en");
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
  await audit(page, "phone menu");
  await page.goto("/bn/contact");
  await page.locator("form").getByRole("button", { name: "বার্তা পাঠান" }).click();
  await expect(page.locator("form").getByRole("alert")).toBeVisible();
  await audit(page, "contact form errors");
});
