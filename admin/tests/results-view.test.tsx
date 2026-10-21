import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/results",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { ResultsView, type ServerExam } from "@/components/results/results-view";
import { RESULT_LIST } from "@/lib/content-specs";
import { parseListParams } from "@/lib/list-params";
import type { AdminResult } from "@/types/results";

import { adminResult, apiError, exam, findToast, json, mockApi, page, renderPanel } from "./content-helpers";

const state = (query = "") => {
  window.history.replaceState({}, "", `/results${query ? `?${query}` : ""}`);
  return parseListParams(new URLSearchParams(query), RESULT_LIST);
};

const rows: AdminResult[] = [
  adminResult(),
  adminResult({
    attempt_id: "6f1c2b9e-1d2a-4c3b-8e4f-5a6b7c8d9e02",
    user_id: 41,
    user_full_name: "মাহমুদা আক্তার",
    exam_id: 8,
    exam_title_en: "Chemistry quiz",
    exam_title_bn: "রসায়ন কুইজ",
    is_passed: false,
    percentage: "33.33",
    obtained_marks: "1.00",
    merit_position: null,
    is_merit_counted: false,
    time_used_seconds: 42,
  }),
  adminResult({ attempt_id: "6f1c2b9e-1d2a-4c3b-8e4f-5a6b7c8d9e03", user_id: 42, user_full_name: "No Pass Mark", is_passed: null }),
];

function view(query = "", serverExam: ServerExam | null = null, data = page(rows), locale: "en" | "bn" = "en") {
  return renderPanel(<ResultsView data={data} state={state(query)} exam={serverExam} />, locale);
}
const table = () => screen.getByRole("table");
const bodyRows = () => within(table()).getAllByRole("row").slice(1);

beforeEach(() => {
  router.push.mockReset();
  router.replace.mockReset();
});

