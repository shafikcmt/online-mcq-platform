import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/subscriptions",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { SubscriptionDetail } from "@/components/subscriptions/subscription-detail";
import { SubscriptionsView, type SubscriptionsStudent } from "@/components/subscriptions/subscriptions-view";
import { SUBSCRIPTION_LIST } from "@/lib/content-specs";
import { parseListParams } from "@/lib/list-params";
import { newIdempotencyKey } from "@/lib/subscription-actions";
import type { Package } from "@/types/packages";
import type { AdminSubscription } from "@/types/subscriptions";

import { apiError, json, mockApi, page, renderPanel } from "./content-helpers";

const GRANT = "/api/v1/admin/subscriptions/grant/";
const KEY_FORMAT = /^[A-Za-z0-9._:-]{1,64}$/;

function subscription(overrides: Partial<AdminSubscription> = {}): AdminSubscription {
  return {
    id: 7,
    user: { id: 40, full_name: "Ayesha Siddika", mobile_display: "+88017*****101" },
    package: { id: 5, slug: "gold", name_bn: "গোল্ড", name_en: "Gold" },
    status: "active",
    effective_status: "active",
    starts_at: "2026-10-01T08:00:00Z",
    expires_at: "2026-10-31T08:00:00Z",
    price_paid: "500.00",
    currency: "BDT",
    is_test: false,
    created_at: "2026-10-01T08:00:00Z",
    updated_at: "2026-10-01T08:00:00Z",
    ...overrides,
  };
}

const gold = { id: 5, slug: "gold", name_bn: "গোল্ড", name_en: "Gold", price: "500.00", currency: "BDT", validity_days: 30, status: "active" } as Package;
const student = { id: 40, full_name: "Ayesha Siddika", mobile_display: "+88017*****101", role: "student" as const };

function list(query = "", { prefillStudent = null as SubscriptionsStudent | null, pkg = null as Package | null, locale = "en" as "en" | "bn" } = {}) {
  window.history.replaceState({}, "", `/subscriptions${query ? `?${query}` : ""}`);
  const state = parseListParams(new URLSearchParams(query), SUBSCRIPTION_LIST);
  return renderPanel(
    <SubscriptionsView data={page([subscription()])} state={state} student={prefillStudent} pkg={pkg ? { id: pkg.id, pkg } : null} />,
    locale,
  );
}

/** Answers the pickers' searches; `grant` answers POST …/grant/. */
function api(grant: (call: { headers: Record<string, string>; body: unknown }) => Response | Promise<Response>) {
  return mockApi((call) => {
    if (call.url.startsWith("/api/v1/admin/users/")) return json(200, page([{ ...student, role: "student" }]));
    if (call.url.startsWith("/api/v1/admin/packages/")) return json(200, page([gold]));
    if (call.url === GRANT && call.method === "POST") return grant(call);
    return json(404, { error: { code: "not_found", message: "Not found." } });
  });
}

const grantCalls = <C extends { url: string; method: string }>(calls: C[]) => calls.filter((call) => call.url === GRANT && call.method === "POST");

