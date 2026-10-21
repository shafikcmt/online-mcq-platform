import { act, fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/attempts",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { AttemptDetail } from "@/components/attempts/attempt-detail";
import { AttemptsView } from "@/components/attempts/attempts-view";
import type { ServerExam, ServerStudent } from "@/components/results/results-view";
import { ATTEMPT_LIST } from "@/lib/content-specs";
import { parseListParams } from "@/lib/list-params";
import type { AdminAttempt, AdminAttemptDetail } from "@/types/attempts";

import { exam, json, mockApi, page, renderPanel } from "./content-helpers";

const FINISHED = "6f1c2b9e-1d2a-4c3b-8e4f-5a6b7c8d9e01";
const OPEN = "6f1c2b9e-1d2a-4c3b-8e4f-5a6b7c8d9e02";

function attempt(overrides: Partial<AdminAttempt> = {}): AdminAttempt {
  return {
    attempt_id: FINISHED,
    exam_id: 7,
    exam_title_bn: "মডেল টেস্ট",
    exam_title_en: "Model test",
    user_id: 40,
    user_full_name: "Ayesha Siddika",
    attempt_no: 1,
    status: "submitted",
    started_at: "2026-10-01T08:00:00Z",
    deadline_at: "2026-10-01T08:30:00Z",
    submitted_at: "2026-10-01T08:12:00Z",
    submit_source: "manual",
    content_language: "bn",
    is_overdue: false,
    has_result: true,
    obtained_marks: "2.00",
    total_marks: "3.00",
    percentage: "66.67",
    is_passed: true,
    ...overrides,
  };
}

const openAttempt = (overrides: Partial<AdminAttempt> = {}) =>
  attempt({
    attempt_id: OPEN,
    user_id: 41,
    user_full_name: "মাহমুদা আক্তার",
    exam_id: 8,
    exam_title_en: "Chemistry quiz",
    exam_title_bn: "রসায়ন কুইজ",
    status: "in_progress",
    started_at: "2026-10-01T09:00:00Z",
    deadline_at: "2026-10-01T09:30:00Z",
    submitted_at: null,
    submit_source: null,
    has_result: false,
    obtained_marks: null,
    total_marks: null,
    percentage: null,
    is_passed: null,
    ...overrides,
  });

function detail(overrides: Partial<AdminAttemptDetail> = {}, base: AdminAttempt = attempt()): AdminAttemptDetail {
  return {
    ...base,
    created_at: base.started_at,
    server_time: "2026-10-01T09:10:00Z",
    remaining_seconds: base.status === "in_progress" ? 1234 : 0,
    can_submit_until: "2026-10-01T09:30:30Z",
    time_used_seconds: base.has_result ? 720 : null,
    merit_position: base.has_result ? 2 : null,
    is_merit_counted: base.has_result ? true : null,
    ...overrides,
  };
}

const rows = [openAttempt(), attempt()];

const state = (query = "") => {
  window.history.replaceState({}, "", `/attempts${query ? `?${query}` : ""}`);
  return parseListParams(new URLSearchParams(query), ATTEMPT_LIST);
};
function view(
  query = "",
  data = page(rows),
  { examCtx = null, student = null, locale = "en" }: { examCtx?: ServerExam | null; student?: ServerStudent | null; locale?: "en" | "bn" } = {},
) {
  return renderPanel(<AttemptsView data={data} state={state(query)} exam={examCtx} student={student} />, locale);
}
const table = () => screen.getByRole("table");
const bodyRows = () => within(table()).getAllByRole("row").slice(1);
const lastQuery = () => new URL(String(router.push.mock.lastCall?.[0]), "http://x").searchParams;

// Answer-related words that must never appear on these screens.
const ANSWER_WORDS = /correct option|selected option|explanation|answer key|option order/i;

beforeEach(() => {
  router.push.mockReset();
  router.replace.mockReset();
});

describe("AttemptsView — list", () => {
  it("shows student, exam, status, times and the stored result summary", () => {
    view();
    const [open, finished] = bodyRows();
    expect(open).toHaveTextContent("মাহমুদা আক্তার");
    expect(open).toHaveTextContent("Attempt 1");
    expect(open).toHaveTextContent("Chemistry quiz");
    expect(open).toHaveTextContent("In progress");
    expect(open).toHaveTextContent("Not submitted");
    expect(open).toHaveTextContent("Deadline: 1 Oct 2026");
    expect(open).toHaveTextContent("No result yet");
    expect(open).not.toHaveTextContent("Overdue");
    expect(finished).toHaveTextContent("Ayesha Siddika");
    expect(finished).toHaveTextContent("Submitted");
    expect(finished).toHaveTextContent("2.00 / 3.00");
    expect(finished).toHaveTextContent("66.67%");
    expect(finished).toHaveTextContent("Passed");
    expect(within(finished).getAllByRole("link", { name: "Open attempt of Ayesha Siddika" })[0]).toHaveAttribute(
      "href",
      `/attempts/${FINISHED}`,
    );
    expect(document.body.textContent).not.toMatch(ANSWER_WORDS);
  });

  it("overdue is the server's flag, shown as text + icon (never computed from times)", () => {
    // Deadline long past but the server says not overdue → no badge; and vice versa.
    const { unmount } = view("", page([openAttempt({ deadline_at: "2000-01-01T00:00:00Z", is_overdue: false })]));
    expect(bodyRows()[0]).not.toHaveTextContent("Overdue");
    unmount();
    view("", page([openAttempt({ deadline_at: "2999-01-01T00:00:00Z", is_overdue: true })]));
    expect(bodyRows()[0]).toHaveTextContent("Overdue");
  });

  it("sorting, filters and the exam/student shortcuts go to the URL (server-side)", () => {
    view();
    expect(within(table()).getByRole("columnheader", { name: /Started/ })).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(within(table()).getByRole("button", { name: /Submitted/ }));
    expect(lastQuery().get("ordering")).toBe("-submitted_at");
    fireEvent.change(screen.getAllByLabelText("Sort")[0], { target: { value: "deadline_at" } });
    expect(lastQuery().get("ordering")).toBe("deadline_at");
    fireEvent.change(screen.getAllByLabelText("Status")[0], { target: { value: "in_progress" } });
    expect(lastQuery().get("status")).toBe("in_progress");
    fireEvent.change(screen.getAllByLabelText("Submit cutoff")[0], { target: { value: "true" } });
    expect(lastQuery().get("overdue")).toBe("true");
    fireEvent.change(screen.getAllByLabelText("Result")[0], { target: { value: "false" } });
    expect(lastQuery().get("has_result")).toBe("false");
    fireEvent.click(within(table()).getByRole("button", { name: "Show attempts of Model test" }));
    expect(lastQuery().get("exam")).toBe("7");
    fireEvent.click(within(bodyRows()[1]).getByRole("button", { name: "All attempts of Ayesha Siddika" }));
    expect(lastQuery().get("user")).toBe("40");
  });

  it("no free-text search box", () => {
    view();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("chips name the exam and student from the server's reads, fall back to ids, and clear", () => {
    const { unmount } = view("exam=7&user=40", page(rows), {
      examCtx: { id: 7, exam: exam({ id: 7, title_en: "Model test" }) },
      student: { id: 40, user: { id: 40, full_name: "Ayesha Siddika" } },
    });
    const filters = screen.getByRole("group", { name: "Filters" });
    expect(filters).toHaveTextContent("Exam: Model test");
    expect(filters).toHaveTextContent("Student: Ayesha Siddika");
    expect(screen.queryByRole("columnheader", { name: /Exam/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all students" }));
    expect(lastQuery().get("user")).toBeNull();
    expect(lastQuery().get("exam")).toBe("7");
    unmount();
    view("user=40", page(rows), { student: { id: 40, user: null } });
    expect(screen.getByRole("group", { name: "Filters" })).toHaveTextContent("Student: Student #40");
  });

  it("student picker: bounded server search of students; choosing sets the user filter", async () => {
    let releaseOld: ((response: Response) => void) | null = null;
    const { calls } = mockApi(({ url }) => {
      const search = new URL(url, "http://x").searchParams.get("search");
      if (!search) return new Promise<Response>((resolve) => (releaseOld = resolve));
      return json(200, page([{ id: 55, full_name: "Tanvir Ahmed", mobile_display: "+88017*****102" }]));
    });
    view();
    fireEvent.click(screen.getByRole("button", { name: "Choose student" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose a student" });
    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "tanvir" } });
    fireEvent.keyDown(within(dialog).getByRole("searchbox"), { key: "Enter" });
    await within(dialog).findByText("Tanvir Ahmed");
    await act(async () => releaseOld!(json(200, page([{ id: 56, full_name: "Old answer", mobile_display: "x" }]))));
    expect(within(dialog).queryByText("Old answer")).not.toBeInTheDocument();
    for (const call of calls) {
      const query = new URL(call.url, "http://x").searchParams;
      expect(call.url).toContain("/admin/users/");
      expect(query.get("page_size")).toBe("10");
      expect(query.get("role")).toBe("student");
    }
    fireEvent.click(within(dialog).getByRole("button", { name: "Show results of Tanvir Ahmed" }));
    expect(lastQuery().get("user")).toBe("55");
  });

  it("exam picker: bounded server search; choosing sets the exam filter", async () => {
    const { calls } = mockApi(() => json(200, page([exam({ id: 12, title_en: "Biology final" })])));
    view();
    fireEvent.click(screen.getByRole("button", { name: "Choose exam" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose an exam" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Show results of Biology final" }));
    expect(lastQuery().get("exam")).toBe("12");
    expect(calls.every((call) => call.url.includes("page_size=10"))).toBe(true);
  });

  it("empty and no-match states", () => {
    const { unmount } = view("", page([]));
    expect(screen.getByText("No attempts yet")).toBeInTheDocument();
    unmount();
    view("status=in_progress", page([]));
    expect(screen.getByText("No attempts match these filters")).toBeInTheDocument();
  });

  it("Bangla", () => {
    view("", page(rows), { locale: "bn" });
    expect(screen.getByRole("heading", { level: 1, name: "প্রচেষ্টা" })).toBeInTheDocument();
    expect(bodyRows()[0]).toHaveTextContent("চলমান");
    expect(bodyRows()[0]).toHaveTextContent("রসায়ন কুইজ");
    expect(bodyRows()[0]).toHaveTextContent("এখনও ফলাফল নেই");
    expect(bodyRows()[1]).toHaveTextContent("পাস");
  });
});

describe("AttemptDetail", () => {
  const region = (name: string) => screen.getByRole("region", { name });
  // The <dd> after the <dt> with this label (a section heading may share the text).
  const value = (scope: HTMLElement, label: string) =>
    within(scope)
      .getAllByText(label)
      .find((element) => element.tagName === "DT")!.nextElementSibling;

  it("open attempt: server timing, no result link, no countdown, no answers", () => {
    vi.useFakeTimers();
    renderPanel(<AttemptDetail attempt={detail({}, openAttempt())} />);
    expect(screen.getByRole("heading", { level: 1, name: "মাহমুদা আক্তার" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "মাহমুদা আক্তার" })).toHaveAttribute("href", "/users/41");
    expect(screen.getByRole("link", { name: "Chemistry quiz" })).toHaveAttribute("href", "/exams/8");
    const timeline = region("Timeline");
    expect(value(timeline, "Started")).toHaveTextContent("1 Oct 2026");
    expect(value(timeline, "Submit cutoff (deadline + grace)")).toHaveTextContent("1 Oct 2026");
    expect(value(timeline, "Submitted")).toHaveTextContent("Not submitted");
    expect(value(timeline, "Server time")).toHaveTextContent("1 Oct 2026");
    expect(value(timeline, "Time left at server time")).toHaveTextContent("20 min 34 s");
    act(() => vi.advanceTimersByTime(5000)); // no client countdown
    expect(value(timeline, "Time left at server time")).toHaveTextContent("20 min 34 s");
    vi.useRealTimers();
    const result = region("Result");
    expect(result).toHaveTextContent("Result not available yet");
    expect(within(result).queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/This attempt is still open/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument(); // read-only
    expect(document.body.textContent).not.toMatch(ANSWER_WORDS);
    expect(screen.getByRole("link", { name: "All attempts of this student" })).toHaveAttribute("href", "/attempts?user=41");
    expect(screen.getByRole("link", { name: "All attempts of this exam" })).toHaveAttribute("href", "/attempts?exam=8");
  });

  it("overdue (server flag): a pending-finalization notice, not an error", () => {
    renderPanel(<AttemptDetail attempt={detail({ remaining_seconds: 0 }, openAttempt({ is_overdue: true }))} />);
    expect(screen.getByText("Past the submit cutoff")).toBeInTheDocument();
    expect(screen.getByText(/Server finalization is pending/)).toBeInTheDocument();
    expect(screen.getAllByText("Overdue").length).toBeGreaterThan(0);
    expect(value(region("Timeline"), "Time left at server time")).toHaveTextContent("No time left");
  });

  it("finished attempt: stored result summary and Open result", () => {
    renderPanel(<AttemptDetail attempt={detail()} />);
    const timeline = region("Timeline");
    expect(value(timeline, "Submitted by")).toHaveTextContent("By the student");
    expect(value(timeline, "Time left at server time")).toHaveTextContent("Finished");
    const result = region("Result");
    expect(value(result, "Marks obtained")).toHaveTextContent("2.00 / 3.00");
    expect(value(result, "Percentage")).toHaveTextContent("66.67%");
    expect(value(result, "Result")).toHaveTextContent("Passed");
    expect(value(result, "Time used")).toHaveTextContent("12 min 0 s");
    expect(value(result, "Merit position")).toHaveTextContent("Position 2");
    expect(within(result).getByRole("link", { name: "Open result" })).toHaveAttribute("href", `/results/${FINISHED}`);
    expect(value(region("Attempt"), "Exam room language")).toHaveTextContent("Bangla");
  });

  it("Bangla", () => {
    renderPanel(<AttemptDetail attempt={detail({}, openAttempt({ is_overdue: true }))} />, "bn");
    expect(screen.getByRole("region", { name: "সময়রেখা" })).toBeInTheDocument();
    expect(screen.getByText("জমার শেষ সীমা পেরিয়ে গেছে")).toBeInTheDocument();
    expect(screen.getByText("এখনও ফলাফল তৈরি হয়নি")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "প্রচেষ্টার তালিকায় ফিরে যান" })).toHaveAttribute("href", "/attempts");
  });
});
