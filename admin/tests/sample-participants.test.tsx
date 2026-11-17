import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { ExamSampleParticipants } from "@/components/exams/exam-sample-participants";
import { SamplePeopleView } from "@/components/sample/sample-people-view";
import { SAMPLE_PERSON_LIST } from "@/lib/content-specs";
import { parseListParams } from "@/lib/list-params";
import type { SamplePerson } from "@/types/sample";

import { apiError, json, mockApi, page, renderPanel } from "./content-helpers";

const STAMP = "2026-10-01T08:00:00Z";
const person = (over: Partial<SamplePerson> = {}): SamplePerson => ({ id: 1, name: "Nusrat Jahan", is_active: true, exam_count: 2, created_at: STAMP, updated_at: STAMP, ...over });

function state(query = "") {
  window.history.replaceState({}, "", `/sample-participants${query ? `?${query}` : ""}`);
  return parseListParams(new URLSearchParams(query), SAMPLE_PERSON_LIST);
}
const view = (rows: SamplePerson[] = [person()], locale: "en" | "bn" = "en") => renderPanel(<SamplePeopleView data={page(rows)} state={state()} />, locale);

beforeEach(() => {
  router.push.mockReset();
  router.replace.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("Sample participants library", () => {
  it("says clearly that they are not real students and lists name, status and exams", () => {
    view([person(), person({ id: 2, name: "Zafar", is_active: false, exam_count: 0 })]);
    expect(screen.getByText(/not real students/)).toBeInTheDocument();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Nusrat Jahan")).toBeInTheDocument();
    expect(within(rows[0]).getByText("2")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Inactive")).toBeInTheDocument();
  });

  it("adds many names at once: one per line, blanks dropped, and says how many were skipped", async () => {
    const { calls } = mockApi((call) => (call.method === "POST" ? json(201, { created: 2, skipped: 1 }) : json(200, page([person()]))));
    view();
    fireEvent.click(screen.getByRole("button", { name: "Add many names" }));
    const dialog = await screen.findByRole("dialog", { name: "Add many sample participants" });
    const add = () => within(dialog).getByRole("button", { name: /^Add \d+ names$/ });
    expect(add()).toBeDisabled(); // nothing written yet
    fireEvent.change(within(dialog).getByLabelText(/Names/), { target: { value: "Rahim\n\n  Karim  \nSalma" } });
    expect(within(dialog).getByText("3 of 200 names")).toBeInTheDocument();
    fireEvent.click(add());
    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    const post = calls.find((call) => call.method === "POST");
    expect(post?.url).toMatch(/\/admin\/sample-participants\/bulk\/$/);
    expect(post?.body).toEqual({ names: ["Rahim", "Karim", "Salma"] });
    expect(await screen.findByText("2 added; 1 were already in the list.")).toBeInTheDocument();
  });

  it("refuses more than 200 names or an over-long name before sending anything", async () => {
    const { calls } = mockApi(() => json(200, page([person()])));
    view();
    fireEvent.click(screen.getByRole("button", { name: "Add many names" }));
    const dialog = await screen.findByRole("dialog", { name: "Add many sample participants" });
    fireEvent.change(within(dialog).getByLabelText(/Names/), { target: { value: Array.from({ length: 201 }, (_, i) => `Name ${i}`).join("\n") } });
    expect(within(dialog).getByText(/At most 200 names at a time/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^Add 201 names$/ })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Names/), { target: { value: "x".repeat(121) } });
    expect(within(dialog).getByText(/at most 120 characters/)).toBeInTheDocument();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("creates one (name only: no account or phone)", async () => {
    const { calls } = mockApi((call) => (call.method === "POST" ? json(201, person({ id: 9 })) : json(200, page([person()]))));
    view();
    fireEvent.click(screen.getByRole("button", { name: "New sample participant" }));
    const dialog = await screen.findByRole("dialog", { name: "New sample participant" });
    expect(within(dialog).getByText(/no account, phone number or login/i)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: "Mina Akter" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Sample participant created.")).toBeInTheDocument();
    const post = calls.find((call) => call.method === "POST")!;
    expect(post.url).toBe("/api/v1/admin/sample-participants/");
    expect(post.body).toEqual({ name: "Mina Akter", is_active: true });
  });

  it("shows the server's field error and keeps the dialog open", async () => {
    mockApi((call) => (call.method === "POST" ? apiError(400, "validation_error", "Invalid", { name: ["Enter a name."] }) : json(200, page([person()]))));
    view();
    fireEvent.click(screen.getByRole("button", { name: "New sample participant" }));
    const dialog = await screen.findByRole("dialog", { name: "New sample participant" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await within(dialog).findByText("Enter a name.")).toBeInTheDocument();
  });

  it("explains why a participant in an exam cannot be deleted", async () => {
    mockApi((call) =>
      call.method === "DELETE" ? apiError(409, "in_use", "This sample participant is in an exam. Remove it from the exams first.") : json(200, page([person()])),
    );
    view();
    fireEvent.click(screen.getAllByRole("button", { name: "Delete Nusrat Jahan" })[0]);
    const confirm = await screen.findByRole("alertdialog", { name: "Delete this sample participant?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText(/in an exam/)).toBeInTheDocument();
  });

  it("is available in Bangla", () => {
    view([person()], "bn");
    expect(screen.getAllByText("স্যাম্পল অংশগ্রহণকারী").length).toBeGreaterThan(0);
  });
});

describe("Exam sample participants section", () => {
  const entries = (list: { person: number; name: string; marks: string; is_active?: boolean }[] = []) => ({
    total_marks: "30.00",
    entries: list.map((entry) => ({ is_active: true, ...entry })),
  });
  const library = [person({ id: 1, name: "Nusrat Jahan" }), person({ id: 2, name: "Zafar" })];

  const handler = (initial = entries(), onPut?: (body: unknown) => void) => (call: { method: string; url: string; body?: unknown }) => {
    if (call.method === "PUT") {
      onPut?.(call.body);
      const body = call.body as { entries: { person: number; marks: string }[] };
      return json(200, entries(body.entries.map((entry) => ({ ...entry, name: library.find((p) => p.id === entry.person)!.name, marks: Number(entry.marks).toFixed(2) }))));
    }
    return call.url.includes("/exams/") ? json(200, initial) : json(200, page(library));
  };

  it("shows the labelled description and an empty state with a way to add", async () => {
    mockApi(handler());
    renderPanel(<ExamSampleParticipants examId={5} />);
    expect(await screen.findByText("No sample participants in this exam")).toBeInTheDocument();
    expect(screen.getByText(/clearly labelled list/)).toBeInTheDocument();
    expect(screen.getByText("Total marks of this exam: 30.00")).toBeInTheDocument();
  });

  it("adds a participant with marks and saves the complete list", async () => {
    let sent: unknown;
    mockApi(handler(entries(), (body) => (sent = body)));
    renderPanel(<ExamSampleParticipants examId={5} />);
    await screen.findByText("No sample participants in this exam");
    fireEvent.click(screen.getByRole("button", { name: "Add participant" }));
    fireEvent.change(screen.getByLabelText("Sample participant 1"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Marks 1"), { target: { value: "24.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save sample participants" }));
    expect(await screen.findByText("Sample participants saved.")).toBeInTheDocument();
    expect(sent).toEqual({ entries: [{ person: 2, marks: "24.5" }] });
    expect((screen.getByLabelText("Marks 1") as HTMLInputElement).value).toBe("24.50");
  });

  it("will not send marks above the exam total, or a line with nobody chosen", async () => {
    const { calls } = mockApi(handler());
    renderPanel(<ExamSampleParticipants examId={5} />);
    await screen.findByText("No sample participants in this exam");
    fireEvent.click(screen.getByRole("button", { name: "Add participant" }));
    fireEvent.change(screen.getByLabelText("Marks 1"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save sample participants" }));
    expect(await screen.findByText("Choose a sample participant for every line.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Sample participant 1"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Marks 1"), { target: { value: "31" } });
    fireEvent.click(screen.getByRole("button", { name: "Save sample participants" }));
    expect(await screen.findByText("Enter marks between 0 and 30.00.")).toBeInTheDocument();
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("a person already chosen cannot be chosen again on another line", async () => {
    mockApi(handler(entries([{ person: 1, name: "Nusrat Jahan", marks: "10.00" }])));
    renderPanel(<ExamSampleParticipants examId={5} />);
    await screen.findByLabelText("Marks 1");
    fireEvent.click(screen.getByRole("button", { name: "Add participant" }));
    const second = screen.getByLabelText("Sample participant 2") as HTMLSelectElement;
    expect(within(second).getByRole("option", { name: "Nusrat Jahan" })).toBeDisabled();
    expect(within(second).getByRole("option", { name: "Zafar" })).not.toBeDisabled();
  });

  it("removing a line makes the form unsaved", async () => {
    mockApi(handler(entries([{ person: 1, name: "Nusrat Jahan", marks: "10.00" }])));
    renderPanel(<ExamSampleParticipants examId={5} />);
    await screen.findByLabelText("Marks 1");
    expect(screen.getByRole("button", { name: "Save sample participants" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Remove line 1" }));
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save sample participants" })).toBeEnabled());
  });

  it("a failed load says so", async () => {
    mockApi(() => apiError(500, "server_error", "Boom"));
    renderPanel(<ExamSampleParticipants examId={5} />);
    expect(await screen.findByText("Could not load the sample participants.")).toBeInTheDocument();
  });
});
