import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { registerStudent, requireDisposableStack, signIn } from "./support";

/** Milestone 10F — automated accessibility check (axe-core, WCAG 2.1 A/AA rules) of every
 * app screen in both languages, on the web build at phone width: first launch, sign-in,
 * registration, password reset, the five tabs, notifications, exam details, the exam room
 * (palette and the submit question), result, answer review, leaderboard, buying a package,
 * the payment screen and history, edit profile and change password.
 * The web build renders the same components and the same accessibility labels and roles
 * as the Android app, so this catches contrast, names, labels and roles; it does not
 * replace a TalkBack run on a phone. Disposable stack only; each language uses its own
 * new student, who takes the seed exam once. */
requireDisposableStack("accessibility.spec.ts");

const PASSWORD = "Padma-Nodi-2026";
const LABELS = {
  en: {
    home: "Home",
    exams: "Exams",
    packages: "Packages",
    results: "Results",
    profile: "Profile",
    start: "Start exam",
    palette: "All questions",
    submit: "Submit",
    done: "Done",
    review: "Review answers",
    leaderboard: "Leaderboard",
    back: "Back",
    buy: /^(Buy|Extend)$/,
    pay: "Continue to payment",
    payments: "My payments",
    editProfile: "Edit profile",
    changePassword: "Change password",
  },
  bn: {
    home: "হোম",
    exams: "পরীক্ষা",
    packages: "প্যাকেজ",
    results: "ফলাফল",
    profile: "প্রোফাইল",
    start: "পরীক্ষা শুরু করুন",
    palette: "সব প্রশ্ন",
    submit: "জমা দিন",
    done: "ঠিক আছে",
    review: "উত্তর মিলিয়ে দেখুন",
    leaderboard: "লিডারবোর্ড",
    back: "ফিরে যান",
    buy: /^(কিনুন|মেয়াদ বাড়ান)$/,
    pay: "পেমেন্টে যান",
    payments: "আমার পেমেন্ট",
    editProfile: "প্রোফাইল সম্পাদনা",
    changePassword: "পাসওয়ার্ড পরিবর্তন",
  },
} as const;

