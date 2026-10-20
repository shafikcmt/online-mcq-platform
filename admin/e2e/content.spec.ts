import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

/** Milestone 7B — content management against the real stack (nginx → Django + Next.js).
 * Creates throwaway QA records (names contain a unique stamp), exercises them, and deletes
 * them again (afterAll also cleans up through the API if a step failed). */
const MOBILE = process.env.E2E_ADMIN_MOBILE ?? "";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";
const SHOTS = process.env.SCREENSHOT_DIR ?? "test-results/screens";
const STAMP = `${Date.now()}`.slice(-7);
const CAT_EN = `QA7B Category ${STAMP}`;
const CAT_BN = `কিউএ ক্যাটাগরি ${STAMP}`;
const SUB_EN = `QA7B Subject ${STAMP}`;
const Q_EN = `QA7B question ${STAMP}: which gas do plants absorb?`;
const Q_BN = `কিউএ প্রশ্ন ${STAMP}: উদ্ভিদ কোন গ্যাস শোষণ করে?`;
// 1×1 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test.skip(!MOBILE || !PASSWORD, "Set E2E_ADMIN_MOBILE and E2E_ADMIN_PASSWORD");
test.describe.configure({ mode: "serial" });

const created: { category?: number; subject?: number; question?: number } = {};
let context: BrowserContext;
let page: Page;

async function signIn(target: Page) {
  await target.goto("/login");
  await target.getByLabel("Mobile number").fill(MOBILE);
  await target.getByLabel("Password").fill(PASSWORD);
  await target.getByRole("button", { name: "Sign in" }).click();
  await expect(target).toHaveURL(/\/dashboard$/);
}

async function api(request: APIRequestContext, ctx: BrowserContext, method: string, path: string) {
  const csrf = (await ctx.cookies()).find((cookie) => cookie.name === "csrftoken")?.value ?? "";
  return request.fetch(`/api/v1${path}`, { method, headers: { "X-CSRFToken": csrf, Accept: "application/json" } });
}

async function expectNoHorizontalOverflow(target: Page) {
  const overflow = await target.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const main = () => page.getByRole("main");
const toast = () => page.getByRole("region", { name: "Notification" });

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  // Safety net: remove whatever the flow created (in dependency order). A test that failed
  // mid-way may have left no session (the session-expiry test deletes it): sign in again.
  if ((await api(page.request, context, "GET", "/admin/auth/me/")).status() === 401) await signIn(page);
  for (const [kind, id] of [
    ["questions", created.question],
    ["subjects", created.subject],
    ["categories", created.category],
  ] as const) {
    if (id) await api(page.request, context, "DELETE", `/admin/${kind}/${id}/`);
  }
  await context.close();
});

