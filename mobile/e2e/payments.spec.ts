import { expect, test, type Page } from "@playwright/test";

import { noHorizontalOverflow, registerStudent, requireDisposableStack, SHOTS, signIn } from "./support";

/** Packages and payment on the real backend with the MOCK provider only (development
 * settings on the disposable stack; never a real gateway). The app opens the provider's
 * page (a popup in this web QA build, an in-app browser on the phone); the outcome is
 * chosen there; the app then shows what the SERVER verified. Disposable stack only. */
requireDisposableStack("payments.spec.ts");
test.describe.configure({ mode: "serial" });

const NUMBER = "01555000666"; // not in the seed
const PASSWORD = "Jamuna-Setu-2026";
let page: Page;

const visible = (text: string | RegExp) => page.getByText(text).filter({ visible: true });
const list = () => page.getByTestId("package-list");

/** Buys from the Packages tab and finishes the mock checkout with `result`. */
async function buy(name: RegExp, result: "success" | "cancel") {
  const card = list().getByRole("heading", { name }).locator("xpath=ancestor::div[.//button][1]");
  await card.getByRole("button", { name: /^(Buy|Extend)$/ }).click();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Continue to payment" }).filter({ visible: true }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  expect(popup.url()).toContain("/payments/mock/checkout/");
  await popup.goto(`${popup.url().split("?")[0]}?result=${result}`); // the mock provider's choice
  await popup.close(); // back to the app: it asks the server
}

test.beforeAll(async ({ browser, request }) => {
  await registerStudent(request, NUMBER, "Payments Student", PASSWORD);
  page = await (await browser.newContext({ locale: "en-GB" })).newPage();
});

test("Packages tab: prices and features from the server; no subscription yet", async () => {
  await signIn(page, NUMBER, PASSWORD);
  await page.getByRole("tab", { name: "Packages" }).filter({ visible: true }).click();
  await expect(list().getByText("E2E Gold")).toBeVisible();
  await expect(list().getByText("৳500")).toBeVisible();
  await expect(list().getByText("Every exam of the seed category")).toBeVisible();
  await expect(list().getByText("Popular")).toBeVisible();
  await expect(list().getByRole("button", { name: "Extend" })).toHaveCount(0);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `${SHOTS}/packages-en-390.png`, fullPage: true });
});

test("a cancelled checkout: the server says cancelled, nothing is bought", async () => {
  await buy(/E2E Silver/, "cancel");
  await expect(visible("Payment cancelled")).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/payment-cancelled-en-390.png` });
  await page.getByRole("button", { name: "Back to packages" }).filter({ visible: true }).click();
  await expect(list().getByRole("button", { name: "Extend" })).toHaveCount(0);
});

test("a successful checkout: verified by the server, the package becomes active", async () => {
  await buy(/E2E Gold/, "success");
  await expect(visible("Payment successful")).toBeVisible({ timeout: 15_000 });
  await expect(visible("E2E Gold is active. You can now take its exams.")).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `${SHOTS}/payment-success-en-390.png`, fullPage: true });
  await page.getByRole("button", { name: "Back" }).filter({ visible: true }).click(); // the list reloads on return
  await expect(list().getByText(/^Active until /)).toBeVisible();
  await expect(list().getByRole("button", { name: "Extend" })).toHaveCount(1);
});

test("payment history: paid and cancelled", async () => {
  await page.getByRole("link", { name: "My payments" }).filter({ visible: true }).click();
  const history = page.getByTestId("payment-list");
  await expect(history.getByRole("link", { name: "E2E Gold, ৳500, Paid" })).toBeVisible();
  await expect(history.getByRole("link", { name: "E2E Silver, ৳250, Cancelled" })).toBeVisible();
});