async function openGrantAndChoose() {
  fireEvent.click(screen.getByRole("button", { name: "Grant subscription" }));
  const dialog = await screen.findByRole("dialog", { name: "Grant a subscription" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Choose student" }));
  fireEvent.click(await screen.findByRole("button", { name: "Choose Ayesha Siddika" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Choose package" }));
  fireEvent.click(await screen.findByRole("button", { name: "Choose Gold" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose a package" })).not.toBeInTheDocument());
  return dialog;
}

const submit = (dialog: HTMLElement, name = "Grant") => fireEvent.click(within(dialog).getByRole("button", { name }));

beforeEach(() => {
  router.push.mockReset();
  router.refresh.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("newIdempotencyKey", () => {
  it("is unique and matches the server's format, also without randomUUID", () => {
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(50);
    for (const key of keys) expect(key).toMatch(KEY_FORMAT);
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      expect(newIdempotencyKey()).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true });
    }
  });
});

describe("Grant dialog", () => {
  it("grants with an Idempotency-Key, then opens the new subscription", async () => {
    const { calls } = api(() => json(201, subscription({ id: 99 })));
    list();
    const dialog = await openGrantAndChoose();
    expect(within(dialog).getByText("Ayesha Siddika")).toBeInTheDocument();
    expect(within(dialog).getByText("৳ 500.00 · 30 days")).toBeInTheDocument();
    submit(dialog);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/subscriptions/99"));
    const [call] = grantCalls(calls);
    expect(call.body).toEqual({ user: 40, package: 5 }); // empty optional fields are left out
    expect(call.headers["Idempotency-Key"]).toMatch(KEY_FORMAT);
    expect(call.headers["X-CSRFToken"]).toBe("test-token");
    expect(await screen.findByText("Subscription granted.")).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalled();
  });

  it("sends the price and a Bangladesh start time when given", async () => {
    const { calls } = api(() => json(201, subscription({ id: 99 })));
    list();
    const dialog = await openGrantAndChoose();
    fireEvent.change(within(dialog).getByLabelText(/Price paid/), { target: { value: " 250 " } });
    fireEvent.change(within(dialog).getByLabelText(/^Start/), { target: { value: "2026-11-01T10:30" } });
    submit(dialog);
    await waitFor(() => expect(grantCalls(calls)).toHaveLength(1));
    expect(grantCalls(calls)[0].body).toEqual({
      user: 40,
      package: 5,
      price_paid: "250",
      starts_at: "2026-11-01T10:30:00+06:00",
    });
  });

  it("retries after a network error with the SAME key, and says retrying is safe", async () => {
    let attempt = 0;
    const { calls } = api(() => {
      attempt += 1;
      if (attempt === 1) throw new TypeError("Failed to fetch");
      return json(201, subscription({ id: 99 }));
    });
    list();
    const dialog = await openGrantAndChoose();
    submit(dialog);
    expect(await within(dialog).findByText(/safe to try again/)).toBeInTheDocument();
    submit(dialog);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/subscriptions/99"));
    const keys = grantCalls(calls).map((call) => call.headers["Idempotency-Key"]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("a double click sends one request", async () => {
    let release: (response: Response) => void = () => undefined;
    const { calls } = api(() => new Promise<Response>((resolve) => (release = resolve)));
    list();
    const dialog = await openGrantAndChoose();
    submit(dialog);
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Saving…" })).toBeDisabled());
    fireEvent.click(within(dialog).getByRole("button", { name: "Saving…" }));
    await act(async () => release(json(201, subscription({ id: 99 }))));
    expect(grantCalls(calls)).toHaveLength(1);
  });

  it("a new opening of the dialog is a new grant with a new key", async () => {
    const { calls } = api(() => apiError(400, "validation_error", "Invalid.", { package: ["This package is inactive and cannot be granted."] }));
    list();
    let dialog = await openGrantAndChoose();
    submit(dialog);
    await within(dialog).findByText("This package is inactive and cannot be granted.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Grant a subscription" })).not.toBeInTheDocument());
    dialog = await openGrantAndChoose();
    submit(dialog);
    await waitFor(() => expect(grantCalls(calls)).toHaveLength(2));
    const [first, second] = grantCalls(calls).map((call) => call.headers["Idempotency-Key"]);
    expect(first).not.toBe(second);
  });

  it("field errors appear under their fields; the dialog stays open", async () => {
    api(() =>
      apiError(400, "validation_error", "Invalid.", {
        price_paid: ["Enter a price of 0 or more."],
        starts_at: ["The start time cannot be in the past."],
      }),
    );
    list();
    const dialog = await openGrantAndChoose();
    submit(dialog);
    expect(await within(dialog).findByText("Enter a price of 0 or more.")).toBeInTheDocument();
    expect(within(dialog).getByText("The start time cannot be in the past.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Price paid/)).toHaveAttribute("aria-invalid", "true");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("extension and replay outcomes are reported as such", async () => {
    let response = () => json(200, subscription({ id: 7 }));
    api(() => response());
    list();
    let dialog = await openGrantAndChoose();
    submit(dialog);
    expect(await screen.findByText("Subscription extended.")).toBeInTheDocument();
    response = () => new Response(JSON.stringify(subscription({ id: 7 })), { status: 201, headers: { "content-type": "application/json", "Idempotent-Replayed": "true" } });
    dialog = await openGrantAndChoose();
    submit(dialog);
    expect(await screen.findByText("This grant had already been made — nothing was granted twice.")).toBeInTheDocument();
  });

  it("a reused key with different details (409) explains what happened", async () => {
    api(() => apiError(409, "idempotency_key_reused", "This Idempotency-Key was already used for a different grant."));
    list();
    const dialog = await openGrantAndChoose();
    submit(dialog);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("check the student's subscriptions before granting again");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("asks for a student and a package before sending anything", async () => {
    const { calls } = api(() => json(201, subscription()));
    list();
    fireEvent.click(screen.getByRole("button", { name: "Grant subscription" }));
    const dialog = await screen.findByRole("dialog", { name: "Grant a subscription" });
    submit(dialog);
    expect(await within(dialog).findByText("Choose a student.")).toBeInTheDocument();
    expect(within(dialog).getByText("Choose a package.")).toBeInTheDocument();
    expect(grantCalls(calls)).toHaveLength(0);
  });

  it("is prefilled with the filtered student and package — never with an admin", async () => {
    const { unmount } = list("user=40&package=5", { prefillStudent: { id: 40, user: student }, pkg: gold });
    fireEvent.click(screen.getByRole("button", { name: "Grant subscription" }));
    let dialog = await screen.findByRole("dialog", { name: "Grant a subscription" });
    expect(within(dialog).getByText("Ayesha Siddika")).toBeInTheDocument();
    expect(within(dialog).getByText("+88017*****101")).toBeInTheDocument();
    expect(within(dialog).getByText("Gold")).toBeInTheDocument();
    unmount();
    list("user=1", { prefillStudent: { id: 1, user: { id: 1, full_name: "Ops", mobile_display: "+88016*****678", role: "admin" } } });
    fireEvent.click(screen.getByRole("button", { name: "Grant subscription" }));
    dialog = await screen.findByRole("dialog", { name: "Grant a subscription" });
    expect(within(dialog).getByText("No student chosen")).toBeInTheDocument();
  });

  it("warns about an inactive package", async () => {
    list("package=5", { pkg: { ...gold, status: "inactive" } });
    fireEvent.click(screen.getByRole("button", { name: "Grant subscription" }));
    const dialog = await screen.findByRole("dialog", { name: "Grant a subscription" });
    expect(within(dialog).getByText("This package is inactive and cannot be granted.")).toBeInTheDocument();
  });
});

describe("Subscription detail actions", () => {
  it("running: Extend (same student and package, no start time) and Cancel", async () => {
    const { calls } = mockApi(() => json(200, subscription()));
    renderPanel(<SubscriptionDetail subscription={subscription()} />);
    expect(screen.getByRole("button", { name: "Cancel subscription" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Extend" }));
    const dialog = await screen.findByRole("dialog", { name: "Extend this subscription" });
    expect(within(dialog).queryByRole("button", { name: /Change|Choose/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/^Start/)).not.toBeInTheDocument();
    submit(dialog, "Extend");
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/subscriptions/7"));
    const call = calls.find((item) => item.url === GRANT)!;
    expect(call.body).toEqual({ user: 40, package: 5 });
    expect(call.headers["Idempotency-Key"]).toMatch(KEY_FORMAT);
  });

  it("ended: Grant again (start time allowed), no Cancel", async () => {
    renderPanel(<SubscriptionDetail subscription={subscription({ status: "cancelled", effective_status: "cancelled" })} />);
    expect(screen.queryByRole("button", { name: "Cancel subscription" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Grant again" }));
    const dialog = await screen.findByRole("dialog", { name: "Grant this package again" });
    expect(within(dialog).getByLabelText(/^Start/)).toBeInTheDocument();
  });

  it("cancel asks first (Keep is focused), then cancels and reloads the page", async () => {
    const { calls } = mockApi(() => json(200, subscription({ status: "cancelled", effective_status: "cancelled" })));
    renderPanel(<SubscriptionDetail subscription={subscription()} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel subscription" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Cancel this subscription?" });
    expect(dialog).toHaveTextContent("Ayesha Siddika loses access to Gold immediately.");
    expect(within(dialog).getByRole("button", { name: "Keep subscription" })).toHaveFocus();
    expect(calls).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel subscription" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(calls.map((call) => [call.method, call.url])).toEqual([["POST", "/api/v1/admin/subscriptions/7/cancel/"]]);
    expect(await screen.findByText("Subscription cancelled.")).toBeInTheDocument();
  });

  it("a cancel conflict shows the server's reason and reloads the page", async () => {
    mockApi(() => apiError(409, "already_cancelled", "This subscription is already cancelled."));
    renderPanel(<SubscriptionDetail subscription={subscription()} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel subscription" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel subscription" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("This subscription is already cancelled.");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("Bangla", () => {
    renderPanel(<SubscriptionDetail subscription={subscription()} />, "bn");
    expect(screen.getByRole("button", { name: "মেয়াদ বাড়ান" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "সাবস্ক্রিপশন বাতিল করুন" })).toBeInTheDocument();
  });
});
