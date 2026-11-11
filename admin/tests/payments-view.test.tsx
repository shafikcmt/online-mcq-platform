import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/payments",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { PaymentDetail } from "@/components/payments/payment-detail";
import { PaymentsView, type ServerSubscription } from "@/components/payments/payments-view";
import type { ServerStudent } from "@/components/results/results-view";
import type { ServerPackage } from "@/components/subscriptions/subscriptions-view";
import { PAYMENT_LIST } from "@/lib/content-specs";
import { parseListParams } from "@/lib/list-params";
import type { Package } from "@/types/packages";
import type { AdminPayment, AdminPaymentDetail, PaymentEvent } from "@/types/payments";
import type { AdminSubscription } from "@/types/subscriptions";

import { apiError, json, mockApi, page, renderPanel } from "./content-helpers";

const ID = "3f2b8c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

function payment(overrides: Partial<AdminPayment> = {}): AdminPayment {
  return {
    payment_id: ID,
    merchant_reference: "MCQA1B2C3D4E5F60718293A4B5C",
    user: { id: 40, full_name: "Ayesha Siddika", mobile_display: "+88017*****101" },
    package: { id: 5, slug: "gold", name_bn: "গোল্ড", name_en: "Gold" },
    subscription_id: 7,
    provider: "sslcommerz",
    gateway: null,
    mode: "",
    channel: "",
    is_test: false,
    amount: "500.00",
    currency: "BDT",
    status: "success",
    failure_reason: "",
    created_at: "2026-10-01T08:00:00Z",
    verified_at: "2026-10-01T08:05:00Z",
    ...overrides,
  };
}

const rows = [
  payment(),
  payment({
    payment_id: "aaaaaaaa-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
    merchant_reference: "MCQPENDING000000000000000001",
    user: { id: 41, full_name: "মাহমুদা আক্তার", mobile_display: "+88017*****103" },
    subscription_id: null,
    status: "pending",
    failure_reason: "provider_risk_review",
    verified_at: null,
  }),
  payment({
    payment_id: "bbbbbbbb-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
    merchant_reference: "MCQFAILED0000000000000000002",
    user: { id: 42, full_name: "Tanvir Ahmed", mobile_display: "+88017*****102" },
    package: { id: 6, slug: "silver", name_bn: "", name_en: "Silver" },
    provider: "mock",
    subscription_id: null,
    status: "failed",
    failure_reason: "some_new_code",
    verified_at: null,
  }),
];

const state = (query = "") => {
  window.history.replaceState({}, "", `/payments${query ? `?${query}` : ""}`);
  return parseListParams(new URLSearchParams(query), PAYMENT_LIST);
};
function view(
  query = "",
  data = page(rows),
  {
    student = null,
    pkg = null,
    subscription = null,
    locale = "en",
  }: { student?: ServerStudent | null; pkg?: ServerPackage | null; subscription?: ServerSubscription | null; locale?: "en" | "bn" } = {},
) {
  return renderPanel(<PaymentsView data={data} state={state(query)} student={student} pkg={pkg} subscription={subscription} />, locale);
}
const table = () => screen.getByRole("table");
const bodyRows = () => within(table()).getAllByRole("row").slice(1);
const lastQuery = () => new URL(String(router.push.mock.lastCall?.[0]), "http://x").searchParams;

beforeEach(() => {
  router.push.mockReset();
  router.replace.mockReset();
});

