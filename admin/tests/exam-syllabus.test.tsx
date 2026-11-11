import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExamSyllabus } from "@/components/exams/exam-syllabus";
import { blankLine, fromServer, moveLine, sameSyllabus, toPayload } from "@/lib/syllabus";
import type { SyllabusLineData } from "@/types/syllabus";

import { apiError, json, mockApi, renderPanel } from "./content-helpers";

const ROWS: SyllabusLineData[] = [
  { subject: "Physics", chapter: "Motion", topic: "Speed" },
  { subject: "", chapter: "পদার্থ পরিচিতি", topic: "পরিমাপ" },
];

const view = (initial = ROWS, locale: "en" | "bn" = "en") => renderPanel(<ExamSyllabus examId={9} initial={initial} />, locale);
const topic = (line: number) => screen.getByLabelText(`Line ${line}: Topic`) as HTMLInputElement;

describe("exam syllabus editor", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the saved lines in order and nothing to save yet", () => {
    view();
    expect(topic(1)).toHaveValue("Speed");
    expect(topic(2)).toHaveValue("পরিমাপ");
    expect(screen.getByRole("button", { name: "Save syllabus" })).toBeDisabled();
  });

  it("an empty syllabus says so and invites the first line", () => {
    view([]);
    expect(screen.getByText("No syllabus yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add line" }));
    expect(screen.getByLabelText("Line 1: Subject")).toBeInTheDocument();
  });

  it("editing marks it unsaved; saving sends the COMPLETE list in order (PUT) and re-reads the answer", async () => {
    const { calls } = mockApi((call) => json(200, call.body));
    view();
    fireEvent.change(topic(1), { target: { value: "Velocity" } });
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Move line 2 up" }));
    fireEvent.click(screen.getByRole("button", { name: "Save syllabus" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url).toMatch(/\/admin\/exams\/9\/syllabus\/$/);
    expect(calls[0].body).toEqual({
      syllabus: [
        { subject: "", chapter: "পদার্থ পরিচিতি", topic: "পরিমাপ" },
        { subject: "Physics", chapter: "Motion", topic: "Velocity" },
      ],
    });
    await waitFor(() => expect(screen.queryByText("You have unsaved changes.")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Save syllabus" })).toBeDisabled();
  });

  it("removing a line and a stray blank line: the blank one is left out, the rest is sent", async () => {
    const { calls } = mockApi((call) => json(200, call.body));
    view();
    fireEvent.click(screen.getByRole("button", { name: "Remove line 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Add line" })); // a blank line is left in place
    fireEvent.click(screen.getByRole("button", { name: "Save syllabus" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect((calls[0].body as { syllabus: unknown[] }).syllabus).toEqual([{ subject: "Physics", chapter: "Motion", topic: "Speed" }]);
  });

  it("removing every line saves an explicit empty list", async () => {
    const { calls } = mockApi((call) => json(200, call.body));
    view([ROWS[0]]);
    fireEvent.click(screen.getByRole("button", { name: "Remove line 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Save syllabus" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ syllabus: [] });
  });

  it("the server's refusal is shown and the typed lines stay", async () => {
    mockApi(() => apiError(400, "validation_error", "Line 1 is empty: fill the subject, chapter or topic."));
    view();
    fireEvent.change(topic(1), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save syllabus" }));
    expect(await screen.findByText(/Line 1 is empty/)).toBeInTheDocument();
    expect(topic(1)).toHaveValue("Changed");
    expect(screen.getByRole("button", { name: "Save syllabus" })).toBeEnabled();
  });

  it("the first line cannot move up and the last cannot move down", () => {
    view();
    expect(screen.getByRole("button", { name: "Move line 1 up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move line 2 down" })).toBeDisabled();
  });

  it("is available in Bangla", () => {
    view(ROWS, "bn");
    expect(screen.getByText("সিলেবাস")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "লাইন যোগ করুন" })).toBeInTheDocument();
  });
});

describe("syllabus helpers", () => {
  it("toPayload drops client keys and fully blank lines, keeps the order", () => {
    const lines = [...fromServer(ROWS), blankLine(), { ...blankLine(), topic: "  " }];
    expect(toPayload(lines)).toEqual(ROWS);
  });

  it("sameSyllabus ignores keys and blank lines", () => {
    expect(sameSyllabus([...fromServer(ROWS), blankLine()], ROWS)).toBe(true);
    expect(sameSyllabus(fromServer([ROWS[1], ROWS[0]]), ROWS)).toBe(false);
    expect(sameSyllabus([], ROWS)).toBe(false);
  });

  it("moveLine stays in range", () => {
    const lines = fromServer(ROWS);
    expect(moveLine(lines, 0, -1)).toBe(lines);
    expect(moveLine(lines, 1, 1)).toBe(lines);
    expect(moveLine(lines, 0, 1).map((line) => line.topic)).toEqual(["পরিমাপ", "Speed"]);
  });
});