async function audit(page: Page, where: string) {
  // The settled screen: data loaded and no transition or dialog animation half-way.
  // react-native-web marks an open dialog as a dialog a moment after it appears, and fades
  // or slides it in with CSS animations: wait for both.
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() =>
    [...document.querySelectorAll("[aria-modal]")].every((modal) => ["dialog", "alertdialog"].includes(modal.getAttribute("role") ?? "")),
  );
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const report = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.target.join(" ")).slice(0, 5).join("\n    ")}`);
  // Soft: report every screen's problems in one run instead of stopping at the first.
  expect.soft(report, `${where}\n${report.join("\n")}`).toEqual([]);
}

async function newPage(browser: Browser) {
  return (await browser.newContext({ locale: "en-GB", viewport: { width: 390, height: 844 } })).newPage();
}

test("signed-out screens pass in both languages", async ({ browser }) => {
  for (const [locale, language] of [["en", "English"], ["bn", "বাংলা"]] as const) {
    const page = await newPage(browser);
    await page.goto("/");
    await expect(page.getByRole("radio", { name: language }).filter({ visible: true })).toBeVisible();
    await audit(page, `first launch (${locale})`);
    await page.getByRole("radio", { name: language }).filter({ visible: true }).click();
    await expect(page.getByRole("textbox").filter({ visible: true }).first()).toBeVisible();
    await audit(page, `sign in (${locale})`);
    for (const path of ["/register", "/forgot-password"]) {
      await page.goto(path);
      await expect(page.getByRole("textbox").filter({ visible: true }).first()).toBeVisible();
      await audit(page, `${path} (${locale})`);
    }
    await page.context().close();
  }
});

for (const locale of ["en", "bn"] as const) {
  test(`every signed-in screen passes in ${locale}`, async ({ browser, request }) => {
    test.setTimeout(240_000);
    const L = LABELS[locale];
    const number = locale === "en" ? "01555000611" : "01555000622"; // not in the seed
    await registerStudent(request, number, locale === "en" ? "Access Student" : "অ্যাক্সেস ছাত্রী", PASSWORD);
    const page = await newPage(browser);
    const button = (name: string | RegExp) => page.getByRole("button", { name }).filter({ visible: true });
    const tab = (name: string) => page.getByRole("tab", { name }).filter({ visible: true });

    await signIn(page, number, PASSWORD);
    await expect(tab("Home")).toBeVisible();
    if (locale === "bn") {
      await tab("Profile").click();
      await page.getByRole("radio", { name: "বাংলা" }).filter({ visible: true }).click();
      await expect(tab(L.home)).toBeVisible();
    }
    await tab(L.home).click();
    await audit(page, `home (${locale})`);

    await page.getByRole("link", { name: locale === "en" ? /notifications/ : /নোটিফিকেশন/ }).filter({ visible: true }).click();
    await audit(page, `notifications (${locale})`);
    await button(L.back).click();

    // Exams → details → the exam room → submit.
    await tab(L.exams).click();
    await audit(page, `exams (${locale})`);
    await page.getByTestId("exam-list").getByRole("link").first().click(); // the seed exam
    await expect(button(L.start)).toBeVisible();
    await audit(page, `exam details (${locale})`);
    await button(L.start).click();
    await audit(page, `start question (${locale})`);
    await button(L.start).last().click();
    await expect(page.getByRole("radio").filter({ visible: true }).first()).toBeVisible();
    await audit(page, `exam room (${locale})`);
    await page.getByRole("radio").filter({ visible: true }).first().click();
    await button(L.palette).click();
    await audit(page, `question palette (${locale})`);
    await button(L.submit).first().click(); // the palette's Submit
    await audit(page, `submit question (${locale})`);
    await button(L.submit).last().click();
    await expect(button(L.done)).toBeVisible();
    await audit(page, `submitted (${locale})`);
    await button(L.done).click(); // back on the exam details
    await button(L.back).click();

    // Results → result → review → leaderboard.
    await tab(L.results).click();
    await audit(page, `results (${locale})`);
    await page.getByTestId("results-list").getByRole("link").first().click();
    await expect(button(L.review)).toBeVisible();
    await audit(page, `result (${locale})`);
    await button(L.review).click();
    await audit(page, `answer review (${locale})`);
    await button(L.back).click();
    await button(L.leaderboard).click();
    await audit(page, `leaderboard (${locale})`);
    await button(L.back).click();
    await button(L.back).click();

    // Packages → buy → the payment screen → payment history.
    await tab(L.packages).click();
    await expect(page.getByTestId("package-list")).toBeVisible();
    await audit(page, `packages (${locale})`);
    await page.getByTestId("package-list").getByRole("button", { name: L.buy }).first().click();
    await audit(page, `buy question (${locale})`);
    const popup = page.waitForEvent("popup");
    await button(L.pay).click();
    await (await popup).close(); // the provider's page; the payment stays pending
    await audit(page, `payment (${locale})`);
    await button(L.back).click();
    await page.getByRole("link", { name: L.payments }).filter({ visible: true }).click();
    await audit(page, `payment history (${locale})`);
    await button(L.back).click();

    // Profile → edit profile, change password.
    await tab(L.profile).click();
    await audit(page, `profile (${locale})`);
    for (const name of [L.editProfile, L.changePassword]) {
      await page.getByRole("button", { name, exact: true }).filter({ visible: true }).or(page.getByRole("link", { name, exact: true }).filter({ visible: true })).click();
      await expect(page.getByRole("textbox").filter({ visible: true }).first()).toBeVisible();
      await audit(page, `${name} (${locale})`);
      await button(L.back).click();
    }
    await page.context().close();
  });
}