test("categories: validation, create, search, edit", async () => {
  await page.goto("/categories");
  await expect(page.getByRole("heading", { level: 1, name: "Categories" })).toBeVisible();
  await page.getByRole("button", { name: "New category" }).first().click();
  let dialog = page.getByRole("dialog", { name: "New category" });
  await dialog.getByRole("button", { name: "Create" }).click();
  // Empty form: the server answers first with the slug rule (it can't generate one without
  // an English name); the message appears under the slug field, which is marked invalid.
  await expect(dialog.getByLabel(/^Slug/)).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByText(/Enter a slug/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/category-validation-1440.png` });

  const names = dialog.getByRole("group", { name: /^Name/ });
  await names.getByLabel("Bangla").fill(CAT_BN);
  await names.getByLabel("English").fill(CAT_EN);
  const response = page.waitForResponse((r) => r.url().endsWith("/api/v1/admin/categories/") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "Create" }).click();
  created.category = (await (await response).json()).id;
  await expect(dialog).toBeHidden();
  await expect(toast()).toContainText("Category created.");

  await page.getByLabel("Search").fill(STAMP);
  await expect(page).toHaveURL(new RegExp(`search=${STAMP}`));
  const row = main().getByRole("row").filter({ hasText: CAT_EN });
  await expect(row).toHaveCount(1);
  await expect(main().getByRole("table").getByRole("row")).toHaveCount(2); // header + our row
  await expect(row).toContainText(`qa7b-category-${STAMP}`); // slug generated from English

  await row.getByRole("button", { name: `Edit ${CAT_EN}` }).click();
  dialog = page.getByRole("dialog", { name: "Edit category" });
  await dialog.getByLabel(/^Sort order/).fill("7");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();
  await expect(toast()).toContainText("Category saved.");
  await expect(row.getByRole("button", { name: `Edit ${CAT_EN}` })).toBeFocused(); // focus returned
  await expect(row).toContainText("7");
});

test("session expiry during a save: input kept, sign-in offered, back to the same page", async () => {
  await page.goto(`/categories?search=${STAMP}`);
  await page.getByRole("button", { name: "New category" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New category" });
  await dialog.getByRole("group", { name: /^Name/ }).getByLabel("English").fill("Typed before the session ended");
  // CSS locator: once the session dialog opens, the form behind it is aria-hidden.
  const english = page.locator('[role="dialog"] fieldset input[lang="en"]').first();
  await context.clearCookies({ name: "sessionid" }); // the session ends server-side for this browser
  await dialog.getByRole("button", { name: "Create" }).click();
  const expired = page.getByRole("alertdialog", { name: "Your session has ended" });
  await expect(expired).toBeVisible();
  await expect(english).toHaveValue("Typed before the session ended");
  await page.screenshot({ path: `${SHOTS}/session-expired-1440.png` });
  await expired.getByRole("button", { name: "Sign in again" }).click();
  await expect(page).toHaveURL(new RegExp(`/login\\?expired=1&next=%2Fcategories%3Fsearch%3D${STAMP}$`));
  await expect(page.getByText("Your session has ended. Please sign in again.")).toBeVisible();
  await page.getByLabel("Mobile number").fill(MOBILE);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`/categories\\?search=${STAMP}$`));
});

test("subjects: create in the new category, filter by category", async () => {
  await page.goto(`/subjects?category=${created.category}`);
  await expect(page.getByText("No subjects match these filters")).toBeVisible();
  await page.getByRole("button", { name: "New subject" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New subject" });
  await expect(dialog.getByLabel(/^Category/)).toHaveValue(String(created.category));
  await dialog.getByRole("group", { name: /^Name/ }).getByLabel("English").fill(SUB_EN);
  const response = page.waitForResponse((r) => r.url().endsWith("/api/v1/admin/subjects/") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "Create" }).click();
  created.subject = (await (await response).json()).id;
  await expect(dialog).toBeHidden();
  const row = main().getByRole("row").filter({ hasText: SUB_EN });
  await expect(row).toContainText(CAT_EN);
});

test("conflict: a category with subjects is not deleted (409 in_use)", async () => {
  await page.goto(`/categories?search=${STAMP}`);
  const row = main().getByRole("row").filter({ hasText: CAT_EN });
  await row.getByRole("button", { name: `Delete ${CAT_EN}` }).click();
  const dialog = page.getByRole("alertdialog", { name: "Delete this category?" });
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Can't delete this item");
  await page.screenshot({ path: `${SHOTS}/category-in-use-1440.png` });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(row).toHaveCount(1); // still there
});

test("questions: create with options, edit the full option set, image", async () => {
  await page.goto(`/questions/new?category=${created.category}`);
  await expect(page.getByRole("heading", { level: 1, name: "New question" })).toBeVisible();
  await page.getByLabel(/^Subject/).selectOption(String(created.subject));
  await page.locator("#q-text_bn").fill(Q_BN);
  await page.locator("#q-text_en").fill(Q_EN);
  const options = page.getByRole("region", { name: "Options" }).getByRole("listitem");
  const answers = [
    ["অক্সিজেন", "Oxygen"],
    ["কার্বন ডাই অক্সাইড", "Carbon dioxide"],
    ["নাইট্রোজেন", "Nitrogen"],
    ["হিলিয়াম", "Helium"],
  ];
  for (const [index, [bn, en]] of answers.entries()) {
    await options.nth(index).getByLabel("Bangla").fill(bn);
    await options.nth(index).getByLabel("English").fill(en);
  }
  // No correct answer chosen yet: blocked in the browser, nothing sent.
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Mark exactly one option as correct.").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/question-validation-1440.png`, fullPage: true });

  await page.getByRole("radio", { name: "Option 2 is the correct answer" }).check();
  await page.getByLabel(/^Difficulty/).selectOption("easy");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/questions\/\d+$/);
  created.question = Number(page.url().split("/").pop());
  await expect(page.getByRole("heading", { level: 1, name: `Edit question #${created.question}` })).toBeVisible();
  await expect(toast()).toContainText("Question created.");

  // Edit: change one option, add a fifth, move it up, save → the server stores exactly this set.
  await options.nth(3).getByLabel("English").fill("Helium gas");
  await page.getByRole("button", { name: "Add option" }).click();
  await options.nth(4).getByLabel("Bangla").fill("আর্গন");
  await options.nth(4).getByLabel("English").fill("Argon");
  await page.getByRole("button", { name: "Move option 5 up" }).click();
  const patch = page.waitForResponse((r) => r.url().endsWith(`/admin/questions/${created.question}/`) && r.request().method() === "PATCH");
  await page.getByRole("button", { name: "Save changes" }).click();
  const sent = (await patch).request().postDataJSON();
  expect(sent.options.map((option: { text_en: string }) => option.text_en)).toEqual([
    "Oxygen",
    "Carbon dioxide",
    "Nitrogen",
    "Argon",
    "Helium gas",
  ]);
  await expect(toast()).toContainText("Question saved.");
  await page.reload();
  await expect(options).toHaveCount(5);
  await expect(options.nth(3).getByLabel("English")).toHaveValue("Argon");
  await expect(page.getByRole("radio", { name: "Option 2 is the correct answer" })).toBeChecked();

  // Image: upload → preview served from /media/ → remove.
  await page.getByLabel("Image file").setInputFiles({ name: "diagram.png", mimeType: "image/png", buffer: PNG });
  const image = page.getByRole("img", { name: `Image for question #${created.question}` });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Replace image" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/question-edit-image-1440.png`, fullPage: true });
  await page.getByRole("button", { name: "Remove image" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove image" }).click();
  await expect(page.getByText("No image yet")).toBeVisible();
});

