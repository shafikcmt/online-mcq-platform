import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

/** The student account journey against the real backend: first launch → register with an
 * SMS code → profile → language → sign out/in → change password → forgot password.
 * SMS is the mock provider; the code is read from the disposable server's log
 * (E2E_DJANGO_LOG). Runs ONLY on the disposable stack (admin/e2e/stack/run.sh). */
const LOG = process.env.E2E_DJANGO_LOG ?? "";
const SHOTS = process.env.SCREENSHOT_DIR ?? "e2e/test-results/screens";
const ADMIN_MOBILE = process.env.E2E_ADMIN_MOBILE ?? "";
if (process.env.E2E_DISPOSABLE_DB !== "destroy-and-recreate" || !LOG) {
  throw new Error("auth.spec.ts needs the disposable stack: run it with admin/e2e/stack/run.sh");
}
test.describe.configure({ mode: "serial" });

const NUMBER = "01555000111"; // not in the seed
const MASKED_END = NUMBER.slice(-3);
let page: Page;

/** The newest mock-SMS code sent to our number after `since` (log length). */
async function smsCode(since: number): Promise<string> {
  for (let i = 0; i < 60; i += 1) {
    const lines = readFileSync(LOG, "utf8").slice(since).split("\n");
    const hit = lines.reverse().find((line) => line.includes("[MOCK SMS") && line.includes(`*****${MASKED_END}`));
    const code = hit?.match(/\b(\d{6})\b/)?.[1];
    if (code) return code;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("no SMS code arrived");
}
const logSize = () => readFileSync(LOG, "utf8").length;

async function noHorizontalOverflow() {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

/** The web build keeps the previous screens of a stack in the page (hidden): every
 * locator is limited to what is visible. */
async function typeCode(code: string) {
  await page.getByLabel(/verification code|যাচাই কোড/).filter({ visible: true }).fill(code);
}

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext({ locale: "bn-BD" })).newPage(); // a Bangla phone
});

test("first launch on a Bangla phone: the language question is in Bangla", async () => {
  await page.goto("/");
  await expect(page.getByText("আপনার ভাষা বেছে নিন").filter({ visible: true })).toBeVisible();
  await noHorizontalOverflow();
  await page.screenshot({ path: `${SHOTS}/language-390.png` });
  await page.getByRole("radio", { name: "English" }).filter({ visible: true }).click();
  await expect(page.getByText("Welcome back! Sign in with your mobile number and password.").filter({ visible: true })).toBeVisible();
});

test("an admin account cannot sign in to the student app (one generic message)", async () => {
  test.skip(!ADMIN_MOBILE, "E2E_ADMIN_MOBILE not set");
  await page.getByLabel("Mobile number").filter({ visible: true }).fill(ADMIN_MOBILE);
  await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill(process.env.E2E_ADMIN_PASSWORD ?? "x");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).click();
  await expect(page.getByRole("alert").filter({ visible: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true }).filter({ visible: true })).toHaveValue("");
});

test("register: number → SMS code (a wrong one first) → details → Home", async () => {
  await page.getByRole("link", { name: "Create an account" }).filter({ visible: true }).click();
  await expect(page.getByText("Step 1 of 3").filter({ visible: true })).toBeVisible();
  await page.getByLabel("Mobile number").filter({ visible: true }).fill("12345");
  await page.getByRole("button", { name: "Send code" }).filter({ visible: true }).click();
  await expect(page.getByText("Enter a valid Bangladeshi mobile number, e.g. 01712345678.").filter({ visible: true })).toBeVisible();
  const since = logSize();
  await page.getByLabel("Mobile number").filter({ visible: true }).fill(NUMBER);
  await page.getByRole("button", { name: "Send code" }).filter({ visible: true }).click();
  await expect(page.getByText(`We sent a 6-digit code by SMS to 01555 000111.`).filter({ visible: true })).toBeVisible();
  const code = await smsCode(since);
  await page.screenshot({ path: `${SHOTS}/otp-390.png` });
  await typeCode(code === "000000" ? "111111" : "000000");
  await expect(page.getByText(/attempts? left/).filter({ visible: true })).toBeVisible();
  await typeCode(code);
  await expect(page.getByText("Your details").filter({ visible: true })).toBeVisible();
  await page.getByLabel("Full name").filter({ visible: true }).fill("E2E Student");
  await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill("password");
  await page.getByLabel("Confirm password").filter({ visible: true }).fill("password");
  await page.getByRole("button", { name: "Create account" }).filter({ visible: true }).click();
  await expect(page.getByText("This password is too common.").filter({ visible: true })).toBeVisible(); // the server's validator
  await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill("Kh0ra-Pani-2026");
  await page.getByLabel("Confirm password").filter({ visible: true }).fill("Kh0ra-Pani-2026");
  await page.screenshot({ path: `${SHOTS}/register-details-390.png` });
  await page.getByRole("button", { name: "Create account" }).filter({ visible: true }).click();
  await expect(page.getByText("Hello, E2E").filter({ visible: true })).toBeVisible();
  await noHorizontalOverflow();
  await page.screenshot({ path: `${SHOTS}/home-en-390.png` });
});

