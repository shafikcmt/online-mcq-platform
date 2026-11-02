import { expect, test, type Page } from "@playwright/test";

import { adminSession } from "./support";

/** About, FAQ and Contact on the real backend. The seed has no About page, no FAQs and no
 * contact details, so the pages built with the site show their fallbacks first. Then an
 * admin adds them through the Admin API (as in the Admin Panel) and the pages pick them up
 * at their next regeneration (at most 60 s: the same path production takes).
 * Contact messages go to the backend through the site's own /api/v1/public/ (the dev/E2E
 * proxy here, nginx in production). The backend allows 5 per hour per IP: this suite posts
 * 4 for real; the "too many" answer is simulated in the browser.
 * Disposable stack only (admin/e2e/stack/run.sh with E2E_PROJECT_DIR=web). */
if (process.env.E2E_DISPOSABLE_DB !== "destroy-and-recreate") {
  throw new Error("about-faq-contact.spec.ts needs the disposable stack: run it with admin/e2e/stack/run.sh");
}
const SHOTS = process.env.SCREENSHOT_DIR ?? "e2e/test-results/screens";

test.describe.configure({ mode: "serial" });

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

/** Reloads until the regenerated page shows `text` (ISR: up to 60 s, then one stale view). */
async function untilFresh(page: Page, path: string, text: string) {
  await expect
    .poll(
      async () => {
        await page.goto(path);
        return page.getByText(text, { exact: false }).count();
      },
      { timeout: 120_000, intervals: [3_000] },
    )
    .toBeGreaterThan(0);
}

test("before any content: About shows the site's own text, FAQ says soon, Contact has only the form", async ({ page }) => {
  await page.goto("/en/about");
  await expect(page.getByRole("heading", { level: 1, name: "About Live Model Test" })).toBeVisible();
  await expect(page.getByText(/helps students prepare with real exam practice/)).toBeVisible();
  await page.goto("/en/faq");
  await expect(page.getByText("Questions and answers will appear here soon.")).toBeVisible();
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
  await page.goto("/en/contact");
  await expect(page.locator("form")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reach us" })).toHaveCount(0);
  // About / FAQ / Contact are in the footer (the desktop header keeps the main sections).
  const footer = page.getByRole("contentinfo");
  for (const name of ["About", "FAQ", "Contact"]) await expect(footer.getByRole("link", { name })).toBeVisible();
});

test("an admin adds the About page, FAQs and contact details; the pages pick them up", async ({ page }) => {
  test.setTimeout(300_000);
  const admin = await adminSession();
  await admin.post("/admin/pages/", {
    slug: "about",
    title_en: "Who we are",
    title_bn: "আমরা কারা",
    body_en: "We build fair online exams.\nFor every student in Bangladesh.",
    body_bn: "আমরা ন্যায্য অনলাইন পরীক্ষা তৈরি করি।\nবাংলাদেশের প্রত্যেক শিক্ষার্থীর জন্য।",
    is_active: true,
  });
  await admin.post("/admin/faqs/", {
    question_en: "Is it free?",
    question_bn: "এটা কি ফ্রি?",
    answer_en: "Free exams are open to everyone. Packages unlock paid exams.",
    answer_bn: "ফ্রি পরীক্ষা সবার জন্য। প্যাকেজে পেইড পরীক্ষা খোলে।",
    is_active: true,
    sort_order: 1,
  });
  await admin.post("/admin/faqs/", {
    question_en: "Where do I take exams?",
    question_bn: "পরীক্ষা কোথায় দেব?",
    answer_en: "In the Live Model Test app.",
    answer_bn: "লাইভ মডেল টেস্ট অ্যাপে।",
    is_active: true,
    sort_order: 2,
  });
  await admin.post("/admin/faqs/", { question_en: "Hidden question", question_bn: "লুকানো প্রশ্ন", answer_en: "No.", answer_bn: "না।", is_active: false, sort_order: 3 });
  await admin.patch("/admin/settings/", { contact_phone: "+8801700000999", contact_email: "help@livemodeltest.com", address_en: "Dhaka, Bangladesh", address_bn: "ঢাকা, বাংলাদেশ" });
  await admin.api.dispose();

  await untilFresh(page, "/en/about", "We build fair online exams.");
  await expect(page.getByRole("heading", { level: 1, name: "Who we are" })).toBeVisible();
  await expect(page.getByText(/^Updated /)).toBeVisible();

  await untilFresh(page, "/en/faq", "Is it free?");
  const first = page.locator("details").filter({ hasText: "Is it free?" });
  await expect(first.getByText("Free exams are open to everyone.")).toBeHidden(); // closed until opened
  await first.locator("summary").click();
  await expect(first.getByText("Free exams are open to everyone.")).toBeVisible();
  await expect(page.locator("details summary")).toHaveText(["Is it free?+", "Where do I take exams?+"]); // admin's order, inactive left out
  const structured = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? "{}");
  expect(structured["@type"]).toBe("FAQPage");
  expect(structured.mainEntity).toHaveLength(2);

  await untilFresh(page, "/en/contact", "help@livemodeltest.com");
  await expect(page.getByRole("link", { name: "help@livemodeltest.com" })).toHaveAttribute("href", "mailto:help@livemodeltest.com");
  await expect(page.getByRole("link", { name: "+8801700000999" })).toHaveAttribute("href", "tel:+8801700000999");
  await expect(page.getByText("Dhaka, Bangladesh").first()).toBeVisible();
});