describe("ResultsView — list", () => {
  it("shows exam titles, marks, percentage, pass/fail (text + icon) and stored merit", () => {
    view();
    const [first, second, third] = bodyRows();
    expect(first).toHaveTextContent("Ayesha Siddika");
    expect(first).toHaveTextContent("Attempt 1");
    expect(first).toHaveTextContent("Model test");
    expect(first).toHaveTextContent("2.00 / 3.00");
    expect(first).toHaveTextContent("66.67%");
    expect(first).toHaveTextContent("Passed");
    expect(first).toHaveTextContent("12 min 34 s");
    expect(first).toHaveTextContent("Position 2");
    expect(first).toHaveTextContent("Counts for merit");
    expect(second).toHaveTextContent("Chemistry quiz");
    expect(second).toHaveTextContent("Failed");
    expect(second).toHaveTextContent("Not ranked");
    expect(second).toHaveTextContent("Not counted");
    expect(second).toHaveTextContent("42 s");
    expect(third).toHaveTextContent("No pass mark");
    expect(within(first).getAllByRole("link", { name: "Open result of Ayesha Siddika" })[0]).toHaveAttribute(
      "href",
      "/results/6f1c2b9e-1d2a-4c3b-8e4f-5a6b7c8d9e01",
    );
  });

  it("sorting by headers and the sort menu goes to the URL (server-side)", () => {
    view();
    expect(within(table()).getByRole("columnheader", { name: /Submitted/ })).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(within(table()).getByRole("button", { name: /Percentage/ }));
    expect(router.push).toHaveBeenLastCalledWith("/results?ordering=-percentage", { scroll: false });
    fireEvent.change(document.getElementById("filter-ordering")!, { target: { value: "merit_position" } });
    expect(router.push).toHaveBeenLastCalledWith("/results?ordering=merit_position", { scroll: false });
  });

  it("pass/fail and merit filters, search and pagination go to the URL", async () => {
    view("", null, page(rows, 45));
    fireEvent.change(document.getElementById("filter-outcome")!, { target: { value: "false" } });
    expect(router.push).toHaveBeenLastCalledWith("/results?is_passed=false", { scroll: false });
    fireEvent.change(document.getElementById("filter-merit")!, { target: { value: "true" } });
    expect(router.push).toHaveBeenLastCalledWith("/results?is_passed=false&merit_counted=true", { scroll: false });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), { target: { value: "ayesha" } });
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search" }), { key: "Enter" });
    expect(router.replace).toHaveBeenLastCalledWith("/results?is_passed=false&merit_counted=true&search=ayesha", { scroll: false });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(router.push).toHaveBeenLastCalledWith(expect.stringContaining("page=2"), { scroll: false });
  });

  it("Merit view = counted for merit, ordered by merit position (no client ranking)", () => {
    view();
    expect(screen.getByRole("button", { name: "Merit view" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Merit view" }));
    expect(router.push).toHaveBeenLastCalledWith("/results?merit_counted=true&ordering=merit_position", { scroll: false });
  });

  it("row shortcuts filter by that exam or that student", () => {
    view();
    fireEvent.click(within(bodyRows()[1]).getByRole("button", { name: "All results of Chemistry quiz" }));
    expect(router.push).toHaveBeenLastCalledWith("/results?exam=8", { scroll: false });
    fireEvent.click(within(bodyRows()[0]).getAllByRole("button", { name: "All results of Ayesha Siddika" })[0]);
    expect(router.push).toHaveBeenLastCalledWith("/results?exam=8&user=40", { scroll: false });
  });

  it("student chip names the student from the rows (or the id) and clears", () => {
    view("user=40");
    const filters = screen.getByRole("group", { name: "Filters" });
    expect(filters).toHaveTextContent("Student: Ayesha Siddika");
    fireEvent.click(screen.getByRole("button", { name: "Show all students" }));
    expect(router.push).toHaveBeenLastCalledWith("/results", { scroll: false });
  });

  it("empty and no-match states", () => {
    const { unmount } = view("", null, page([]));
    expect(screen.getByText("No results yet")).toBeInTheDocument();
    unmount();
    view("is_passed=true", null, page([]));
    expect(screen.getByText("No results match these filters")).toBeInTheDocument();
  });

  it("server data for another query is never shown as this query's rows", async () => {
    mockApi(() => new Promise<Response>(() => undefined)); // the repair read stays pending
    const serverState = parseListParams(new URLSearchParams(""), RESULT_LIST);
    window.history.replaceState({}, "", "/results?is_passed=false");
    renderPanel(<ResultsView data={page(rows)} state={serverState} exam={null} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Updating the list…" })).toBeInTheDocument();
  });
});

describe("ResultsView — exam context", () => {
  it("visibility is the server's results_visible, never derived from the setting", () => {
    // "Immediately" + results_visible=false: the panel must show the server's answer.
    view("exam=7", { id: 7, exam: exam({ status: "published", result_visibility: "immediate", results_visible: false }) });
    const section = screen.getByRole("region", { name: "Exam results: Model test" });
    expect(section).toHaveTextContent("Immediately after submission");
    expect(section).toHaveTextContent("Students can't see the results now");
    expect(section).toHaveTextContent("These actions apply to all results for this exam.");
    expect(within(section).getByRole("link", { name: "Open exam" })).toHaveAttribute("href", "/exams/7");
  });

  it("waits (aria-busy) while the server exam is for another URL exam; unknown exam → notice", () => {
    const { unmount } = view("exam=9", { id: 7, exam: exam() });
    expect(screen.queryByRole("region", { name: /Exam results/ })).not.toBeInTheDocument();
    expect(screen.getByText("Loading the exam…").closest("[aria-busy]")).toHaveAttribute("aria-busy", "true");
    unmount();
    view("exam=9", { id: 9, exam: null });
    expect(screen.getByText("Exam #9 was not found. Its results can't be shown.")).toBeInTheDocument();
  });

  it("publish then hide: the exam comes back from the server with its new visibility", async () => {
    const { calls } = mockApi(({ url }) =>
      json(200, exam({ status: "published", result_visibility: "manual", ...(url.endsWith("/publish/")
        ? { result_published_at: "2026-10-02T08:00:00Z", results_visible: true }
        : { result_published_at: null, results_visible: false }) })),
    );
    view("exam=7", { id: 7, exam: exam({ status: "published", result_visibility: "manual", results_visible: false }) });
    const section = screen.getByRole("region", { name: /Exam results/ });
    fireEvent.click(within(section).getByRole("button", { name: "Publish results" }));
    await waitFor(() => expect(section).toHaveTextContent("Students can see the results now"));
    fireEvent.click(within(section).getByRole("button", { name: "Hide results" }));
    await waitFor(() => expect(section).toHaveTextContent("Students can't see the results now"));
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST /api/v1/admin/exams/7/results/publish/",
      "POST /api/v1/admin/exams/7/results/hide/",
    ]);
  });

  it("generate merit: shows the server's ranked count and re-reads exactly this list", async () => {
    const { calls } = mockApi(({ method }) =>
      method === "POST" ? json(200, { ranked_count: 3 }) : json(200, page([adminResult({ merit_position: 1 })])),
    );
    view("exam=7&ordering=merit_position", { id: 7, exam: exam({ status: "published" }) });
    fireEvent.click(screen.getByRole("button", { name: "Generate merit list" }));
    expect(await findToast()).toHaveTextContent("Merit list generated: 3 ranked.");
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0].url).toBe("/api/v1/admin/exams/7/merit/generate/");
    expect(calls[1]).toMatchObject({
      method: "GET",
      url: "/api/v1/admin/results/?page=1&page_size=20&ordering=merit_position&exam=7",
    });
    await waitFor(() => expect(bodyRows()[0]).toHaveTextContent("Position 1"));
  });

  it("merit conflict (merit_disabled) is explained, nothing re-read", async () => {
    const { calls } = mockApi(() => apiError(409, "merit_disabled", "The merit list is turned off for this exam."));
    view("exam=7", { id: 7, exam: exam({ status: "published" }) });
    fireEvent.click(screen.getByRole("button", { name: "Generate merit list" }));
    expect(await screen.findByText("The merit list is turned off")).toBeInTheDocument();
    expect(calls).toHaveLength(1);
  });

  it("exam picker: server search, latest response wins, choosing sets the exam filter", async () => {
    let releaseOld: ((response: Response) => void) | null = null;
    const { calls } = mockApi(({ url }) => {
      const search = new URL(url, "http://x").searchParams.get("search");
      if (!search) return new Promise<Response>((resolve) => (releaseOld = resolve));
      return json(200, page([exam({ id: 12, title_en: "Biology final" })]));
    });
    view();
    fireEvent.click(screen.getByRole("button", { name: "Choose exam" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose an exam" });
    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "bio" } });
    fireEvent.keyDown(within(dialog).getByRole("searchbox"), { key: "Enter" });
    await within(dialog).findByText("Biology final");
    expect(releaseOld).not.toBeNull();
    await act(async () => releaseOld!(json(200, page([exam({ id: 13, title_en: "Old answer" })]))));
    expect(within(dialog).queryByText("Old answer")).not.toBeInTheDocument();
    expect(calls.every((call) => call.url.includes("page_size=10"))).toBe(true); // never the whole catalogue
    fireEvent.click(within(dialog).getByRole("button", { name: "Show results of Biology final" }));
    expect(router.push).toHaveBeenLastCalledWith("/results?exam=12", { scroll: false });
  });
});

describe("ResultsView — Bangla", () => {
  it("labels, statuses and bilingual exam titles in Bangla", () => {
    view("", null, page(rows), "bn");
    expect(screen.getByRole("heading", { level: 1, name: "ফলাফল" })).toBeInTheDocument();
    expect(table()).toHaveAccessibleName("ফলাফল");
    expect(bodyRows()[0]).toHaveTextContent("মডেল টেস্ট");
    expect(bodyRows()[0]).toHaveTextContent("পাস");
    expect(bodyRows()[1]).toHaveTextContent("ফেল");
    expect(bodyRows()[1]).toHaveTextContent("র‍্যাংক নেই");
    expect(screen.getByRole("button", { name: "মেধা তালিকা দেখুন" })).toBeInTheDocument();
  });
});
