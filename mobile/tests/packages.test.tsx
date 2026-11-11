import { act, fireEvent, screen } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";

import type { Package, Payment } from "@/features/packages/types";

import { apiError, mockBackend, renderApp, resetDevice, STUDENT } from "./helpers";

jest.setTimeout(30_000);

const PAY = "33333333-3333-4333-8333-333333333333";

function pkg(overrides: Partial<Package> = {}): Package {
  return {
    id: 7,
    slug: "gold",
    name: "Gold",
    description: "All paid mock tests.",
    features: ["Every paid exam", "Answer review"],
    price: "500.00",
    currency: "BDT",
    validity_days: 30,
    is_featured: true,
    subscription: null,
    ...overrides,
  };
}

function payment(status: Payment["status"], overrides: Partial<Payment> = {}): Payment {
  return {
    payment_id: PAY,
    merchant_reference: "MCQABC123",
    status,
    provider: "mock",
    is_test: false,
    amount: "500.00",
    currency: "BDT",
    package: { slug: "gold", name: "Gold" },
    checkout_url: status === "pending" ? "https://pay.example/checkout/MCQABC123" : null,
    transaction_id: status === "success" ? "TXN-9" : null,
    verified_at: status === "success" ? "2026-10-27T10:00:00Z" : null,
    created_at: "2026-10-27T09:59:00Z",
    updated_at: "2026-10-27T10:00:00Z",
    ...overrides,
  };
}

const page = <T,>(results: T[]) => ({ status: 200, body: { count: results.length, next: null, previous: null, results } });
const ok = (body: unknown) => ({ status: 200, body });

async function signedIn(routes: Parameters<typeof mockBackend>[0], url: string, language: "bn" | "en" = "en") {
  await resetDevice({ language, refresh: "R0" });
  const backend = mockBackend({
    "POST /auth/token/refresh/": { status: 200, body: { access: "A1", refresh: "R1" } },
    "GET /me/": { status: 200, body: { ...STUDENT, preferred_language: language } },
    ...routes,
  });
  await renderApp(url);
  return backend;
}

const wait = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

beforeEach(() => (WebBrowser.openAuthSessionAsync as jest.Mock).mockClear());

