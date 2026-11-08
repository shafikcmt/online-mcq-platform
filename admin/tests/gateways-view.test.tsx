import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/payment-gateways",
  useSearchParams: () => new URLSearchParams(),
}));

import { GatewayDetailView } from "@/components/gateways/gateway-detail-view";
import { GatewayListView } from "@/components/gateways/gateway-list-view";
import { TestingView } from "@/components/gateways/testing-view";
import type { GatewayStats } from "@/types/gateways";
import type { AdminSubscription } from "@/types/subscriptions";

import { apiError, json, mockApi, renderPanel } from "./content-helpers";
import { bkashAdapter, gateway, nagadAdapter, stats } from "./gateway-fixtures";

const SECRET = "super-secret-value-123";
const ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => router.push.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("gateway list", () => {
  const view = (rows = [gateway()], over: Partial<GatewayStats> = {}) =>
    renderPanel(<GatewayListView gateways={rows} adapters={[bkashAdapter, nagadAdapter]} stats={stats(over)} />);

  it("shows gateways with mode, readiness, channels and the real/test statistics apart", () => {
    view();
    expect(screen.getByRole("link", { name: "bKash" })).toHaveAttribute("href", `/payment-gateways/${ID}`);
    expect(screen.getByText("Sandbox")).toBeInTheDocument();
    expect(screen.getByText("Not ready")).toBeInTheDocument();
    expect(screen.getByText("Website")).toBeInTheDocument();
    expect(screen.getByText("Mobile app")).toBeInTheDocument();
    const real = screen.getByRole("region", { name: "Real payments" });
    expect(within(real).getByText("৳ 1,500.00")).toBeInTheDocument();
    const test = screen.getByRole("region", { name: "Test payments (sandbox)" });
    expect(within(test).getByText("৳ 500.00")).toBeInTheDocument();
    expect(test).toHaveTextContent("never counted in revenue");
  });

  it("tells the admin when the server has payments switched off", () => {
    view([gateway()], { payment_switch: "unavailable" });
    const note = screen.getByText("Payments are switched off on the server");
    expect(note).toBeInTheDocument();
    expect(screen.getByText(/Students cannot pay, whatever is set below/)).toBeInTheDocument();
  });

  it("explains the environment fallback, and says nothing when only the panel's gateways run", () => {
    const { unmount } = view([gateway()], { payment_switch: "environment" });
    expect(screen.getByText("The server also has environment payment settings")).toBeInTheDocument();
    unmount();
    view([gateway()], { payment_switch: "database" });
    expect(screen.queryByText("Payments are switched off on the server")).not.toBeInTheDocument();
    expect(screen.queryByText("The server also has environment payment settings")).not.toBeInTheDocument();
  });

  it("lists providers without an adapter as not available", () => {
    view();
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
    expect(screen.getByText("Nagad")).toBeInTheDocument();
  });

  it("turning a gateway on posts to enable and shows the new state", async () => {
    const { calls } = mockApi(() => json(200, gateway({ enabled: true, issues: [] })));
    view();
    fireEvent.click(screen.getByRole("switch", { name: "Offer to students" }));
    expect(await screen.findByText("bKash is now offered to students.")).toBeInTheDocument();
    expect(calls[0]).toMatchObject({ method: "POST", url: `/api/v1/admin/payment-gateways/${ID}/enable/` });
    expect(screen.getByRole("switch", { name: "Offer to students" })).toBeChecked();
  });

  it("a refusal keeps it off and lists why", async () => {
    mockApi(() => apiError(409, "gateway_not_ready", "This gateway is not ready to be enabled."));
    view();
    fireEvent.click(screen.getByRole("switch", { name: "Offer to students" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This gateway is not ready to be enabled.");
    expect(alert).toHaveTextContent("Missing credential: app key");
    expect(screen.getByRole("switch", { name: "Offer to students" })).not.toBeChecked();
  });

  it("adds a gateway, refusing an unimplemented provider and a bad identifier, then opens it", async () => {
    const created = gateway({ id: "22222222-2222-4222-8222-222222222222", slug: "bkash-second" });
    const { calls } = mockApi(() => json(201, created));
    view();
    fireEvent.click(screen.getByRole("button", { name: "Add gateway" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a gateway" });
    expect(within(dialog).getByRole("option", { name: "Nagad (not implemented yet)" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Create gateway" }));
    expect(await within(dialog).findAllByText(/Choose a provider|2–40 lowercase/)).not.toHaveLength(0);
    expect(calls).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Provider/), { target: { value: "bkash" } });
    fireEvent.change(within(dialog).getByLabelText(/Identifier/), { target: { value: "bkash-second" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create gateway" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/payment-gateways/22222222-2222-4222-8222-222222222222"));
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/v1/admin/payment-gateways/", body: { adapter: "bkash", slug: "bkash-second" } });
  });

  it("an empty list explains the environment fallback", () => {
    view([]);
    expect(screen.getByText("No gateway is configured here yet")).toBeInTheDocument();
  });
});

describe("gateway detail", () => {
  const view = (g = gateway()) => renderPanel(<GatewayDetailView gateway={g} adapter={bkashAdapter} logs={[]} />);
  const logsAnswer = { results: [{ id: 1, event_type: "credential_changed", summary: "4 credential(s) set", details: {}, actor: "Ops", created_at: "2026-11-02T08:00:00Z" }] };

  it("shows saved secrets only as a hint, never a value", () => {
    view();
    expect(screen.getByText("Saved (…0001)")).toBeInTheDocument();
    for (const input of document.querySelectorAll<HTMLInputElement>("input[type=password]")) expect(input.value).toBe("");
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("saving credentials needs the password; a wrong one keeps the dialog open and sends nothing new", async () => {
    let attempts = 0;
    const { calls } = mockApi((call) => {
      if (call.url.endsWith("/credentials/")) {
        attempts += 1;
        return attempts === 1
          ? apiError(403, "password_confirmation_failed", "The password is not correct.")
          : json(200, { changed: ["app_key"], gateway: gateway({ issues: [] }) });
      }
      return json(200, logsAnswer);
    });
    view();
    const sandbox = document.querySelector('[data-mode="sandbox"]') as HTMLElement;
    fireEvent.change(within(sandbox).getByLabelText(/app key/i), { target: { value: SECRET } });
    fireEvent.click(within(sandbox).getByRole("button", { name: "Save credentials" }));
    const dialog = await screen.findByRole("dialog", { name: "Confirm your password" });
    fireEvent.change(within(dialog).getByLabelText("Your password"), { target: { value: "wrong" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(await within(dialog).findByText("The password is not correct.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Your password")).toHaveValue("");
    fireEvent.change(within(dialog).getByLabelText("Your password"), { target: { value: "Strong-Pass-2026" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const posts = calls.filter((c) => c.url.endsWith("/credentials/"));
    expect(posts[1].body).toEqual({ mode: "sandbox", values: { app_key: SECRET }, password: "Strong-Pass-2026" });
    expect(await screen.findByText("Credentials saved.")).toBeInTheDocument();
    expect((within(sandbox).getByLabelText(/app key/i) as HTMLInputElement).value).toBe("");
  });

  it("the save button stays off until something is typed", () => {
    view();
    const live = document.querySelector('[data-mode="live"]') as HTMLElement;
    expect(within(live).getByRole("button", { name: "Save credentials" })).toBeDisabled();
  });

  it("going live is blocked, with the checklist, until the server says it may", () => {
    view();
    expect(screen.getByText("Going live needs both of these:")).toBeInTheDocument();
    expect(screen.getByText("At least one successful sandbox payment on this gateway")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch to Live" })).toBeDisabled();
  });

  it("switching to live asks for the password and posts the mode", async () => {
    const ready = gateway({ live_blockers: [], has_sandbox_payment: true, issues: [] });
    const { calls } = mockApi((call) => (call.url.endsWith("/mode/") ? json(200, gateway({ mode: "live", live_blockers: [] })) : json(200, logsAnswer)));
    view(ready);
    expect(screen.getByText("Everything needed for live is in place.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Switch to Live" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Real students will be charged");
    fireEvent.change(within(dialog).getByLabelText("Your password"), { target: { value: "Strong-Pass-2026" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Mode changed to Live.")).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith("/mode/"))?.body).toEqual({ mode: "live", password: "Strong-Pass-2026" });
  });

  it("settings: sends only changes and shows the server's field errors", async () => {
    const { calls } = mockApi((call) =>
      call.method === "PATCH" ? apiError(400, "validation_error", "Invalid.", { web_return_url: ["Enter a full https:// address."] }) : json(200, logsAnswer),
    );
    view();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Nothing changed.")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Website return address"), { target: { value: "http://x.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Enter a full https:// address.")).toBeInTheDocument();
    expect(calls[0]).toMatchObject({ method: "PATCH", body: { web_return_url: "http://x.test" } });
  });

  it("website and app availability are separate switches", async () => {
    const { calls } = mockApi((call) => (call.method === "PATCH" ? json(200, gateway({ app_enabled: false })) : json(200, logsAnswer)));
    view();
    fireEvent.click(screen.getByRole("switch", { name: "Offer in the mobile app" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(calls[0]?.body).toEqual({ app_enabled: false }));
  });

  it("renders the provider's options from its schema", () => {
    view();
    expect(screen.getByLabelText("API version")).toHaveValue("v1.2.0-beta");
    expect(screen.getByLabelText("Request timeout (seconds)")).toHaveValue("15");
  });

  it("connection test: success, failure and 'not supported' are told apart", async () => {
    const answers = [
      { result: { supported: true, ok: true, message: "token_granted" }, gateway: gateway({ health: { status: "ok", last_test_at: "2026-11-02T08:00:00Z", last_connected_at: "2026-11-02T08:00:00Z", message: "" } }) },
      { result: { supported: true, ok: false, message: "token_refused" }, gateway: gateway() },
      { result: { supported: false, ok: false, message: "connection_test_not_supported" }, gateway: gateway() },
    ];
    mockApi((call) => (call.url.endsWith("/test/") ? json(200, answers.shift()) : json(200, logsAnswer)));
    view();
    const run = () => fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    run();
    expect(await screen.findByText(/Connection works/)).toBeInTheDocument();
    expect(screen.getAllByText("Connected").length).toBeGreaterThan(0);
    run();
    expect(await screen.findByText(/Connection failed: The provider refused the credentials/)).toBeInTheDocument();
    run();
    expect(await screen.findByText(/no safe connection check/)).toBeInTheDocument();
  });

  it("history lists entries and links the audit log", () => {
    renderPanel(<GatewayDetailView gateway={gateway()} adapter={bkashAdapter} logs={logsAnswer.results} />);
    expect(screen.getByText("Credentials changed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the full audit log" })).toHaveAttribute("href", "/audit-log?entity_type=payments.gateway");
  });

  it("works in Bangla", () => {
    renderPanel(<GatewayDetailView gateway={gateway()} adapter={bkashAdapter} logs={[]} />, "bn");
    expect(screen.getByRole("heading", { name: "বিকাশ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "লাইভে যান" })).toBeInTheDocument();
  });
});

describe("testers and test subscriptions", () => {
  const sub = (overrides: Partial<AdminSubscription> = {}): AdminSubscription => ({
    id: 9,
    user: { id: 5, full_name: "Tester One", mobile_display: "+88017*****678" },
    package: { id: 1, slug: "gold", name_bn: "গোল্ড", name_en: "Gold" },
    status: "active",
    effective_status: "active",
    starts_at: "2026-11-01T08:00:00Z",
    expires_at: "2026-12-01T08:00:00Z",
    price_paid: "500.00",
    currency: "BDT",
    is_test: true,
    created_at: "2026-11-01T08:00:00Z",
    updated_at: "2026-11-01T08:00:00Z",
    ...overrides,
  });
  const tester = { user_id: 5, full_name: "Tester One", mobile_number: "017*****678", added_at: "2026-11-01T08:00:00Z" };

  it("revokes a test subscription after confirmation", async () => {
    const { calls } = mockApi(() => json(200, { id: 9, status: "cancelled" }));
    renderPanel(<TestingView testers={[tester]} subscriptions={[sub()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Revoke: Tester One" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("proof for going live");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    expect(await screen.findByText("Test subscription revoked.")).toBeInTheDocument();
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/v1/admin/test-subscriptions/9/revoke/" });
    expect(screen.queryByRole("button", { name: "Revoke: Tester One" })).not.toBeInTheDocument();
    expect(screen.getByText("Revoked")).toBeInTheDocument();
  });

  it("a finished test subscription has no revoke button", () => {
    renderPanel(<TestingView testers={[]} subscriptions={[sub({ effective_status: "expired", status: "expired" })]} />);
    expect(screen.queryByRole("button", { name: /Revoke/ })).not.toBeInTheDocument();
  });

  it("finds a student and adds them as a tester; an existing tester is marked", async () => {
    const student = { id: 8, full_name: "Karim Uddin", mobile_display: "+88018*****111" };
    const { calls } = mockApi((call) =>
      call.method === "POST" ? json(201, { user_id: 8, full_name: "Karim Uddin", mobile_number: "018*****111", added_at: "2026-11-02T08:00:00Z" }) : json(200, { count: 2, next: null, previous: null, results: [student, { id: 5, full_name: "Tester One", mobile_display: "x" }] }),
    );
    renderPanel(<TestingView testers={[tester]} subscriptions={[]} />);
    fireEvent.change(screen.getByLabelText("Find a student"), { target: { value: "kar" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("Already a tester")).toBeInTheDocument();
    expect(calls[0].url).toContain("role=student");
    fireEvent.click(screen.getByRole("button", { name: "Add as tester: Karim Uddin" }));
    expect(await screen.findByText("Tester added.")).toBeInTheDocument();
    expect(calls[1]).toMatchObject({ method: "POST", url: "/api/v1/admin/payment-testers/", body: { user_id: 8 } });
  });

  it("removes a tester after confirmation", async () => {
    const { calls } = mockApi(() => json(204, undefined));
    renderPanel(<TestingView testers={[tester]} subscriptions={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove: Tester One" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Tester removed.")).toBeInTheDocument();
    expect(calls[0]).toMatchObject({ method: "DELETE", url: "/api/v1/admin/payment-testers/5/" });
  });
});