test("questions list: search, filters and sorting live in the URL", async () => {
  await page.goto("/questions");
  await page.getByLabel("Search").fill(STAMP);
  await expect(page).toHaveURL(new RegExp(`search=${STAMP}`));
  await expect(main().getByRole("table").getByRole("row")).toHaveCount(2);
  await page.locator("#filter-difficulty").selectOption("hard");
  await expect(page.getByText("No questions match these filters")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/questions-no-match-1440.png` });
  await page.locator("#filter-difficulty").selectOption("easy");
  await page.locator("#filter-language").selectOption("both");
  await page.locator("#filter-category").selectOption(String(created.category));
  await expect(page).toHaveURL(new RegExp(`category=${created.category}`));
  await expect(main().getByRole("table").getByRole("row").filter({ hasText: Q_EN })).toHaveCount(1);
  await main().getByRole("button", { name: "ID" }).click();
  await expect(page).toHaveURL(/ordering=-id/);
  await page.goBack();
  await expect(page).not.toHaveURL(/ordering=/);
  await expect(page.locator("#filter-language")).toHaveValue("both"); // state restored from the URL
});

test("conflict: editing a question used by a published exam answers question_locked", async () => {
  const exams = await (await api(page.request, context, "GET", "/admin/exams/?status=published&page_size=5")).json();
  test.skip(!exams.results?.length, "No published exam in this database");
  const list = await (await api(page.request, context, "GET", `/admin/exams/${exams.results[0].id}/questions/`)).json();
  const lockedId = list.questions[0].question;
  await page.goto(`/questions/${lockedId}`);
  const english = page.getByRole("region", { name: "Options" }).getByRole("listitem").first().getByLabel("English");
  const original = await english.inputValue();
  await english.fill(`${original} (changed)`);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("This question is used by a published exam and cannot be edited.")).toBeVisible();
  await expect(english).toHaveValue(`${original} (changed)`); // input kept, nothing saved
  await page.screenshot({ path: `${SHOTS}/question-locked-1440.png` });
  await page.reload();
  await expect(english).toHaveValue(original);
});

test("cleanup through the UI: question, subject, category", async () => {
  await page.goto(`/questions?search=${STAMP}`);
  await main().getByRole("button", { name: `Delete question #${created.question}` }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No questions match these filters")).toBeVisible();
  created.question = undefined;

  await page.goto(`/subjects?search=${STAMP}`);
  await main().getByRole("button", { name: `Delete ${SUB_EN}` }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No subjects match these filters")).toBeVisible();
  created.subject = undefined;

  await page.goto(`/categories?search=${STAMP}`);
  await main().getByRole("button", { name: `Delete ${CAT_EN}` }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No categories match these filters")).toBeVisible();
  created.category = undefined;
});

/** Visual QA: every new screen at four widths, English and Bangla, no sideways scrolling. */
for (const locale of ["en", "bn"] as const) {
  for (const width of [1440, 1280, 768, 390]) {
    test(`visual QA ${locale} at ${width}px`, async () => {
      await context.addCookies([{ name: "admin_lang", value: locale, url: test.info().project.use.baseURL ?? "http://localhost:8088" }]);
      await page.setViewportSize({ width, height: width < 800 ? 844 : 900 });
      for (const path of ["/categories", "/subjects", "/questions"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoHorizontalOverflow(page);
        await page.screenshot({ path: `${SHOTS}/${path.slice(1)}-${locale}-${width}.png`, fullPage: true });
      }
      if (width === 390) {
        await page.goto("/questions");
        await page.getByRole("button", { name: locale === "en" ? "Filters" : "ফিল্টার" }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.waitForTimeout(200);
        await page.screenshot({ path: `${SHOTS}/questions-filters-${locale}-390.png` });
        await page.keyboard.press("Escape");
      }
      // Editor with long bilingual text and many options (not saved).
      await page.goto("/questions/new");
      await page.locator("#q-text_bn").fill("দীর্ঘ প্রশ্ন ".repeat(60));
      await page.locator("#q-text_en").fill("A very long question text that wraps over many lines ".repeat(15));
      const add = page.getByRole("button", { name: locale === "en" ? "Add option" : "অপশন যোগ করুন" });
      for (let i = 0; i < 4; i += 1) await add.click();
      const options = page.getByRole("region", { name: locale === "en" ? "Options" : "অপশন" }).getByRole("listitem");
      await options.nth(0).getByLabel(locale === "en" ? "English" : "ইংরেজি").fill("Supercalifragilisticexpialidocious-".repeat(8));
      await page.getByRole("button", { name: locale === "en" ? "Create" : "তৈরি করুন" }).click();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `${SHOTS}/question-editor-${locale}-${width}.png`, fullPage: true });
    });
  }
}