test("profile: own details; edit; language switch is saved to the account", async () => {
  await page.getByRole("tab", { name: "Profile" }).filter({ visible: true }).click();
  await expect(page.getByText("01555 000111").filter({ visible: true })).toBeVisible();
  await expect(page.getByText("Verified").filter({ visible: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit profile" }).filter({ visible: true }).click();
  await page.getByLabel("Leaderboard name").filter({ visible: true }).fill("E2E Star");
  await page.getByRole("button", { name: "Save" }).filter({ visible: true }).click();
  await expect(page.getByText("Profile saved.").filter({ visible: true })).toBeVisible();
  await expect(page.getByText("Leaderboard name: E2E Star").filter({ visible: true })).toBeVisible();
  await page.getByRole("radio", { name: "বাংলা" }).filter({ visible: true }).click();
  await expect(page.getByRole("heading", { name: "প্রোফাইল" }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText("০১৫৫৫ ০০০১১১").filter({ visible: true })).toBeVisible();
  await noHorizontalOverflow();
  await page.screenshot({ path: `${SHOTS}/profile-bn-390.png`, fullPage: true });
});

test("sign out asks first; signing in again restores the account language", async () => {
  await page.getByRole("button", { name: "সাইন আউট" }).filter({ visible: true }).click();
  await expect(page.getByText("সাইন আউট করবেন?").filter({ visible: true })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/signout-dialog-bn-390.png` });
  await page.getByRole("button", { name: "সাইন আউট" }).filter({ visible: true }).last().click();
  await expect(page.getByRole("button", { name: "সাইন ইন করুন" }).filter({ visible: true })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/login-bn-390.png` });
  await page.getByLabel("মোবাইল নম্বর").filter({ visible: true }).fill("০১৫৫৫০০০১১১"); // Bangla digits
  await page.getByLabel("পাসওয়ার্ড", { exact: true }).filter({ visible: true }).fill("Kh0ra-Pani-2026");
  await page.getByRole("button", { name: "সাইন ইন করুন" }).filter({ visible: true }).click();
  await expect(page.getByText("হ্যালো, E2E Star").filter({ visible: true })).toBeVisible();
});

test("change password signs out everywhere; the new password works", async () => {
  await page.getByRole("tab", { name: "প্রোফাইল" }).filter({ visible: true }).click();
  await page.getByRole("button", { name: "পাসওয়ার্ড পরিবর্তন" }).filter({ visible: true }).click();
  await page.getByLabel("বর্তমান পাসওয়ার্ড").filter({ visible: true }).fill("wrong-current");
  await page.getByLabel("নতুন পাসওয়ার্ড").filter({ visible: true }).fill("Nodi-Bhora-2027");
  await page.getByLabel("পাসওয়ার্ড আবার লিখুন").filter({ visible: true }).fill("Nodi-Bhora-2027");
  await page.getByRole("button", { name: "পাসওয়ার্ড পরিবর্তন করুন" }).filter({ visible: true }).click();
  await expect(page.getByRole("alert").filter({ visible: true }).first()).toBeVisible();
  await page.getByLabel("বর্তমান পাসওয়ার্ড").filter({ visible: true }).fill("Kh0ra-Pani-2026");
  await page.getByRole("button", { name: "পাসওয়ার্ড পরিবর্তন করুন" }).filter({ visible: true }).click();
  await expect(page.getByText("পাসওয়ার্ড বদলানো হয়েছে। নতুন পাসওয়ার্ড দিয়ে সাইন ইন করুন।").filter({ visible: true })).toBeVisible();
  await page.getByLabel("মোবাইল নম্বর").filter({ visible: true }).fill(NUMBER);
  await page.getByLabel("পাসওয়ার্ড", { exact: true }).filter({ visible: true }).fill("Kh0ra-Pani-2026");
  await page.getByRole("button", { name: "সাইন ইন করুন" }).filter({ visible: true }).click();
  await expect(page.getByRole("alert").filter({ visible: true })).toBeVisible(); // the old password no longer works
  await page.getByLabel("পাসওয়ার্ড", { exact: true }).filter({ visible: true }).fill("Nodi-Bhora-2027");
  await page.getByRole("button", { name: "সাইন ইন করুন" }).filter({ visible: true }).click();
  await expect(page.getByText("হ্যালো, E2E Star").filter({ visible: true })).toBeVisible();
});

test("forgot password: number → SMS code → new password → sign in", async () => {
  await page.getByRole("tab", { name: "প্রোফাইল" }).filter({ visible: true }).click();
  await page.getByRole("button", { name: "সাইন আউট" }).filter({ visible: true }).click();
  await page.getByRole("button", { name: "সাইন আউট" }).filter({ visible: true }).last().click();
  await page.getByRole("link", { name: "পাসওয়ার্ড ভুলে গেছেন?" }).filter({ visible: true }).click();
  await expect(page.getByRole("heading", { name: "পাসওয়ার্ড রিসেট করুন" }).filter({ visible: true })).toBeVisible();
  const since = logSize();
  await page.getByLabel("মোবাইল নম্বর").filter({ visible: true }).fill(NUMBER);
  await page.getByRole("button", { name: "কোড পাঠান" }).filter({ visible: true }).click();
  await expect(page.getByText(/নিবন্ধিত হলে SMS-এ ৬ সংখ্যার একটি কোড পাঠানো হয়েছে/).filter({ visible: true })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/forgot-otp-bn-390.png` });
  await typeCode(await smsCode(since));
  await page.getByLabel("নতুন পাসওয়ার্ড").filter({ visible: true }).fill("Shapla-Phul-2028");
  await page.getByLabel("পাসওয়ার্ড আবার লিখুন").filter({ visible: true }).fill("Shapla-Phul-2028");
  await page.getByRole("button", { name: "নতুন পাসওয়ার্ড সংরক্ষণ করুন" }).filter({ visible: true }).click();
  await expect(page.getByText("পাসওয়ার্ড বদলানো হয়েছে। নতুন পাসওয়ার্ড দিয়ে সাইন ইন করুন।").filter({ visible: true })).toBeVisible();
  await page.getByLabel("মোবাইল নম্বর").filter({ visible: true }).fill(NUMBER);
  await page.getByLabel("পাসওয়ার্ড", { exact: true }).filter({ visible: true }).fill("Shapla-Phul-2028");
  await page.getByRole("button", { name: "সাইন ইন করুন" }).filter({ visible: true }).click();
  await expect(page.getByText("হ্যালো, E2E Star").filter({ visible: true })).toBeVisible();
});

test("tokens: nothing in localStorage or cookies (the web QA build keeps them in memory)", async () => {
  const stored = await page.evaluate(() => JSON.stringify({ ...window.localStorage }) + document.cookie);
  expect(stored).not.toMatch(/eyJ/); // no JWT anywhere
});

/** Screens are opened by tapping (a reload of the web QA build would drop the in-memory
 * session). The session is in Bangla at this point. */
for (const width of [360, 768]) {
  test(`visual QA at ${width}px in both languages`, async () => {
    await page.setViewportSize({ width, height: width < 600 ? 740 : 1024 });
    for (const [language, tabs] of [
      ["bn", { home: "হোম", profile: "প্রোফাইল", edit: "প্রোফাইল সম্পাদনা", password: "পাসওয়ার্ড পরিবর্তন", back: "ফিরে যান", switchTo: "English" }],
      ["en", { home: "Home", profile: "Profile", edit: "Edit profile", password: "Change password", back: "Back", switchTo: "বাংলা" }],
    ] as const) {
      const shot = async (name: string) => {
        await page.waitForTimeout(300);
        await noHorizontalOverflow();
        await page.screenshot({ path: `${SHOTS}/app-${name}-${language}-${width}.png`, fullPage: true });
      };
      await page.getByRole("tab", { name: tabs.home }).filter({ visible: true }).click();
      await shot("home");
      await page.getByRole("tab", { name: tabs.profile }).filter({ visible: true }).click();
      await shot("profile");
      await page.getByRole("button", { name: tabs.edit }).filter({ visible: true }).click();
      await shot("edit-profile");
      await page.getByRole("button", { name: tabs.back }).filter({ visible: true }).click();
      await page.getByRole("button", { name: tabs.password }).filter({ visible: true }).click();
      await shot("change-password");
      await page.getByRole("button", { name: tabs.back }).filter({ visible: true }).click();
      await page.getByRole("radio", { name: tabs.switchTo }).filter({ visible: true }).click();
    }
  });
}
