import { expect, test, type Page } from "@playwright/test";

const MOBILE = process.env.E2E_ADMIN_MOBILE ?? "";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";
const SHOTS = process.env.SCREENSHOT_DIR ?? "test-results/screens";
const WIDTHS = [1440, 1280, 768, 390];

test.skip(!MOBILE || !PASSWORD, "Set E2E_ADMIN_MOBILE and E2E_ADMIN_PASSWORD");

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(MOBILE);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("anonymous visitors are sent to sign-in", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
});

test("wrong credentials show the server's generic error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(MOBILE);
  await page.getByLabel("Password").fill("definitely-wrong-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("sign in, dashboard, keyboard focus, sign out", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

for (const width of WIDTHS) {
  test(`visual QA at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 800 ? 844 : 900 });
    await page.goto("/login");
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `${SHOTS}/login-${width}.png`, fullPage: true });
    await signIn(page);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `${SHOTS}/dashboard-${width}.png`, fullPage: true });
    if (width < 1024) {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(page.getByRole("dialog", { name: "Main navigation" })).toBeVisible();
      await page.waitForTimeout(400); // let the drawer finish its short slide-in
      await page.screenshot({ path: `${SHOTS}/drawer-${width}.png` });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();
    }
  });
}

test("Bangla UI and collapsed sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  await page.getByRole("button", { name: "Language" }).click();
  await page.getByRole("menuitem", { name: "বাংলা" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "ড্যাশবোর্ড" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SHOTS}/dashboard-bn-1280.png`, fullPage: true });
  await page.getByRole("button", { name: "সাইডবার ছোট করুন" }).click();
  await page.screenshot({ path: `${SHOTS}/dashboard-collapsed-1280.png` });
  // back to English for the next run
  await page.getByRole("button", { name: "ভাষা" }).click();
  await page.getByRole("menuitem", { name: "English" }).click();
});

test("reduced motion: the drawer opens and closes without animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Main navigation" });
  await expect(drawer).toBeVisible();
  const duration = await drawer.evaluate((el) => getComputedStyle(el).animationDuration);
  expect(parseFloat(duration)).toBeLessThan(0.01);
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await page.getByRole("button", { name: "Close navigation" }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused(); // focus returns
});
