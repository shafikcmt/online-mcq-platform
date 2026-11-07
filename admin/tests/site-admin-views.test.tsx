import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { AuditLogView } from "@/components/cms/audit-log-view";
import { ContactMessagesView } from "@/components/cms/contact-messages-view";
import { SettingsView } from "@/components/cms/settings-view";
import { AUDIT_LIST, CONTACT_LIST } from "@/lib/content-specs";
import { parseListParams, type ListSpec } from "@/lib/list-params";
import type { AuditEntry } from "@/types/audit";
import type { ContactMessage, SiteSettings } from "@/types/cms";

import { apiError, json, mockApi, page, renderPanel } from "./content-helpers";

const STAMP = "2026-10-01T08:00:00Z";

const settings = (overrides: Partial<SiteSettings> = {}): SiteSettings => ({
  platform_name_bn: "লাইভ মডেল টেস্ট",
  platform_name_en: "Live Model Test",
  tagline_bn: "",
  tagline_en: "Practise every day",
  address_bn: "",
  address_en: "",
  contact_email: "help@example.org",
  contact_phone: "",
  app_download_url: "",
  app_open_url: "",
  app_latest_version: "",
  app_min_version: "",
  app_update_note_bn: "",
  app_update_note_en: "",
  default_language: "bn",
  public_leaderboard_name_mode: "masked",
  app_leaderboard_name_mode: "masked",
  updated_at: null,
  ...overrides,
});

const message = (overrides: Partial<ContactMessage> = {}): ContactMessage => ({
  id: 11,
  name: "Karim Uddin",
  phone: "01711000000",
  email: "karim@example.org",
  subject: "Payment question",
  message: "I paid but…\nPlease check.",
  language: "en",
  status: "new",
  handled_by: null,
  created_at: STAMP,
  updated_at: STAMP,
  ...overrides,
});

const entry = (overrides: Partial<AuditEntry> = {}): AuditEntry => ({
  id: 101,
  created_at: STAMP,
  actor: 7,
  actor_name: "Ops Admin",
  action: "subscription.grant",
  entity_type: "subscriptions.subscription",
  entity_id: "42",
  summary: "subscription #42 · user #3 · package #1",
  metadata: { values: { price_paid: "500.00" } },
  ip_address: "203.0.113.5",
  ...overrides,
});

function state(path: string, spec: ListSpec, query = "") {
  window.history.replaceState({}, "", `${path}${query ? `?${query}` : ""}`);
  return parseListParams(new URLSearchParams(query), spec);
}

const lastQuery = () => new URL(String(router.push.mock.lastCall?.[0]), "http://x").searchParams;
const tableRows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);