describe("PaymentsView", () => {
  it("rows: reference, student with masked mobile, package, amount, provider, server status and reason, times", () => {
    view();
    expect(table()).toHaveAccessibleName("Payments");
    const [success, pending, failed] = bodyRows();
    expect(success).toHaveTextContent("MCQA1B2C3D4E5F60718293A4B5C");
    expect(success).toHaveTextContent("Ayesha Siddika");
    expect(success).toHaveTextContent("+88017*****101");
    expect(success).toHaveTextContent("Partly hidden");
    expect(success).toHaveTextContent("Gold");
    expect(success).toHaveTextContent("৳ 500.00");
    expect(success).toHaveTextContent("SSLCommerz");
    expect(success).toHaveTextContent("Successful");
    expect(success).toHaveTextContent("Verified 1 Oct 2026");
    expect(within(success).getByRole("link", { name: "MCQA1B2C3D4E5F60718293A4B5C" })).toHaveAttribute("href", `/payments/${ID}`);
    expect(within(success).getByRole("link", { name: "Open payment MCQA1B2C3D4E5F60718293A4B5C" })).toHaveAttribute("href", `/payments/${ID}`);
    // A reason never becomes a status; an unknown code is shown as the code.
    expect(pending).toHaveTextContent("Pending");
    expect(pending).toHaveTextContent("Reason: Held by the provider for risk review");
    expect(pending).not.toHaveTextContent("Verified");
    expect(failed).toHaveTextContent("Failed");
    expect(failed).toHaveTextContent("Reason: Code: some_new_code");
    expect(failed).toHaveTextContent("Mock (development)");
  });

  it("the list never shows provider transaction IDs or raw provider data; read-only", () => {
    view();
    expect(table()).not.toHaveTextContent(/transaction id/i);
    expect(screen.queryByRole("button", { name: /re-?verify|mark|retry|refund|delete|cancel payment/i })).not.toBeInTheDocument();
  });

  it("exact search, status/provider filters and sorting go to the URL", () => {
    view();
    const search = screen.getByRole("searchbox", { name: "Exact reference or transaction ID" });
    fireEvent.change(search, { target: { value: "MCQA1B2C3D4E5F60718293A4B5C" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(new URL(String(router.replace.mock.lastCall?.[0]), "http://x").searchParams.get("search")).toBe("MCQA1B2C3D4E5F60718293A4B5C");
    fireEvent.change(screen.getAllByLabelText("Status")[0], { target: { value: "failed" } });
    expect(lastQuery().get("status")).toBe("failed");
    fireEvent.change(screen.getAllByLabelText("Provider")[0], { target: { value: "sslcommerz" } });
    expect(lastQuery().get("provider")).toBe("sslcommerz");
    fireEvent.change(screen.getAllByLabelText("Sort")[0], { target: { value: "-verified_at" } });
    expect(lastQuery().get("ordering")).toBe("-verified_at");
    fireEvent.click(within(table()).getByRole("button", { name: /Amount/ }));
    expect(lastQuery().get("ordering")).toBe("-amount");
    fireEvent.click(within(bodyRows()[2]).getByRole("button", { name: "Show payments for Silver" }));
    expect(lastQuery().get("package")).toBe("6");
    fireEvent.click(within(bodyRows()[0]).getByRole("button", { name: "All payments of Ayesha Siddika" }));
    expect(lastQuery().get("user")).toBe("40");
  });

  it("rows name the merchant account, mode and channel, and mark a test payment", () => {
    const bkash = { id: 9, slug: "bkash-main", name_en: "bKash main", name_bn: "বিকাশ মূল" };
    view(
      "",
      page([
        payment({ gateway: bkash, mode: "live", channel: "web" }),
        payment({
          payment_id: "cccccccc-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
          merchant_reference: "MCQTEST0000000000000000003",
          gateway: { id: 10, slug: "bkash-test", name_en: "bKash test", name_bn: "" },
          mode: "sandbox",
          channel: "app",
          is_test: true,
        }),
      ]),
    );
    // The list is drawn as a table and as phone cards, so each fact appears at least once.
    for (const name of ["Show payments through bKash main", "Show payments through bKash test"]) {
      expect(screen.getAllByRole("button", { name }).length).toBeGreaterThan(0);
    }
    for (const text of ["Live", "Sandbox", "Website", "Mobile app"]) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
  });

  it("clicking a gateway filters by it and shows its name in a chip", () => {
    const bkash = { id: 9, slug: "bkash-main", name_en: "bKash main", name_bn: "" };
    view("gateway=9", page([payment({ gateway: bkash, mode: "live", channel: "web" })]));
    expect(screen.getByText("bKash main", { selector: "span, p, div" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear the gateway filter" })).toBeInTheDocument();
  });

  it("mode and channel filters go to the URL", () => {
    view();
    fireEvent.change(screen.getAllByLabelText("Mode")[0], { target: { value: "sandbox" } });
    expect(lastQuery().get("mode")).toBe("sandbox");
    fireEvent.change(screen.getAllByLabelText("Paid from")[0], { target: { value: "app" } });
    expect(lastQuery().get("channel")).toBe("app");
  });

  it("sorted headers expose aria-sort", () => {
    view("ordering=-amount");
    expect(within(table()).getByRole("columnheader", { name: /Amount/ })).toHaveAttribute("aria-sort", "descending");
    expect(within(table()).getByRole("columnheader", { name: /Started/ })).toHaveAttribute("aria-sort", "none");
  });

  it("chips: student, package and subscription named from the server's reads; ids as fallback", () => {
    const gold = { id: 5, name_en: "Gold", name_bn: "গোল্ড", slug: "gold" } as Package;
    const sub = { id: 7, user: { id: 40, full_name: "Ayesha Siddika", mobile_display: "+88017*****101" }, package: gold } as unknown as AdminSubscription;
    const { unmount } = view("user=40&package=5&subscription=7", page(rows), {
      student: { id: 40, user: { id: 40, full_name: "Ayesha Siddika" } },
      pkg: { id: 5, pkg: gold },
      subscription: { id: 7, subscription: sub },
    });
    const filters = screen.getByRole("group", { name: "Filters" });
    expect(filters).toHaveTextContent("Student: Ayesha Siddika");
    expect(filters).toHaveTextContent("Package: Gold");
    expect(filters).toHaveTextContent("Subscription: #7 · Ayesha Siddika · Gold");
    expect(screen.queryByRole("columnheader", { name: /Package/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show payments of all subscriptions" }));
    expect(lastQuery().get("subscription")).toBeNull();
    expect(lastQuery().get("user")).toBe("40");
    unmount();
    view("user=40&package=5&subscription=7", page(rows), {
      student: { id: 40, user: null },
      pkg: { id: 5, pkg: null },
      subscription: { id: 7, subscription: null },
    });
    const group = screen.getByRole("group", { name: "Filters" });
    expect(group).toHaveTextContent("Student: Student #40");
    expect(group).toHaveTextContent("Package: Package #5");
    expect(group).toHaveTextContent("Subscription: Subscription #7");
  });

  it("pagination is server-side and kept in the URL", () => {
    view("status=success", page(rows, 45));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(lastQuery().get("page")).toBe("2");
    expect(lastQuery().get("status")).toBe("success");
  });

  it("student picker: bounded, students only, payments wording", async () => {
    const { calls } = mockApi(() => json(200, page([{ id: 55, full_name: "Tanvir Ahmed", mobile_display: "+88017*****102" }])));
    view();
    fireEvent.click(screen.getByRole("button", { name: "Choose student" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose a student" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Show payments of Tanvir Ahmed" }));
    expect(lastQuery().get("user")).toBe("55");
    const query = new URL(calls[0].url, "http://x").searchParams;
    expect(calls[0].url).toContain("/admin/users/");
    expect(query.get("role")).toBe("student");
    expect(query.get("page_size")).toBe("10");
  });

  it("package picker: bounded server search, latest response wins", async () => {
    let releaseOld: ((response: Response) => void) | null = null;
    const { calls } = mockApi(({ url }) => {
      const search = new URL(url, "http://x").searchParams.get("search");
      if (!search) return new Promise<Response>((resolve) => (releaseOld = resolve));
      return json(200, page([{ id: 6, name_en: "Silver", name_bn: "", slug: "silver", status: "active" }]));
    });
    view();
    fireEvent.click(screen.getByRole("button", { name: "Choose package" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose a package" });
    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "sil" } });
    fireEvent.keyDown(within(dialog).getByRole("searchbox"), { key: "Enter" });
    await within(dialog).findByText("Silver");
    await act(async () => releaseOld!(json(200, page([{ id: 9, name_en: "Old answer", name_bn: "", slug: "old", status: "active" }]))));
    expect(within(dialog).queryByText("Old answer")).not.toBeInTheDocument();
    for (const call of calls) {
      expect(call.url).toContain("/admin/packages/");
      expect(new URL(call.url, "http://x").searchParams.get("page_size")).toBe("10");
    }
    fireEvent.click(within(dialog).getByRole("button", { name: "Show payments for Silver" }));
    expect(lastQuery().get("package")).toBe("6");
  });

  it("empty, no-match (exact search hint) and Bangla", () => {
    const { unmount } = view("", page([]));
    expect(screen.getByText("No payments yet")).toBeInTheDocument();
    unmount();
    const second = view("search=MCQ123", page([]));
    expect(screen.getByText("No payments match these filters")).toBeInTheDocument();
    expect(screen.getByText(/needs the exact reference or transaction ID/)).toBeInTheDocument();
    second.unmount();
    view("", page(rows), { locale: "bn" });
    expect(screen.getByRole("heading", { level: 1, name: "পেমেন্ট" })).toBeInTheDocument();
    expect(bodyRows()[0]).toHaveTextContent("সফল");
    expect(bodyRows()[1]).toHaveTextContent("অপেক্ষমাণ");
    expect(bodyRows()[1]).toHaveTextContent("কারণ: ঝুঁকি যাচাইয়ের জন্য প্রোভাইডার আটকে রেখেছে");
    expect(screen.getByRole("searchbox", { name: "হুবহু রেফারেন্স বা ট্রানজ্যাকশন আইডি" })).toBeInTheDocument();
  });
});

describe("PaymentDetail", () => {
  const value = (scope: HTMLElement, label: string) =>
    within(scope)
      .getAllByText(label)
      .find((element) => element.tagName === "DT")!.nextElementSibling;

  const events: PaymentEvent[] = [
    { event_type: "initiated", created_at: "2026-10-01T08:00:00Z", summary: {} },
    { event_type: "status_changed", created_at: "2026-10-01T08:00:01Z", summary: { from: "initiated", to: "pending" } },
    { event_type: "callback_received", created_at: "2026-10-01T08:04:00Z", summary: { kind: "success", signature_valid: true } },
    { event_type: "verify_response", created_at: "2026-10-01T08:04:01Z", summary: { outcome: "paid", source: "success", reason: "apply_paid" } },
    { event_type: "status_changed", created_at: "2026-10-01T08:04:02Z", summary: { from: "pending", to: "success" } },
  ];
  function detail(overrides: Partial<AdminPaymentDetail> = {}): AdminPaymentDetail {
    return {
      ...payment(),
      provider_transaction_id: "BANKTXN123456",
      validity_days: 30,
      updated_at: "2026-10-01T08:05:00Z",
      last_checked_at: "2026-10-01T08:04:01Z",
      verification: { provider_status: "VALID", risk_level: "0", card_brand: "VISA", validated_on: "2026-10-01 14:04:01" },
      events,
      events_total: events.length,
      ...overrides,
    };
  }

  it("safe details: status, amount, masked student, links, transaction ID, provider summary", () => {
    renderPanel(<PaymentDetail payment={detail()} />);
    expect(screen.getByRole("heading", { level: 1, name: "MCQA1B2C3D4E5F60718293A4B5C" })).toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "Payment" });
    expect(value(summary, "Status")).toHaveTextContent("Successful");
    expect(value(summary, "Reason")).toHaveTextContent("None");
    expect(value(summary, "Amount")).toHaveTextContent("৳ 500.00");
    expect(value(summary, "Validity bought")).toHaveTextContent("30 days");
    expect(value(summary, "Provider")).toHaveTextContent("SSLCommerz");
    expect(value(summary, "Verified")).toHaveTextContent("1 Oct 2026");
    const who = screen.getByRole("region", { name: "Student and package" });
    expect(within(who).getByRole("link", { name: "Ayesha Siddika" })).toHaveAttribute("href", "/users/40");
    expect(value(who, "Mobile number")).toHaveTextContent("+88017*****101");
    expect(within(who).getByRole("link", { name: "Gold" })).toHaveAttribute("href", "/packages/5");
    expect(within(who).getByRole("link", { name: "Subscription #7" })).toHaveAttribute("href", "/subscriptions/7");
    const provider = screen.getByRole("region", { name: "Provider" });
    expect(value(provider, "Provider transaction ID")).toHaveTextContent("BANKTXN123456");
    expect(value(provider, "Provider status")).toHaveTextContent("VALID");
    expect(value(provider, "Risk level")).toHaveTextContent("0");
    expect(value(provider, "Payment method")).toHaveTextContent("VISA");
    expect(screen.getByRole("link", { name: "All payments of this student" })).toHaveAttribute("href", "/payments?user=40");
    expect(screen.getByRole("link", { name: "All payments for this package" })).toHaveAttribute("href", "/payments?package=5");
  });

  it("re-verify: asks first, then applies the provider's answer and reloads", async () => {
    router.refresh.mockReset();
    const { calls } = mockApi(() => json(200, detail({ status: "success" })));
    renderPanel(<PaymentDetail payment={detail({ status: "pending", failure_reason: "" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Re-verify with provider" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Ask the provider again?" });
    expect(dialog).toHaveTextContent("The server asks SSLCommerz for this payment");
    expect(calls).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Ask the provider" }));
    expect(await screen.findByText("Payment updated: Pending → Successful.")).toBeInTheDocument();
    expect(calls.map((call) => [call.method, call.url])).toEqual([["POST", `/api/v1/admin/payments/${detail().payment_id}/reverify/`]]);
    expect(router.refresh).toHaveBeenCalled();
  });

  it("re-verify: an unchanged answer, and the cooldown (429) message", async () => {
    let answer = () => json(200, detail({ status: "failed" }));
    mockApi(() => answer());
    renderPanel(<PaymentDetail payment={detail({ status: "failed" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Re-verify with provider" }));
    let dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Ask the provider" }));
    expect(await screen.findByText("The provider's answer did not change this payment.")).toBeInTheDocument();
    answer = () => apiError(429, "reverify_too_soon", "This payment was checked with the provider moments ago. Try again in 42 seconds.");
    fireEvent.click(screen.getByRole("button", { name: "Re-verify with provider" }));
    dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Ask the provider" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Try again in 42 seconds.");
  });

  it("re-verify: an 'already successful' conflict reloads the page", async () => {
    router.refresh.mockReset();
    mockApi(() => apiError(409, "already_successful", "This payment is already successful; there is nothing to verify again."));
    renderPanel(<PaymentDetail payment={detail({ status: "pending", failure_reason: "" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Re-verify with provider" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Ask the provider" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("already successful");
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("re-verify in Bangla", () => {
    renderPanel(<PaymentDetail payment={detail({ status: "cancelled" })} />, "bn");
    expect(screen.getByRole("button", { name: "প্রোভাইডারের কাছে পুনঃযাচাই" })).toBeInTheDocument();
  });

  it("a successful payment has no re-verify or any other action; no raw provider data, IPs or session keys rendered", () => {
    const { container } = renderPanel(<PaymentDetail payment={detail()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/re-?verify/i, { selector: "button, a" })).not.toBeInTheDocument();
    const text = container.textContent ?? "";
    for (const forbidden of ["raw_verification", "payload", "source_ip", "sessionkey", "provider_payment_id", "val_id", "checkout"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("timeline: ordered list, oldest first, short codes as labels", () => {
    renderPanel(<PaymentDetail payment={detail()} />);
    const timeline = screen.getByRole("region", { name: "Timeline" });
    expect(timeline).toHaveTextContent("5 events, oldest first.");
    const items = within(within(timeline).getByRole("list")).getAllByRole("listitem").filter((item) => item.hasAttribute("data-event-type"));
    expect(items.map((item) => item.getAttribute("data-event-type"))).toEqual([
      "initiated",
      "status_changed",
      "callback_received",
      "verify_response",
      "status_changed",
    ]);
    expect(items[0]).toHaveTextContent("Payment started");
    expect(items[1]).toHaveTextContent("Initiated → Pending");
    expect(items[2]).toHaveTextContent("Browser returned from the provider");
    expect(items[2]).toHaveTextContent("Via: Success return");
    expect(items[2]).toHaveTextContent("Signature: Valid");
    expect(items[3]).toHaveTextContent("Outcome: Paid");
    expect(items[3]).toHaveTextContent("Reason: Paid — applied");
    expect(items[4]).toHaveTextContent("Pending → Successful");
    expect(within(items[0]).getByText(/1 Oct 2026/).tagName).toBe("TIME");
  });

  it("capped timeline says how many are shown; unknown codes stay visible as codes", () => {
    renderPanel(
      <PaymentDetail
        payment={detail({
          events: [{ event_type: "brand_new_event", created_at: "2026-10-01T08:00:00Z", summary: { reason: "brand_new_reason", error: "http_502" } }],
          events_total: 120,
        })}
      />,
    );
    const timeline = screen.getByRole("region", { name: "Timeline" });
    expect(timeline).toHaveTextContent("Showing the latest 1 of 120 events, oldest first.");
    expect(timeline).toHaveTextContent("Code: brand_new_event");
    expect(timeline).toHaveTextContent("Reason: Code: brand_new_reason");
    expect(timeline).toHaveTextContent("Error: Code: http_502");
  });

  it("open payment: no subscription, no transaction ID, no verification; reason shown", () => {
    renderPanel(
      <PaymentDetail
        payment={detail({
          status: "pending",
          failure_reason: "grant_failed",
          subscription_id: null,
          provider_transaction_id: null,
          verified_at: null,
          last_checked_at: null,
          verification: null,
          events: [],
          events_total: 0,
        })}
      />,
    );
    const who = screen.getByRole("region", { name: "Student and package" });
    expect(value(who, "Subscription")).toHaveTextContent("No linked subscription");
    expect(within(who).queryByRole("link", { name: /Subscription/ })).not.toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "Payment" });
    expect(value(summary, "Status")).toHaveTextContent("Pending");
    expect(value(summary, "Reason")).toHaveTextContent("Paid, but the subscription could not be granted — needs review");
    expect(value(summary, "Verified")).toHaveTextContent("Not verified");
    expect(value(summary, "Last checked with the provider")).toHaveTextContent("Not checked yet");
    const provider = screen.getByRole("region", { name: "Provider" });
    expect(value(provider, "Provider transaction ID")).toHaveTextContent("None yet");
    expect(provider).toHaveTextContent("No verification answer stored yet.");
    expect(screen.getByRole("region", { name: "Timeline" })).toHaveTextContent("No events recorded.");
  });

  it("Bangla", () => {
    renderPanel(<PaymentDetail payment={detail()} />, "bn");
    expect(screen.getByRole("link", { name: "পেমেন্টের তালিকায় ফিরে যান" })).toHaveAttribute("href", "/payments");
    const timeline = screen.getByRole("region", { name: "টাইমলাইন" });
    expect(timeline).toHaveTextContent("পেমেন্ট শুরু");
    expect(timeline).toHaveTextContent("অপেক্ষমাণ → সফল");
    expect(screen.getByRole("region", { name: "শিক্ষার্থী ও প্যাকেজ" })).toHaveTextContent("গোল্ড");
  });
});
