import { expect, test, type Page } from "@playwright/test";

import { adminSession } from "./support";

/** The website's Notices, Leaderboard and an exam's merit list on the real backend.
 * Before any page is read, an admin (through the Admin API, as in the Admin Panel)
 * publishes a website notice, a students-only notice and generates the merit list of
 * "E2E Results Physics" (seed: 4 students, 3 / 2 / 1 / 0 correct). "E2E Results Manual"
 * keeps its results hidden, so it has no public merit list.
 * Disposable stack only (admin/e2e/stack/run.sh with E2E_PROJECT_DIR=web). */
if (process.env.E2E_DISPOSABLE_DB !== "destroy-and-recreate") {
  throw new Error("notices-leaderboard.spec.ts needs the disposable stack: run it with admin/e2e/stack/run.sh");
}
const SHOTS = process.env.SCREENSHOT_DIR ?? "e2e/test-results/screens";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const admin = await adminSession();
  const minuteAgo = new Date(Date.now() - 60_000).toISOString();
  await admin.post("/admin/announcements/", {
    title_en: "Physics results are out",
    title_bn: "পদার্থবিজ্ঞানের ফলাফল প্রকাশিত",
    body_en: "See the merit list on the website.\nCongratulations to everyone.",
    body_bn: "ওয়েবসাইটে মেধা তালিকা দেখুন।\nসবাইকে অভিনন্দন।",
    audience: "public",
    is_pinned: true,
    published_at: minuteAgo,
  });
  await admin.post("/admin/announcements/", {
    title_en: "Students only notice",
    title_bn: "শুধু শিক্ষার্থীদের নোটিশ",
    body_en: "Only in the app.",
    body_bn: "শুধু অ্যাপে।",
    audience: "students",
    published_at: minuteAgo,
  });
  const exams = (await admin.get("/admin/exams/?search=E2E%20Results%20Physics")) as { results: { id: number; title_en: string }[] };
  const physics = exams.results.find((exam) => exam.title_en === "E2E Results Physics");
  expect(physics).toBeTruthy();
  await admin.post(`/admin/exams/${physics!.id}/merit/generate/`);
  await admin.api.dispose();
});

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

test("Notices: website notices with their full text, pinned first; app-only notices stay out", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Notices" }).click();
  await expect(page).toHaveURL(/\/en\/notices$/);
  await expect(page.getByRole("heading", { level: 1, name: "Notices" })).toBeVisible();
  const notice = page.getByRole("article").filter({ hasText: "Physics results are out" });
  await expect(notice.getByText("Pinned")).toBeVisible();
  await expect(notice.getByText("Congratulations to everyone.")).toBeVisible();
  await expect(page.getByText("Students only notice")).toHaveCount(0);
  await page.goto("/bn/notices");
  await expect(page.getByRole("heading", { level: 2, name: "পদার্থবিজ্ঞানের ফলাফল প্রকাশিত" })).toBeVisible();
  await expect(page.getByText("পিন করা")).toBeVisible();
});

test("Leaderboard lists only exams with a public merit list", async ({ page }) => {
  await page.goto("/en/leaderboard");
  await expect(page.getByRole("heading", { level: 1, name: "Leaderboard" })).toBeVisible();
  const cards = page.getByRole("main").getByRole("heading", { level: 2 });
  await expect(cards).toHaveText(["E2E Results Physics"]); // not the hidden-results or untaken exams
  await expect(page.getByText("4 on the merit list")).toBeVisible();
  await page.getByRole("link", { name: "E2E Results Physics" }).click();
  await expect(page).toHaveURL(/\/en\/exams\/e2e-results-physics\/leaderboard$/);
});

test("an exam's merit list: positions, shortened names, marks and time — never contact details", async ({ page }) => {
  await page.goto("/en/exams/e2e-results-physics/leaderboard");
  await expect(page).toHaveTitle("Merit list: E2E Results Physics | Live Model Test");
  const table = page.getByRole("table", { name: "Merit list: E2E Results Physics" });
  const rows = table.getByRole("row");
  await expect(rows).toHaveCount(5); // header + 4 students
  await expect(rows.nth(1).getByRole("cell").first()).toHaveText("1");
  await expect(rows.nth(1).getByRole("rowheader")).toHaveText("Aye*** S.");
  await expect(rows.nth(1)).toContainText("3 / 3");
  await expect(rows.nth(1)).toContainText("100%");
  await expect(rows.nth(2).getByRole("rowheader")).toHaveText("Tan*** A.");
  await expect(page.getByText("Names are shortened to protect students' privacy.")).toBeVisible();
  const html = await page.content();
  for (const secret of ["Ayesha Siddika", "Tanvir Ahmed", "Rafiq Islam", "0170000010", "+880"]) expect(html).not.toContain(secret);

  await page.goto("/bn/exams/e2e-results-physics/leaderboard");
  await expect(page.getByRole("table").getByRole("row").nth(1)).toContainText("৩ / ৩");
  await expect(page.getByRole("table").getByRole("row").nth(1)).toContainText("১০০%");
});

test("the exam page links to its merit list; an exam without one says so", async ({ page }) => {
  await page.goto("/en/exams/e2e-results-physics");
  await page.getByRole("link", { name: "View the merit list" }).click();
  await expect(page).toHaveURL(/\/en\/exams\/e2e-results-physics\/leaderboard$/);
  await page.goto("/en/exams/e2e-results-manual");
  await expect(page.getByRole("link", { name: "View the merit list" })).toHaveCount(0);
  const response = await page.goto("/en/exams/e2e-results-manual/leaderboard");
  expect(response?.status()).toBe(200); // the exam exists; its list is just not public
  await expect(page.getByText("The merit list for this exam isn't public yet.")).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  expect((await page.goto("/en/exams/no-such-exam/leaderboard"))?.status()).toBe(404);
});

test("the sitemap lists Notices and Leaderboard", async ({ page }) => {
  const sitemap = await (await page.request.get("/sitemap.xml")).text();
  for (const url of ["/bn/notices", "/en/notices", "/bn/leaderboard", "/en/leaderboard"]) expect(sitemap).toContain(`https://livemodeltest.com${url}<`);
});

for (const [width, height] of [[360, 780], [1280, 900]] as const) {
  test(`responsive at ${width}px: notices, leaderboard and a merit list in both languages`, async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
    for (const lang of ["bn", "en"] as const) {
      for (const [name, path] of [["notices", "/notices"], ["leaderboard", "/leaderboard"], ["merit", "/exams/e2e-results-physics/leaderboard"]] as const) {
        await page.goto(`/${lang}${path}`);
        await noHorizontalOverflow(page);
        await page.screenshot({ path: `${SHOTS}/web-${name}-${lang}-${width}.png`, fullPage: true });
      }
    }
  });
}
