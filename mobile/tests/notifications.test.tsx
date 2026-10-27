import { fireEvent, screen } from "@testing-library/react-native";

import type { Notice, Notification } from "@/features/notifications/types";

import { emptyDashboard, mockBackend, renderApp, resetDevice, STUDENT } from "./helpers";

jest.setTimeout(20_000);

const N1 = "44444444-4444-4444-8444-444444444441";
const N2 = "44444444-4444-4444-8444-444444444442";
const ATTEMPT = "11111111-1111-4111-8111-111111111111";
const PAY = "33333333-3333-4333-8333-333333333333";

const items: Notification[] = [
  { id: N1, type: "result_published", title: "Result published", message: "Your result for Physics is ready.", target: { type: "result", attempt_id: ATTEMPT }, is_read: false, created_at: "2026-10-27T10:00:00Z", read_at: null },
  { id: N2, type: "payment_success", title: "Payment successful", message: "Gold is active until 26 November.", target: { type: "payment", payment_id: PAY }, is_read: true, created_at: "2026-10-26T10:00:00Z", read_at: "2026-10-26T11:00:00Z" },
];
const notices: Notice[] = [{ title: "Exam schedule changed", body: "The weekly test moves to Friday.", is_pinned: true, published_at: "2026-10-25T08:00:00Z", expires_at: null }];
const page = <T,>(results: T[]) => ({ status: 200, body: { count: results.length, next: null, previous: null, results } });

async function signedIn(routes: Parameters<typeof mockBackend>[0], url: string) {
  await resetDevice({ language: "en", refresh: "R0" });
  const backend = mockBackend({
    "POST /auth/token/refresh/": { status: 200, body: { access: "A1", refresh: "R1" } },
    "GET /me/": { status: 200, body: STUDENT },
    ...routes,
  });
  await renderApp(url);
  return backend;
}

test("the bell on Home opens the notifications; opening one marks it read and goes to the result", async () => {
  const backend = await signedIn(
    {
      "GET /me/dashboard/": { status: 200, body: emptyDashboard({ notifications: { unread_count: 1 } }) },
      "GET /me/notifications/": page(items),
      [`POST /me/notifications/${N1}/read/`]: { status: 200, body: { ...items[0], is_read: true } },
      [`GET /results/${ATTEMPT}/`]: { status: 403, body: { error: { code: "result_not_visible", message: "x", details: {}, field_errors: {} } } },
    },
    "/home",
  );
  await fireEvent.press(await screen.findByRole("link", { name: "1 unread notifications" }));
  await fireEvent.press(await screen.findByRole("link", { name: "Unread, Result published, Your result for Physics is ready." }));
  expect(backend.find("POST", `/me/notifications/${N1}/read/`)).toHaveLength(1);
  expect(await screen.findByText(/The result will be shown when the exam's results are published/)).toBeOnTheScreen();
});

test("a read notification is not marked again; it opens its payment", async () => {
  const backend = await signedIn(
    { "GET /me/notifications/": page(items), [`GET /payments/${PAY}/`]: { status: 200, body: { payment_id: PAY, merchant_reference: "R", status: "success", provider: "mock", amount: "500.00", currency: "BDT", package: { slug: "gold", name: "Gold" }, checkout_url: null, transaction_id: "T", verified_at: null, created_at: "2026-10-26T10:00:00Z", updated_at: "2026-10-26T10:00:00Z" } } },
    "/notifications",
  );
  await fireEvent.press(await screen.findByRole("link", { name: "Payment successful, Gold is active until 26 November." }));
  expect(backend.find("POST", `/me/notifications/${N2}/read/`)).toHaveLength(0);
  expect(await screen.findByText("Gold is active. You can now take its exams.")).toBeOnTheScreen();
});

test("mark all as read", async () => {
  const backend = await signedIn({ "GET /me/notifications/": page(items), "POST /me/notifications/read-all/": { status: 200, body: { updated: 1 } } }, "/notifications");
  await fireEvent.press(await screen.findByRole("button", { name: "Mark all as read" }));
  expect(backend.find("POST", "/me/notifications/read-all/")).toHaveLength(1);
  expect(await screen.findByText("All notifications marked as read.")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Mark all as read" })).toBeNull();
  expect(screen.getByRole("link", { name: "Result published, Your result for Physics is ready." })).toBeOnTheScreen();
});

test("notices from the admin, pinned shown as such; empty states", async () => {
  await signedIn({ "GET /me/notifications/": page([]), "GET /announcements/": page(notices) }, "/notifications");
  expect(await screen.findByText(/No notifications yet/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("radio", { name: "Notices" }));
  expect(await screen.findByText("The weekly test moves to Friday.")).toBeOnTheScreen();
  expect(screen.getByText("Pinned")).toBeOnTheScreen();
});
