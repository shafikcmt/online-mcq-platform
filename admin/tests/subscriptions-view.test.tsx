import { act, fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/subscriptions",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { SubscriptionDetail } from "@/components/subscriptions/subscription-detail";
import { SubscriptionsView, type ServerPackage, type SubscriptionsStudent } from "@/components/subscriptions/subscriptions-view";
import { SUBSCRIPTION_LIST } from "@/lib/content-specs";
import { parseListParams } from "@/lib/list-params";
import type { Package } from "@/types/packages";
import type { AdminSubscription } from "@/types/subscriptions";

import { json, mockApi, page, renderPanel } from "./content-helpers";

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

const rows = [
  subscription(),
  // Stored active, but the server says it has expired (the expiry job has not run yet).
  subscription({ id: 8, user: { id: 41, full_name: "মাহমুদা আক্তার", mobile_display: "+88017*****103" }, effective_status: "expired" }),
  subscription({ id: 9, user: { id: 42, full_name: "Tanvir Ahmed", mobile_display: "+88017*****102" }, effective_status: "scheduled", package: { id: 6, slug: "silver", name_bn: "", name_en: "Silver" } }),
  subscription({ id: 10, status: "cancelled", effective_status: "cancelled" }),
];

const state = (query = "") => {
  window.history.replaceState({}, "", `/subscriptions${query ? `?${query}` : ""}`);
  return parseListParams(new URLSearchParams(query), SUBSCRIPTION_LIST);
};
function view(
  query = "",
  data = page(rows),
  { student = null, pkg = null, locale = "en" }: { student?: SubscriptionsStudent | null; pkg?: ServerPackage | null; locale?: "en" | "bn" } = {},
) {
  return renderPanel(<SubscriptionsView data={data} state={state(query)} student={student} pkg={pkg} />, locale);
}
const table = () => screen.getByRole("table");
const bodyRows = () => within(table()).getAllByRole("row").slice(1);
const lastQuery = () => new URL(String(router.push.mock.lastCall?.[0]), "http://x").searchParams;

beforeEach(() => {
  router.push.mockReset();
  router.replace.mockReset();
});

describe("SubscriptionsView", () => {
  it("rows: student with masked mobile, package, the server's effective status, period, paid", () => {
    view();
    const [active, lapsed, scheduled, cancelled] = bodyRows();
    expect(active).toHaveTextContent("Ayesha Siddika");
    expect(active).toHaveTextContent("+88017*****101");
    expect(active).toHaveTextContent("Partly hidden");
    expect(active).toHaveTextContent("Gold");
    expect(active).toHaveTextContent("Active");
    expect(active).not.toHaveTextContent("Recorded as");
    expect(active).toHaveTextContent("৳ 500.00");
    expect(active).toHaveTextContent("1 Oct 2026");
    expect(lapsed).toHaveTextContent("Expired");
    expect(lapsed).toHaveTextContent("Recorded as active"); // stored differs → shown secondarily
    expect(scheduled).toHaveTextContent("Scheduled");
    expect(cancelled).toHaveTextContent("Cancelled");
    expect(within(active).getAllByRole("link", { name: "Open subscription of Ayesha Siddika" })[0]).toHaveAttribute("href", "/subscriptions/7");
  });

  it("status is the server's effective_status, never derived from dates", () => {
    // Dates say "long expired", the server says active: the row says Active.
    view("", page([subscription({ starts_at: "2000-01-01T00:00:00Z", expires_at: "2000-02-01T00:00:00Z" })]));
    expect(bodyRows()[0]).toHaveTextContent("Active");
    expect(bodyRows()[0]).not.toHaveTextContent("Expired");
  });

  it("one Grant action in the header; rows have no extend, cancel or delete controls", () => {
    view();
    expect(screen.getByRole("button", { name: "Grant subscription" })).toBeInTheDocument();
    expect(within(table()).queryByRole("button", { name: /grant|extend|renew|cancel|delete/i })).not.toBeInTheDocument();
  });

  it("effective-status filter, sorting and the package/student shortcuts go to the URL", () => {
    view();
    fireEvent.change(screen.getAllByLabelText("Status")[0], { target: { value: "scheduled" } });
    expect(lastQuery().get("effective_status")).toBe("scheduled");
    fireEvent.click(within(table()).getByRole("button", { name: /Expires/ }));
    expect(lastQuery().get("ordering")).toBe("expires_at");
    fireEvent.click(within(bodyRows()[2]).getByRole("button", { name: "Show subscriptions of Silver" }));
    expect(lastQuery().get("package")).toBe("6");
    fireEvent.click(within(bodyRows()[0]).getByRole("button", { name: "All subscriptions of Ayesha Siddika" }));
    expect(lastQuery().get("user")).toBe("40");
  });

  it("chips name the student and package from the server's reads; fall back to ids", () => {
    const gold = { id: 5, name_en: "Gold", name_bn: "গোল্ড", slug: "gold" } as Package;
    const { unmount } = view("user=40&package=5", page(rows), {
      student: { id: 40, user: { id: 40, full_name: "Ayesha Siddika", mobile_display: "+88017*****101", role: "student" } },
      pkg: { id: 5, pkg: gold },
    });
    const filters = screen.getByRole("group", { name: "Filters" });
    expect(filters).toHaveTextContent("Student: Ayesha Siddika");
    expect(filters).toHaveTextContent("Package: Gold");
    expect(screen.queryByRole("columnheader", { name: /Package/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all packages" }));
    expect(lastQuery().get("package")).toBeNull();
    unmount();
    view("user=40&package=5", page(rows), { student: { id: 40, user: null }, pkg: { id: 5, pkg: null } });
    const group = screen.getByRole("group", { name: "Filters" });
    expect(group).toHaveTextContent("Student: Student #40");
    expect(group).toHaveTextContent("Package: Package #5");
  });

  it("package picker: bounded server search, latest response wins, choosing sets the filter", async () => {
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
    fireEvent.click(within(dialog).getByRole("button", { name: "Show subscriptions of Silver" }));
    expect(lastQuery().get("package")).toBe("6");
  });

  it("student picker: students only, bounded", async () => {
    const { calls } = mockApi(() => json(200, page([{ id: 55, full_name: "Tanvir Ahmed", mobile_display: "+88017*****102" }])));
    view();
    fireEvent.click(screen.getByRole("button", { name: "Choose student" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose a student" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Show results of Tanvir Ahmed" }));
    expect(lastQuery().get("user")).toBe("55");
    const query = new URL(calls[0].url, "http://x").searchParams;
    expect(query.get("role")).toBe("student");
    expect(query.get("page_size")).toBe("10");
  });

  it("empty, no-match and Bangla", () => {
    const { unmount } = view("", page([]));
    expect(screen.getByText("No subscriptions yet")).toBeInTheDocument();
    unmount();
    const second = view("effective_status=expired", page([]));
    expect(screen.getByText("No subscriptions match these filters")).toBeInTheDocument();
    second.unmount();
    view("", page(rows), { locale: "bn" });
    expect(screen.getByRole("heading", { level: 1, name: "সাবস্ক্রিপশন" })).toBeInTheDocument();
    expect(bodyRows()[1]).toHaveTextContent("মেয়াদোত্তীর্ণ");
    expect(bodyRows()[1]).toHaveTextContent("রেকর্ডে: সক্রিয়");
    expect(bodyRows()[2]).toHaveTextContent("নির্ধারিত");
  });
});

describe("SubscriptionDetail", () => {
  const value = (scope: HTMLElement, label: string) =>
    within(scope)
      .getAllByText(label)
      .find((element) => element.tagName === "DT")!.nextElementSibling;

  it("read-only details: effective and stored status, period, paid, masked mobile, links", () => {
    renderPanel(<SubscriptionDetail subscription={subscription({ effective_status: "expired" })} />);
    expect(screen.getByRole("heading", { level: 1, name: "Ayesha Siddika" })).toBeInTheDocument();
    const period = screen.getByRole("region", { name: "Period" });
    expect(value(period, "Status now")).toHaveTextContent("Expired");
    expect(value(period, "Recorded status")).toHaveTextContent("active");
    expect(value(period, "Starts")).toHaveTextContent("1 Oct 2026");
    expect(value(period, "Expires")).toHaveTextContent("31 Oct 2026");
    expect(value(period, "Total paid")).toHaveTextContent("৳ 500.00");
    const record = screen.getByRole("region", { name: "Record" });
    expect(value(record, "Mobile number")).toHaveTextContent("+88017*****101");
    expect(value(record, "Mobile number")).toHaveTextContent("Partly hidden");
    expect(within(record).getByRole("link", { name: "Ayesha Siddika" })).toHaveAttribute("href", "/users/40");
    expect(within(record).getByRole("link", { name: "Gold" })).toHaveAttribute("href", "/packages/5");
    expect(screen.getByRole("link", { name: "All subscriptions of this student" })).toHaveAttribute("href", "/subscriptions?user=40");
    expect(screen.getByRole("link", { name: "All subscriptions of this package" })).toHaveAttribute("href", "/subscriptions?package=5");
    expect(screen.getByRole("link", { name: "View payments" })).toHaveAttribute("href", "/payments?subscription=7");
    // Ended subscription: "Grant again" only — no cancel, and never any payment action.
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Grant again"]);
    expect(screen.getByText(/recorded in the audit log/)).toBeInTheDocument();
  });

  it("Bangla", () => {
    renderPanel(<SubscriptionDetail subscription={subscription({ effective_status: "scheduled" })} />, "bn");
    expect(screen.getByRole("region", { name: "মেয়াদকাল" })).toHaveTextContent("নির্ধারিত");
    expect(screen.getByRole("link", { name: "সাবস্ক্রিপশনের তালিকায় ফিরে যান" })).toHaveAttribute("href", "/subscriptions");
  });
});