test("Contact: the form checks itself, then a message reaches the Admin Panel's inbox", async ({ page }) => {
  await page.goto("/en/contact");
  const form = page.locator("form");
  await form.getByRole("button", { name: "Send message" }).click();
  await expect(form.getByRole("alert")).toHaveText("Please correct the highlighted fields.");
  await expect(form.getByLabel("Your name")).toBeFocused();
  await expect(form.getByLabel("Your name")).toHaveAttribute("aria-invalid", "true");
  await expect(form.getByText("Enter a mobile number or an email.")).toHaveCount(2);

  await form.getByLabel("Your name").fill("Rahim Uddin");
  await form.getByLabel("Email").fill("rahim@example.com");
  await form.getByLabel("Subject").fill("Exam timing");
  await form.getByLabel("Message").fill("When is the next live exam?\nThanks.");
  await form.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("status")).toContainText("Thank you! Your message has been sent.");

  const admin = await adminSession();
  const inbox = (await admin.get("/admin/contact-messages/")) as { results: { name: string; email: string; subject: string; message: string; language: string }[] };
  const mine = inbox.results.find((row) => row.subject === "Exam timing");
  expect(mine).toMatchObject({ name: "Rahim Uddin", email: "rahim@example.com", message: "When is the next live exam?\nThanks.", language: "en" });
  await admin.api.dispose();
});

