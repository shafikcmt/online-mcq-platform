import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/users",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { UserDetail } from "@/components/users/user-detail";
import { UsersView } from "@/components/users/users-view";
import { USER_LIST } from "@/lib/content-specs";
import { parseListParams } from "@/lib/list-params";
import type { AdminUser, AdminUserDetail } from "@/types/users";

import { apiError, findToast, json, mockApi, page, renderPanel } from "./content-helpers";

function user(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 40,
    full_name: "Ayesha Siddika",
    display_name: "Ayesha",
    role: "student",
    preferred_language: "bn",
    is_active: true,
    is_mobile_verified: true,
    mobile_display: "+88017*****101",
    email_display: "a***@e***.com",
    date_joined: "2026-10-01T08:00:00Z",
    updated_at: "2026-10-02T08:00:00Z",
    ...overrides,
  };
}

const detail = (overrides: Partial<AdminUserDetail> = {}): AdminUserDetail => ({
  ...user(),
  attempts_count: 3,
  results_count: 2,
  active_subscriptions_count: 1,
  payments_count: 4,
  ...overrides,
});

const rows = [
  user(),
  user({
    id: 41,
    full_name: "Ops Admin",
    display_name: "",
    role: "admin",
    preferred_language: "en",
    is_active: false,
    is_mobile_verified: false,
    mobile_display: "+88016*****678",
    email_display: null,
  }),
];

const state = (query = "") => {
  window.history.replaceState({}, "", `/users${query ? `?${query}` : ""}`);
  return parseListParams(new URLSearchParams(query), USER_LIST);
};
const view = (query = "", data = page(rows), locale: "en" | "bn" = "en") =>
  renderPanel(<UsersView data={data} state={state(query)} />, locale);
const table = () => screen.getByRole("table");
const lastQuery = () => new URL(String(router.push.mock.lastCall?.[0]), "http://x").searchParams;
const bodyRows = () => within(table()).getAllByRole("row").slice(1);

beforeEach(() => {
  router.push.mockReset();
  router.replace.mockReset();
  router.refresh.mockReset();
});

describe("UsersView", () => {
  it("shows names, roles, masked contact, language, verification, status and join date", () => {
    view();
    const [first, second] = bodyRows();
    expect(first).toHaveTextContent("Ayesha Siddika");
    expect(first).toHaveTextContent("Ayesha");
    expect(first).toHaveTextContent("Student");
    expect(first).toHaveTextContent("+88017*****101");
    expect(first).toHaveTextContent("a***@e***.com");
    expect(first).toHaveTextContent("Partly hidden"); // announced as masked
    expect(first).toHaveTextContent("Bangla");
    expect(first).toHaveTextContent("Verified");
    expect(first).toHaveTextContent("Active");
    expect(first).toHaveTextContent("1 Oct 2026");
    expect(second).toHaveTextContent("Admin");
    expect(second).toHaveTextContent("No email");
    expect(second).toHaveTextContent("English");
    expect(second).toHaveTextContent("Not verified");
    expect(second).toHaveTextContent("Inactive");
    expect(within(first).getAllByRole("link", { name: "Open Ayesha Siddika" })[0]).toHaveAttribute("href", "/users/40");
    expect(screen.getByRole("columnheader", { name: /Contact \(partly hidden\)/ })).toBeInTheDocument();
  });

  it("is read-only: no edit, delete, deactivate, reveal or copy controls", () => {
    view();
    expect(screen.queryByRole("button", { name: /edit|delete|deactivate|activate|reveal|show|copy/i })).not.toBeInTheDocument();
    expect(document.querySelectorAll("[title*='*']")).toHaveLength(0);
  });

  it("filters, search and sorting go to the URL (server-side)", () => {
    view();
    expect(within(table()).getByRole("columnheader", { name: /Joined/ })).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(within(table()).getByRole("button", { name: /User/ }));
    expect(router.push).toHaveBeenLastCalledWith("/users?ordering=full_name", { scroll: false });
    const [roleSelect] = screen.getAllByLabelText("Role");
    fireEvent.change(roleSelect, { target: { value: "admin" } });
    expect(lastQuery().get("role")).toBe("admin");
    const [statusSelect] = screen.getAllByLabelText("Account");
    fireEvent.change(statusSelect, { target: { value: "false" } });
    expect(lastQuery().get("is_active")).toBe("false");
  });

  it("empty and no-match states", () => {
    const { unmount } = view("", page([]));
    expect(screen.getByText("No users yet")).toBeInTheDocument();
    unmount();
    view("role=admin", page([]));
    expect(screen.getByText("No users match these filters")).toBeInTheDocument();
  });

  it("renders in Bangla", () => {
    view("", page(rows), "bn");
    expect(screen.getByRole("heading", { level: 1, name: "ব্যবহারকারী" })).toBeInTheDocument();
    expect(bodyRows()[0]).toHaveTextContent("শিক্ষার্থী");
    expect(bodyRows()[0]).toHaveTextContent("আংশিক লুকানো");
    expect(bodyRows()[1]).toHaveTextContent("অ্যাডমিন");
    expect(bodyRows()[1]).toHaveTextContent("ইমেইল নেই");
  });
});