beforeEach(() => {
  router.push.mockReset();
  router.replace.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("SettingsView", () => {
  it("shows the stored values and that they were never saved", () => {
    renderPanel(<SettingsView settings={settings()} />);
    expect(screen.getByText("Not saved yet — these are the server's defaults.")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Platform name/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/Contact e-mail/)).toHaveValue("help@example.org");
    expect(screen.getByLabelText("Default language")).toHaveValue("bn");
  });

  it("saves only the changed fields and adopts the server's normalized values", async () => {
    const { calls } = mockApi(() => json(200, settings({ contact_phone: "+8801711000000", app_leaderboard_name_mode: "initials", updated_at: STAMP })));
    renderPanel(<SettingsView settings={settings()} />);
    fireEvent.change(screen.getByLabelText(/Contact phone/), { target: { value: "01711000000" } });
    fireEvent.change(screen.getByLabelText("Names on the app leaderboard"), { target: { value: "initials" } });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Save settings" })[0]);
    expect(await screen.findByText("Settings saved.")).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toBe("/api/v1/admin/settings/");
    expect(calls[0].body).toEqual({ contact_phone: "01711000000", app_leaderboard_name_mode: "initials" });
    expect(screen.getByLabelText(/Contact phone/)).toHaveValue("+8801711000000");
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    expect(screen.getByText(/Last saved/)).toBeInTheDocument();
  });

  it("the app update notice: link, versions and note are saved together", async () => {
    const { calls } = mockApi(() => json(200, settings({ app_download_url: "https://files.example.org/app.apk", app_latest_version: "0.2.0", app_min_version: "0.1.0", app_update_note_en: "Bug fixes.", updated_at: STAMP })));
    renderPanel(<SettingsView settings={settings()} />);
    expect(screen.getByText("App update notice")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/App download link/), { target: { value: "https://files.example.org/app.apk" } });
    fireEvent.change(screen.getByLabelText(/Latest version/), { target: { value: "0.2.0" } });
    fireEvent.change(screen.getByLabelText(/Oldest version still allowed/), { target: { value: "0.1.0" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save settings" })[0]);
    expect(await screen.findByText("Settings saved.")).toBeInTheDocument();
    expect(calls[0].body).toEqual({ app_download_url: "https://files.example.org/app.apk", app_latest_version: "0.2.0", app_min_version: "0.1.0" });
  });

  it("shows the server's version error on the field", async () => {
    mockApi(() => apiError(400, "validation_error", "Invalid.", { app_min_version: ["The oldest allowed version cannot be newer than the latest."] }));
    renderPanel(<SettingsView settings={settings()} />);
    fireEvent.change(screen.getByLabelText(/Oldest version still allowed/), { target: { value: "9.0.0" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save settings" })[0]);
    expect(await screen.findAllByText("The oldest allowed version cannot be newer than the latest.")).not.toHaveLength(0);
  });

  it("nothing changed: no request", async () => {
    const { calls } = mockApi(() => json(200, settings()));
    renderPanel(<SettingsView settings={settings()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Save settings" })[0]);
    expect(await screen.findByText("Nothing changed.")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("server field errors appear under their fields", async () => {
    mockApi(() => apiError(400, "validation_error", "Invalid.", { app_download_url: ["Enter a full https:// address."] }));
    renderPanel(<SettingsView settings={settings()} />);
    fireEvent.change(screen.getByLabelText(/App download link/), { target: { value: "http://play" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save settings" })[0]);
    expect(await screen.findByText("Enter a full https:// address.")).toBeInTheDocument();
    expect(screen.getByLabelText(/App download link/)).toHaveAttribute("aria-invalid", "true");
  });

  it("Bangla", () => {
    renderPanel(<SettingsView settings={settings({ updated_at: STAMP })} />, "bn");
    expect(screen.getByRole("heading", { level: 1, name: "সাইট সেটিংস" })).toBeInTheDocument();
    expect(screen.getByText(/সর্বশেষ সংরক্ষণ/)).toBeInTheDocument();
  });
});

describe("ContactMessagesView", () => {
  const view = (rows: ContactMessage[] = [message()], query = "") =>
    renderPanel(<ContactMessagesView data={page(rows)} state={state("/contact-messages", CONTACT_LIST, query)} />);

  it("rows: sender, subject, status; filters go to the URL", () => {
    view([message(), message({ id: 12, name: "Rina", status: "resolved", subject: "" })]);
    const [first, second] = tableRows();
    expect(first).toHaveTextContent("Karim Uddin");
    expect(first).toHaveTextContent("Payment question");
    expect(first).toHaveTextContent("New");
    expect(second).toHaveTextContent("(no subject)");
    expect(second).toHaveTextContent("Resolved");
    fireEvent.change(screen.getAllByLabelText("Status")[0], { target: { value: "new" } });
    expect(lastQuery().get("status")).toBe("new");
  });

  it("the message dialog: full text, reply links; opening changes nothing", async () => {
    const { calls } = mockApi(() => json(200, message()));
    view();
    fireEvent.click(within(screen.getByRole("table")).getAllByRole("button", { name: "Open message from Karim Uddin" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Message from Karim Uddin" });
    expect(dialog).toHaveTextContent("I paid but…");
    expect(within(dialog).getByRole("link", { name: "Phone: 01711000000" })).toHaveAttribute("href", "tel:01711000000");
    expect(within(dialog).getByRole("link", { name: "E-mail: karim@example.org" })).toHaveAttribute("href", "mailto:karim@example.org");
    expect(within(dialog).getAllByRole("button").map((button) => button.textContent)).toContain("Mark resolved");
    expect(calls).toHaveLength(0);
  });

  it("status change: PATCH {status}, the dialog and the list update", async () => {
    const { calls } = mockApi((call) =>
      call.method === "PATCH" ? json(200, message({ status: "resolved", handled_by: { id: 7, full_name: "Ops Admin" } })) : json(200, page([message({ status: "resolved" })])),
    );
    view();
    fireEvent.click(within(screen.getByRole("table")).getAllByRole("button", { name: "Open message from Karim Uddin" })[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark resolved" }));
    expect(await screen.findByText("Marked as Resolved.")).toBeInTheDocument();
    expect(calls.find((call) => call.method === "PATCH")).toMatchObject({ url: "/api/v1/admin/contact-messages/11/", body: { status: "resolved" } });
    expect(within(dialog).getByText("Last changed by Ops Admin")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Mark as new" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Mark resolved" })).not.toBeInTheDocument();
    await waitFor(() => expect(calls.some((call) => call.method === "GET")).toBe(true));
  });

  it("a failed status change is shown in the dialog", async () => {
    mockApi(() => apiError(404, "not_found", "Not found."));
    view();
    fireEvent.click(within(screen.getByRole("table")).getAllByRole("button", { name: "Open message from Karim Uddin" })[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as read" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Not found.");
  });
});

describe("AuditLogView", () => {
  const view = (rows: AuditEntry[] = [entry()], query = "", locale: "en" | "bn" = "en") =>
    renderPanel(<AuditLogView data={page(rows)} state={state("/audit-log", AUDIT_LIST, query)} />, locale);

  it("rows: who, readable action, record and summary; system entries and unknown actions", () => {
    view([entry(), entry({ id: 102, actor: null, actor_name: null, action: "future.thing", entity_type: "new.kind" })]);
    const [granted, system] = tableRows();
    expect(granted).toHaveTextContent("Ops Admin");
    expect(granted).toHaveTextContent("Subscription granted");
    expect(granted).toHaveTextContent("Subscription #42");
    expect(granted).toHaveTextContent("subscription #42 · user #3");
    expect(system).toHaveTextContent("System");
    expect(system).toHaveTextContent("future.thing");
    expect(system).toHaveTextContent("new.kind #42");
  });

  it("filters: action and record type selects; one admin; one record's history", () => {
    view();
    fireEvent.change(screen.getAllByLabelText("Action")[0], { target: { value: "subscription.cancel" } });
    expect(lastQuery().get("action")).toBe("subscription.cancel");
    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "Only changes by Ops Admin" }));
    expect(lastQuery().get("actor")).toBe("7");
    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "History of this record" }));
    expect(lastQuery().get("entity_type")).toBe("subscriptions.subscription");
    expect(lastQuery().get("entity_id")).toBe("42");
  });

  it("chips name the filtered admin and record", () => {
    view([entry()], "actor=7&entity_type=subscriptions.subscription&entity_id=42");
    const chips = screen.getByRole("group", { name: "Filters" });
    expect(chips).toHaveTextContent("Ops Admin");
    expect(chips).toHaveTextContent("Subscription #42");
  });

  it("details: metadata as text, IP, a link to the record", async () => {
    view();
    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "Details of entry #101" }));
    const dialog = await screen.findByRole("dialog", { name: "Audit entry #101" });
    expect(dialog).toHaveTextContent("203.0.113.5");
    expect(within(dialog).getByText(/"price_paid": "500.00"/)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Open this record" })).toHaveAttribute("href", "/subscriptions/42");
  });

  it("no way to change an entry; Bangla labels", () => {
    view([entry()], "", "bn");
    expect(screen.getByRole("heading", { level: 1, name: "অডিট লগ" })).toBeInTheDocument();
    expect(tableRows()[0]).toHaveTextContent("সাবস্ক্রিপশন দেওয়া");
    expect(screen.queryByRole("button", { name: /delete|edit|মুছুন|সম্পাদনা/i })).not.toBeInTheDocument();
  });
});