test("Contact: the backend's own checks show on the field; Bangla works; a bot's honeypot is silently dropped", async ({ page }) => {
  await page.goto("/bn/contact");
  const form = page.locator("form");
  await form.getByLabel("আপনার নাম").fill("করিম");
  await form.getByLabel("মোবাইল নম্বর").fill("12345"); // passes the browser check, not the backend's
  await form.getByLabel("বিষয়").fill("প্রশ্ন");
  await form.getByLabel("বার্তা").fill("পরীক্ষা কবে?");
  await form.getByRole("button", { name: "বার্তা পাঠান" }).click();
  await expect(form.getByRole("alert")).toHaveText("চিহ্নিত ঘরগুলো ঠিক করুন।");
  await expect(form.getByLabel("মোবাইল নম্বর")).toHaveAttribute("aria-invalid", "true");
  await expect(form.getByLabel("মোবাইল নম্বর")).toBeFocused();
  await form.getByLabel("মোবাইল নম্বর").fill("01712345678");
  await form.getByRole("button", { name: "বার্তা পাঠান" }).click();
  await expect(page.getByRole("status")).toContainText("ধন্যবাদ!");

  // A bot fills the hidden field: the page shows success, nothing is stored.
  await page.getByRole("button", { name: "আরেকটি বার্তা পাঠান" }).click();
  await expect(page.locator("#contact-website")).not.toBeInViewport();
  await form.getByLabel("আপনার নাম").fill("Spam Bot");
  await form.getByLabel("ইমেইল").fill("bot@example.com");
  await form.getByLabel("বিষয়").fill("Cheap pills");
  await form.getByLabel("বার্তা").fill("Buy now");
  await page.locator("#contact-website").fill("https://spam.example", { force: true });
  await form.getByRole("button", { name: "বার্তা পাঠান" }).click();
  await expect(page.getByRole("status")).toContainText("ধন্যবাদ!");

  const admin = await adminSession();
  const inbox = (await admin.get("/admin/contact-messages/")) as { results: { name: string; subject: string; language: string; phone: string }[] };
  expect(inbox.results.map((row) => row.subject).sort()).toEqual(["Exam timing", "প্রশ্ন"]);
  const bangla = inbox.results.find((row) => row.subject === "প্রশ্ন");
  expect(bangla?.language).toBe("bn");
  expect(bangla?.phone).toMatch(/1712345678$/);
  await admin.api.dispose();
});

test("Contact: too many messages and a failed send are explained, and the text is kept", async ({ page }) => {
  await page.goto("/en/contact");
  const form = page.locator("form");
  await form.getByLabel("Your name").fill("Rahim");
  await form.getByLabel("Mobile number").fill("01712345678");
  await form.getByLabel("Subject").fill("Again");
  await form.getByLabel("Message").fill("Hello again");
  await page.route("**/api/v1/public/contact/", (route) => route.fulfill({ status: 429, json: { error: { code: "throttled", message: "x" } } }));
  await form.getByRole("button", { name: "Send message" }).click();
  await expect(form.getByRole("alert")).toHaveText("Too many messages from your connection. Please try again later.");
  await page.unroute("**/api/v1/public/contact/");
  await page.route("**/api/v1/public/contact/", (route) => route.abort());
  await form.getByRole("button", { name: "Send message" }).click();
  await expect(form.getByRole("alert")).toHaveText("Your message could not be sent. Please try again in a moment.");
  await expect(form.getByLabel("Message")).toHaveValue("Hello again"); // nothing lost
});

test("SEO: titles, canonical links and the sitemap", async ({ page }) => {
  await page.goto("/bn/faq");
  await expect(page).toHaveTitle("সাধারণ প্রশ্নোত্তর | লাইভ মডেল টেস্ট");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://livemodeltest.com/bn/faq");
  await page.goto("/en/contact");
  await expect(page).toHaveTitle("Contact us | Live Model Test");
  const sitemap = await (await page.request.get("/sitemap.xml")).text();
  for (const path of ["/about", "/faq", "/contact"]) for (const lang of ["bn", "en"]) expect(sitemap).toContain(`https://livemodeltest.com/${lang}${path}<`);
});

for (const [width, height] of [[360, 780], [1280, 900]] as const) {
  test(`responsive at ${width}px: about, faq and contact in both languages`, async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
    for (const lang of ["bn", "en"] as const) {
      for (const name of ["about", "faq", "contact"] as const) {
        await page.goto(`/${lang}/${name}`);
        await noHorizontalOverflow(page);
        await page.screenshot({ path: `${SHOTS}/web-${name}-${lang}-${width}.png`, fullPage: true });
      }
    }
    if (width === 360) {
      // The phone menu lists every page in two columns and still fits.
      await page.goto("/en");
      await page.getByRole("button", { name: "Menu" }).click();
      const menu = page.getByRole("dialog", { name: "Menu" });
      for (const name of ["Home", "Exams", "Packages", "Leaderboard", "Notices", "About", "FAQ", "Contact"]) await expect(menu.getByRole("link", { name })).toBeVisible();
      await menu.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished))); // the slide-in is over
      await page.screenshot({ path: `${SHOTS}/web-menu-en-360.png` });
    }
  });
}