describe("UserDetail", () => {
  const value = (scope: HTMLElement, label: string) => within(scope).getByText(label).nextElementSibling;

  it("shows profile and account fields with masked contact details", () => {
    renderPanel(<UserDetail user={detail()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Ayesha Siddika" })).toBeInTheDocument();
    const profile = screen.getByRole("region", { name: "Profile" });
    expect(value(profile, "Display name")).toHaveTextContent("Ayesha");
    expect(value(profile, "Mobile number")).toHaveTextContent("+88017*****101");
    expect(value(profile, "Mobile number")).toHaveTextContent("Partly hidden");
    expect(value(profile, "Email")).toHaveTextContent("a***@e***.com");
    expect(value(profile, "Preferred language")).toHaveTextContent("Bangla");
    const account = screen.getByRole("region", { name: "Account" });
    expect(value(account, "Role")).toHaveTextContent("Student");
    expect(value(account, "Account status")).toHaveTextContent("Active");
    expect(value(account, "Mobile verification")).toHaveTextContent("Verified");
    expect(screen.getByText("Mobile numbers and emails are partly hidden to protect privacy.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to users" })).toHaveAttribute("href", "/users");
    // Read-only except one action: deactivating the student account.
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Deactivate account"]);
  });

  it("count cards link to their filtered lists: results, attempts, subscriptions and payments", () => {
    renderPanel(<UserDetail user={detail()} />);
    const activity = screen.getByRole("region", { name: "Activity" });
    const cards = within(activity).getAllByRole("listitem");
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining("Results2"),
      expect.stringContaining("Attempts3"),
      expect.stringContaining("Active subscriptions1"),
      expect.stringContaining("Payments4"),
    ]);
    expect(within(activity).getAllByRole("link")).toHaveLength(4);
    expect(within(activity).getByRole("link", { name: "View results" })).toHaveAttribute("href", "/results?user=40");
    expect(within(activity).getByRole("link", { name: "View attempts" })).toHaveAttribute("href", "/attempts?user=40");
    expect(within(activity).getByRole("link", { name: "View subscriptions" })).toHaveAttribute("href", "/subscriptions?user=40");
    expect(within(cards[3]).getByRole("link", { name: "View payments" })).toHaveAttribute("href", "/payments?user=40");
    expect(activity).not.toHaveTextContent("Screen not available yet");
    expect(within(activity).queryByRole("button")).not.toBeInTheDocument();
  });

  it("no display name or email; Bangla", () => {
    renderPanel(<UserDetail user={detail({ display_name: "", email_display: null })} />, "bn");
    const profile = screen.getByRole("region", { name: "প্রোফাইল" });
    expect(value(profile, "প্রদর্শিত নাম")).toHaveTextContent("দেওয়া হয়নি");
    expect(value(profile, "ইমেইল")).toHaveTextContent("ইমেইল নেই");
    expect(screen.getByRole("link", { name: "ফলাফল দেখুন" })).toHaveAttribute("href", "/results?user=40");
  });
});

describe("UserStatusActions (activate / deactivate a student)", () => {
  it("deactivates after a confirmation: POST with CSRF, toast, page reloaded", async () => {
    const { calls } = mockApi(() => json(200, detail({ is_active: false })));
    renderPanel(<UserDetail user={detail()} />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate account" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Deactivate this student?" });
    expect(dialog).toHaveTextContent("Ayesha Siddika will be signed out on every device at once");
    expect(calls).toHaveLength(0); // nothing before confirming
    fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toMatch(/\/admin\/users\/40\/deactivate\/$/);
    expect(calls[0].headers["X-CSRFToken"]).toBe("test-token");
    expect(await findToast()).toHaveTextContent("Account deactivated. The student has been signed out everywhere.");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("an inactive student can be activated again; Bangla", async () => {
    const { calls } = mockApi(() => json(200, detail()));
    renderPanel(<UserDetail user={detail({ is_active: false })} />, "bn");
    fireEvent.click(screen.getByRole("button", { name: "অ্যাকাউন্ট সক্রিয় করুন" }));
    const dialog = await screen.findByRole("alertdialog", { name: "এই শিক্ষার্থীকে আবার সক্রিয় করবেন?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "সক্রিয় করুন" }));
    await waitFor(() => expect(calls[0]?.url).toMatch(/\/admin\/users\/40\/activate\/$/));
  });

  it("cancel sends nothing", async () => {
    const { calls } = mockApi(() => json(200, detail()));
    renderPanel(<UserDetail user={detail()} />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate account" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep active" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(calls).toHaveLength(0);
  });

  it("the server's refusal is shown and the page reloads", async () => {
    mockApi(() => apiError(409, "not_a_student", "Only student accounts can be activated or deactivated here."));
    renderPanel(<UserDetail user={detail()} />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate account" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    expect(await within(dialog).findByText(/Only student accounts can be activated or deactivated here/)).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalled();
  });

  it("staff accounts have no such action", () => {
    renderPanel(<UserDetail user={detail({ role: "admin" })} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