test("buy: confirm → the server opens a payment → provider page → the server says it is paid", async () => {
  const backend = await signedIn(
    {
      "GET /packages/": page([pkg()]),
      "POST /payments/": { status: 201, body: payment("pending") },
      [`GET /payments/${PAY}/`]: [ok(payment("pending")), ok(payment("success"))],
    },
    "/packages",
  );
  expect(await screen.findByText("৳500")).toBeOnTheScreen();
  expect(screen.getByText("/ 30 days")).toBeOnTheScreen();
  expect(screen.getByText("Every paid exam")).toBeOnTheScreen();
  expect(screen.getByText("Popular")).toBeOnTheScreen();

  const footerBuy = screen.getByRole("button", { name: "Buy" });
  await fireEvent.press(footerBuy);
  expect(screen.getByText("Buy Gold?")).toBeOnTheScreen();
  expect(screen.getByText(/৳500 for 30 days\. You will pay on the payment provider's secure page/)).toBeOnTheScreen();
  expect(backend.find("POST", "/payments/")).toHaveLength(0);
  await fireEvent.press(screen.getByRole("button", { name: "Continue to payment" }));

  expect(await screen.findByText("Checking your payment with the server…")).toBeOnTheScreen();
  const post = backend.find("POST", "/payments/")[0];
  expect(post.body).toEqual({ package_id: 7, channel: "app" }); // never a price from the app
  expect(post.headers["Idempotency-Key"]).toMatch(/^[A-Za-z0-9._:-]{1,64}$/);
  expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith("https://pay.example/checkout/MCQABC123", expect.stringContaining("payment-result"));

  await wait(3_100);
  expect(await screen.findByText("Payment successful")).toBeOnTheScreen();
  expect(screen.getByText("Gold is active. You can now take its exams.")).toBeOnTheScreen();
  expect(screen.getByText("TXN-9")).toBeOnTheScreen();
});

type Gw = { gateway: string; name: string } & Partial<{ provider: string; description: string; logo_url: string; min_amount: string | null; max_amount: string | null; is_test: boolean }>;
const methods = (...items: Gw[]) =>
  ok({
    results: items.map((item) => ({
      provider: "bkash",
      label: item.name,
      description: "",
      logo_url: "",
      min_amount: null,
      max_amount: null,
      is_test: false,
      ...item,
    })),
  });

const bkash: Gw = { gateway: "bkash-main", name: "bKash", provider: "bkash" };
const ssl: Gw = { gateway: "sslcommerz", name: "SSLCommerz", provider: "sslcommerz" };

async function buyWith(items: Gw[], extra: Record<string, { status: number; body?: unknown }> = {}) {
  return signedIn(
    {
      "GET /packages/": page([pkg()]),
      "GET /payments/methods/": methods(...items),
      "POST /payments/": { status: 201, body: payment("pending") },
      [`GET /payments/${PAY}/`]: ok(payment("pending")),
      ...extra,
    },
    "/packages",
  );
}

test("the app asks for its own methods (channel app)", async () => {
  const backend = await buyWith([bkash]);
  await screen.findByRole("button", { name: "Buy" });
  expect(backend.find("GET", "/payments/methods/")[0].query).toEqual({ channel: "app" });
});

test("two ways to pay: the student chooses, and the gateway (not a price) goes to the server with the app channel", async () => {
  const backend = await buyWith([bkash, ssl]);
  await fireEvent.press(await screen.findByRole("button", { name: "Buy" }));
  expect(screen.getByText("Pay with")).toBeOnTheScreen();
  expect(screen.getByRole("radio", { name: "bKash" })).toBeSelected(); // the first is the default
  await fireEvent.press(screen.getByRole("radio", { name: "SSLCommerz" }));
  expect(screen.getByRole("radio", { name: "SSLCommerz" })).toBeSelected();
  await fireEvent.press(screen.getByRole("button", { name: "Continue to payment" }));
  expect(await screen.findByText("Checking your payment with the server…")).toBeOnTheScreen();
  expect(backend.find("POST", "/payments/")[0].body).toEqual({ package_id: 7, channel: "app", gateway: "sslcommerz" });
});

test("two ways to pay, none touched: the default (first) gateway is sent", async () => {
  const backend = await buyWith([bkash, ssl]);
  await fireEvent.press(await screen.findByRole("button", { name: "Buy" }));
  await fireEvent.press(screen.getByRole("button", { name: "Continue to payment" }));
  expect(await screen.findByText("Checking your payment with the server…")).toBeOnTheScreen();
  expect(backend.find("POST", "/payments/")[0].body).toEqual({ package_id: 7, channel: "app", gateway: "bkash-main" });
});

test("two merchant accounts of one provider are told apart by their gateway", async () => {
  const backend = await buyWith([bkash, { gateway: "bkash-two", name: "bKash (second account)", provider: "bkash", description: "Second merchant" }]);
  await fireEvent.press(await screen.findByRole("button", { name: "Buy" }));
  expect(screen.getByText("Second merchant")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("radio", { name: "bKash (second account)" }));
  await fireEvent.press(screen.getByRole("button", { name: "Continue to payment" }));
  expect(await screen.findByText("Checking your payment with the server…")).toBeOnTheScreen();
  expect(backend.find("POST", "/payments/")[0].body).toEqual({ package_id: 7, channel: "app", gateway: "bkash-two" });
});

test("a single way to pay is shown as a row (no radio) and its gateway is sent", async () => {
  const backend = await buyWith([{ ...bkash, description: "Pay with bKash" }]);
  await fireEvent.press(await screen.findByRole("button", { name: "Buy" }));
  expect(screen.getByText("Pay with")).toBeOnTheScreen();
  expect(screen.getByText("Pay with bKash")).toBeOnTheScreen();
  expect(screen.queryByRole("radio")).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Continue to payment" }));
  expect(await screen.findByText("Checking your payment with the server…")).toBeOnTheScreen();
  expect(backend.find("POST", "/payments/")[0].body).toEqual({ package_id: 7, channel: "app", gateway: "bkash-main" });
});

test("a test gateway (a tester's sandbox) is marked as a test payment", async () => {
  await buyWith([{ ...bkash, is_test: true }]);
  await fireEvent.press(await screen.findByRole("button", { name: "Buy" }));
  expect(screen.getByText("Test payment")).toBeOnTheScreen();
  expect(screen.getByText(/Test mode: this payment is only a test/)).toBeOnTheScreen();
});

test("a method whose limits do not fit the price is not offered", async () => {
  const backend = await buyWith([{ ...bkash, min_amount: "1000.00" }, ssl]); // the package costs 500
  await fireEvent.press(await screen.findByRole("button", { name: "Buy" }));
  expect(screen.queryByText("bKash")).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Continue to payment" }));
  expect(await screen.findByText("Checking your payment with the server…")).toBeOnTheScreen();
  expect(backend.find("POST", "/payments/")[0].body).toEqual({ package_id: 7, channel: "app", gateway: "sslcommerz" });
});

test("no method fits the price: a note, and the payment cannot be started", async () => {
  const backend = await buyWith([{ ...bkash, max_amount: "100.00" }]);
  await fireEvent.press(await screen.findByRole("button", { name: "Buy" }));
  expect(screen.getByText("No payment method is available for this package right now.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Continue to payment" }));
  expect(backend.find("POST", "/payments/")).toHaveLength(0);
});

test("the methods cannot be loaded: no choice, the server's default is used (still the app channel)", async () => {
  const backend = await buyWith([], { "GET /payments/methods/": { status: 500, body: { code: "server_error" } } });
  await fireEvent.press(await screen.findByRole("button", { name: "Buy" }));
  expect(screen.queryByText("Pay with")).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Continue to payment" }));
  expect(await screen.findByText("Checking your payment with the server…")).toBeOnTheScreen();
  expect(backend.find("POST", "/payments/")[0].body).toEqual({ package_id: 7, channel: "app" });
});

test("a test payment's result says it is only a test", async () => {
  await signedIn({ [`GET /payments/${PAY}/`]: ok(payment("success", { is_test: true })) }, `/payment/${PAY}`);
  expect(await screen.findByText("Payment successful")).toBeOnTheScreen();
  expect(screen.getByText(/Test mode: this payment is only a test/)).toBeOnTheScreen();
});

test("a real payment's result carries no test note", async () => {
  await signedIn({ [`GET /payments/${PAY}/`]: ok(payment("success")) }, `/payment/${PAY}`);
  expect(await screen.findByText("Payment successful")).toBeOnTheScreen();
  expect(screen.queryByText(/Test mode/)).not.toBeOnTheScreen();
});

test("already subscribed: Extend, and the dialog says it adds time after the current end", async () => {
  await signedIn({ "GET /packages/": page([pkg({ subscription: { active_now: true, expires_at: "2026-12-31T12:00:00Z" } })]) }, "/packages");
  expect(await screen.findByText("Active until 31 December 2026")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Extend" }));
  expect(screen.getByText(/৳500 adds 30 days after your current package ends \(31 December 2026\)/)).toBeOnTheScreen();
});

test("the provider cannot be reached (503): the server's message, nothing opened", async () => {
  await signedIn(
    {
      "GET /packages/": page([pkg()]),
      "POST /payments/": apiError(503, "payment_unavailable", "Online payment is not available right now. Please try again later."),
    },
    "/packages",
  );
  await fireEvent.press(await screen.findByRole("button", { name: "Buy" }));
  await fireEvent.press(screen.getByRole("button", { name: "Continue to payment" }));
  expect(await screen.findByText("Online payment is not available right now. Please try again later.")).toBeOnTheScreen();
  expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
});

test.each([
  ["cancelled", "Payment cancelled", "You cancelled the payment. No package was bought."],
  ["failed", "Payment not completed", "The payment did not go through. If money was taken, it will be checked and your package activated automatically."],
] as const)("a %s payment says so", async (status, title, body) => {
  await signedIn({ [`GET /payments/${PAY}/`]: ok(payment(status)) }, `/payment/${PAY}`);
  expect(await screen.findByText(title)).toBeOnTheScreen();
  expect(screen.getByText(body)).toBeOnTheScreen();
});

test("still pending after two minutes: stop asking, offer to check again or reopen the page", async () => {
  const backend = await signedIn({ [`GET /payments/${PAY}/`]: ok(payment("pending")) }, `/payment/${PAY}`);
  expect(await screen.findByText("Checking your payment with the server…")).toBeOnTheScreen();
  for (let i = 0; i < 42; i += 1) await wait(3_000);
  expect(await screen.findByText(/We have not received the payment confirmation yet/)).toBeOnTheScreen();
  const asked = backend.find("GET", `/payments/${PAY}/`).length;
  await wait(10_000);
  expect(backend.find("GET", `/payments/${PAY}/`)).toHaveLength(asked); // stopped
  expect(screen.getByRole("button", { name: "Open the payment page again" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Check again" }));
  expect(backend.find("GET", `/payments/${PAY}/`).length).toBeGreaterThan(asked);
});

test("a return link saying success is not trusted: the server's status is shown", async () => {
  const backend = await signedIn({ [`GET /payments/${PAY}/`]: ok(payment("pending")) }, `/payment-result?payment=${PAY}&status=success`);
  expect(await screen.findByText("Checking your payment with the server…")).toBeOnTheScreen();
  expect(screen.queryByText("Payment successful")).toBeNull();
  expect(backend.find("GET", `/payments/${PAY}/`).length).toBeGreaterThan(0);
});

test("a malformed return link goes to the packages", async () => {
  await signedIn({ "GET /packages/": page([pkg()]) }, "/payment-result?payment=../../me&status=success");
  expect(await screen.findByText("Gold")).toBeOnTheScreen();
});

test("payment history lists my payments and opens one", async () => {
  await signedIn({ "GET /payments/": page([payment("success")]), [`GET /payments/${PAY}/`]: ok(payment("success")) }, "/payments");
  await fireEvent.press(await screen.findByRole("link", { name: "Gold, ৳500, Paid" }));
  expect(await screen.findByText("Payment successful")).toBeOnTheScreen();
});

test("a paid exam without a package offers the packages", async () => {
  await signedIn(
    {
      "GET /exams/bio/": ok({
        slug: "bio", title: "Biology final", description: "", instructions: "", exam_type: "regular", access_type: "paid", content_language: "en",
        category: { slug: "hsc", name: "HSC" }, subject: null, duration_minutes: 30, total_questions: 10, total_marks: "10.00", negative_marks: "0.00",
        pass_marks: null, start_at: null, end_at: null, is_featured: false, syllabus: [], has_access: false, can_start: false, can_resume: false, attempt_state: null,
        locked_reason: "needs_subscription", attempts_used: 0, attempts_allowed: 1, seconds_if_started_now: null, server_time: new Date().toISOString(),
      }),
      "GET /packages/": page([pkg()]),
    },
    "/exam/bio",
  );
  await fireEvent.press(await screen.findByRole("button", { name: "See packages" }));
  expect(await screen.findByText("Gold")).toBeOnTheScreen();
});

test("Bangla prices", async () => {
  await signedIn({ "GET /packages/": page([pkg()]) }, "/packages", "bn");
  expect(await screen.findByText("৳৫০০")).toBeOnTheScreen();
  expect(screen.getByText("/ ৩০ দিন")).toBeOnTheScreen();
});
