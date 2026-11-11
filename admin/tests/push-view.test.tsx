import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { PushView } from "@/components/push/push-view";
import { PUSH_LIST } from "@/lib/content-specs";
import { parseListParams } from "@/lib/list-params";
import type { PushMessage, PushStatusInfo } from "@/types/push";

import { apiError, json, mockApi, page, renderPanel } from "./content-helpers";

const STAMP = "2026-10-01T08:00:00Z";
const message = (over: Partial<PushMessage> = {}): PushMessage => ({
  id: 1,
  kind: "manual",
  title_bn: "",
  title_en: "Schedule change",
  body_bn: "",
  body_en: "Friday's test moves to Saturday.",
  exam: null,
  exam_label: "",
  reminder_offset: null,
  status: "sent",
  device_count: 120,
  sent_count: 118,
  failed_count: 2,
  created_at: STAMP,
  sent_at: STAMP,
  ...over,
});
const ON: PushStatusInfo = { enabled: true, devices: 120, reminder_offsets: [1440, 60] };
const OFF: PushStatusInfo = { enabled: false, devices: 0, reminder_offsets: [] };
const exams = [{ id: 5, title_bn: "", title_en: "Physics test", status: "published" }];

function state(query = "") {
  window.history.replaceState({}, "", `/push${query ? `?${query}` : ""}`);
  return parseListParams(new URLSearchParams(query), PUSH_LIST);
}
const view = (rows: PushMessage[] = [message()], status = ON, locale: "en" | "bn" = "en") =>
  renderPanel(<PushView data={page(rows)} state={state()} status={status} exams={exams} />, locale);

beforeEach(() => {
  router.push.mockReset();
  router.replace.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("Push notifications screen", () => {
  it("shows that push is on, the phones and the automatic reminders", () => {
    view();
    expect(screen.getByText("Push is switched on")).toBeInTheDocument();
    expect(screen.getByText("Phones registered: 120")).toBeInTheDocument();
    expect(screen.getByText("Automatic exam reminders: 1 day, 1 hour before the start")).toBeInTheDocument();
  });

  it("says plainly when push is off on the server", () => {
    view([], OFF);
    expect(screen.getByText(/switched off on the server/)).toBeInTheDocument();
    expect(screen.getByText(/PUSH_ENABLED/)).toBeInTheDocument();
    expect(screen.getByText("Automatic exam reminders: none")).toBeInTheDocument();
  });

  it("lists the history with type, status and how many phones received it", () => {
    view([message(), message({ id: 2, kind: "exam_reminder", status: "disabled", title_en: "Exam reminder", exam_label: "Physics test" })]);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Admin message")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Sent")).toBeInTheDocument();
    expect(within(rows[0]).getByText("118 of 120")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Exam reminder", { selector: "td span, td span span" })).toBeInTheDocument();
    expect(within(rows[1]).getByText("Not sent (push off)")).toBeInTheDocument();
  });

  it("asks for a confirmation before sending, then sends the text and the chosen exam", async () => {
    const { calls } = mockApi((call) => (call.method === "POST" ? json(201, message({ id: 9, status: "pending" })) : json(200, page([message()]))));
    view();
    fireEvent.change(screen.getAllByLabelText(/English/)[0], { target: { value: "Reminder" } });
    fireEvent.change(screen.getAllByLabelText(/English/)[1], { target: { value: "Test at 8 pm." } });
    fireEvent.change(screen.getByLabelText(/Open this exam/), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Send this message to every phone?" });
    expect(within(confirm).getByText(/120 registered phones will receive it/)).toBeInTheDocument();
    expect(calls.some((call) => call.method === "POST")).toBe(false); // nothing sent yet
    fireEvent.click(within(confirm).getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Message queued.")).toBeInTheDocument();
    const post = calls.find((call) => call.method === "POST")!;
    expect(post.url).toBe("/api/v1/admin/push/messages/");
    expect(post.body).toEqual({ title_bn: "", title_en: "Reminder", body_bn: "", body_en: "Test at 8 pm.", exam: 5 });
  });

  it("will not even ask when no language is complete", () => {
    view();
    fireEvent.change(screen.getAllByLabelText(/English/)[0], { target: { value: "Only a title" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getAllByText(/Fill in at least one language/).length).toBeGreaterThan(0);
  });

  it("while push is off the confirmation says it will only be saved", async () => {
    mockApi(() => json(200, page([])));
    view([], OFF);
    fireEvent.change(screen.getAllByLabelText(/English/)[0], { target: { value: "A" } });
    fireEvent.change(screen.getAllByLabelText(/English/)[1], { target: { value: "B" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText(/only be saved in the history/)).toBeInTheDocument();
  });

  it("shows the server's error and keeps what was typed", async () => {
    mockApi((call) => (call.method === "POST" ? apiError(400, "validation_error", "Invalid", { body_en: ["Enter a title and a text in Bangla or English."] }) : json(200, page([]))));
    view();
    fireEvent.change(screen.getAllByLabelText(/English/)[0], { target: { value: "A" } });
    fireEvent.change(screen.getAllByLabelText(/English/)[1], { target: { value: "B" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Send" }));
    expect(await screen.findAllByText("Enter a title and a text in Bangla or English.")).not.toHaveLength(0);
    expect((screen.getAllByLabelText(/English/)[0] as HTMLInputElement).value).toBe("A");
  });

  it("empty history and Bangla", () => {
    view([], ON, "bn");
    expect(screen.getAllByText("পুশ নোটিফিকেশন").length).toBeGreaterThan(0);
    expect(screen.getByText("এখনো কোনো বার্তা নেই")).toBeInTheDocument();
  });
});
