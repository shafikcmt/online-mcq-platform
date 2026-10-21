import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/exams/7",
  useSearchParams: () => new URLSearchParams(),
}));

import { ExamEditor } from "@/components/exams/exam-editor";

import { apiError, category, exam, examRow, findToast, json, mockApi, page, question, renderPanel, subject } from "./content-helpers";

const lookups = { categories: [category()], subjects: [subject()], lookupTruncated: false };
const rows = [examRow(1, 0), examRow(2, 1)];

beforeEach(() => {
  router.push.mockReset();
  window.history.replaceState({}, "", "/exams/7");
});

function editor(overrides = {}, questions = rows) {
  return renderPanel(<ExamEditor exam={exam(overrides)} questions={questions} {...lookups} />);
}
const assigned = () => within(screen.getByRole("list", { name: "Assigned questions" })).getAllByRole("listitem");
const ids = () => assigned().map((item) => Number(item.getAttribute("data-question-row")));

describe("ExamEditor — create", () => {
  it("POSTs the settings with a +06:00 schedule and opens the new exam", async () => {
    const { calls } = mockApi(() => json(201, exam({ id: 42 })));
    renderPanel(<ExamEditor exam={null} questions={[]} {...lookups} initialCategory={1} />);
    expect(screen.getByRole("heading", { level: 1, name: "New exam" })).toBeInTheDocument();
    expect(screen.getByText("Create the exam first, then assign its questions.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    fireEvent.change(document.getElementById("exam-title_en")!, { target: { value: "Weekly test" } });
    fireEvent.change(screen.getByLabelText(/^Duration/), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText(/^Number of questions/), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/^Starts at/), { target: { value: "2030-03-01T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create exam" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/exams/42"));
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/v1/admin/exams/" });
    expect(calls[0].body).toMatchObject({
      title_en: "Weekly test",
      category: 1,
      subject: null,
      duration_minutes: 40,
      total_questions: 10,
      start_at: "2030-03-01T10:00:00+06:00",
      end_at: null,
    });
    expect(calls[0].body).not.toHaveProperty("status");
  });

  it("switching a new exam to practice shows (and sends) the practice defaults", async () => {
    const { calls } = mockApi(() => json(201, exam({ id: 43 })));
    renderPanel(<ExamEditor exam={null} questions={[]} {...lookups} initialCategory={1} />);
    fireEvent.change(screen.getByLabelText(/^Exam type/), { target: { value: "practice" } });
    expect(screen.getByLabelText("Allow retakes")).toBeChecked();
    expect(screen.getByRole("switch", { name: "Merit list" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Create exam" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toMatchObject({ exam_type: "practice", allow_retake: true, max_attempts: null, merit_enabled: false });
  });

  it("puts server field errors next to the fields and keeps the input", async () => {
    mockApi(() => apiError(400, "validation_error", "x", { duration_minutes: ["A valid integer is required."], category: ["This field may not be null."] }));
    renderPanel(<ExamEditor exam={null} questions={[]} {...lookups} />);
    fireEvent.change(screen.getByLabelText(/^Duration/), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Create exam" }));
    expect(await screen.findByText("A valid integer is required.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Category/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Please correct the highlighted fields.")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("ExamEditor — settings", () => {
  it("live type: locked controls show the values the server enforces", async () => {
    const { calls } = mockApi(({ body }) => json(200, exam(body as object)));
    editor({ allow_retake: true, max_attempts: null, merit_strategy: "best_attempt" });
    fireEvent.change(screen.getByLabelText(/^Exam type/), { target: { value: "live" } });
    expect(screen.getByLabelText("Allow retakes")).toBeDisabled();
    expect(screen.getByLabelText("Allow retakes")).not.toBeChecked();
    expect(screen.getByText("Students get one attempt.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Attempt that counts/)).toHaveValue("first_attempt");
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ method: "PATCH", url: "/api/v1/admin/exams/7/" });
    expect(calls[0].body).toMatchObject({ exam_type: "live", allow_retake: false, max_attempts: 1, merit_strategy: "first_attempt" });
    expect(await findToast()).toHaveTextContent("Exam settings saved.");
  });

  it("409 exam_locked on save: explained, the exam re-read, input kept and read-only", async () => {
    mockApi(({ method }) =>
      method === "PATCH"
        ? apiError(409, "exam_locked", "Only draft or unpublished exams can be edited.")
        : json(200, exam({ status: "published" })),
    );
    editor();
    fireEvent.change(screen.getByLabelText(/^Duration/), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    const alert = await screen.findByText("This exam can't be changed now");
    expect(alert.closest("[role=alert]")).toHaveTextContent("Only draft or unpublished exams can be edited.");
    await waitFor(() => expect(screen.getByLabelText(/^Duration/)).toBeDisabled());
    expect(screen.getByLabelText(/^Duration/)).toHaveValue(45);
    expect(screen.getByText(/Published exams can't be edited/)).toBeInTheDocument();
  });

  it("published/archived exams are read-only with a reason; no question editing", () => {
    editor({ status: "published" });
    expect(screen.getByText(/Published exams can't be edited/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Duration/)).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add questions" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move question #1 up" })).toBeDisabled();
    expect(screen.getByText("The question list can't change while the exam is published or archived.")).toBeInTheDocument();
  });
});

describe("ExamEditor — question list", () => {
  it("shows assigned of planned and saves the COMPLETE list after reorder, marks and remove", async () => {
    const { calls } = mockApi(({ body }) => {
      const sent = (body as { questions: { question: number; sort_order: number; marks: string | null }[] }).questions;
      return json(200, { questions: sent.map((item) => examRow(item.question, item.sort_order, { marks: item.marks, effective_marks: item.marks ?? "1.00" })) });
    });
    editor({}, [examRow(1, 0), examRow(2, 1), examRow(3, 2)]);
    expect(screen.getByText("Assigned 3 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save question list" })).toBeDisabled(); // nothing changed
    fireEvent.click(screen.getByRole("button", { name: "Move question #3 up" }));
    expect(ids()).toEqual([1, 3, 2]);
    fireEvent.change(screen.getByLabelText(/^Marks for question #2/), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove question #1" }));
    expect(ids()).toEqual([3, 2]);
    expect(screen.getByText("Assigned 2 of 3")).toBeInTheDocument();
    expect(screen.getByText("Save your changes first — publishing uses the saved exam.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save question list" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ method: "PATCH", url: "/api/v1/admin/exams/7/questions/" });
    expect(calls[0].body).toEqual({
      questions: [
        { question: 3, sort_order: 0, marks: null },
        { question: 2, sort_order: 1, marks: "2.5" },
      ],
    });
    expect(await findToast()).toHaveTextContent("Question list saved.");
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
    expect(screen.getByText(/2 of 3 questions · 30 min · 3.50 marks/)).toBeInTheDocument();
  });

  it("removing every question sends an explicit empty list", async () => {
    const { calls } = mockApi(() => json(200, { questions: [] }));
    editor({}, [examRow(1, 0)]);
    fireEvent.click(screen.getByRole("button", { name: "Remove question #1" }));
    expect(screen.getByText("No questions assigned yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save question list" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ questions: [] });
  });

  it("per-row save errors land on the right question", async () => {
    mockApi(() => apiError(400, "validation_error", "x", { questions: [{}, { marks: ["Ensure this value is greater than or equal to 0.01."] }] }));
    editor();
    fireEvent.change(screen.getByLabelText(/^Marks for question #2/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save question list" }));
    expect(await screen.findByText("Ensure this value is greater than or equal to 0.01.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Marks for question #2/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/^Marks for question #1/)).not.toHaveAttribute("aria-invalid");
  });

  it("move buttons keep focus on the moved question", async () => {
    editor();
    const down = screen.getByRole("button", { name: "Move question #1 down" });
    down.focus();
    fireEvent.click(down);
    await waitFor(() => expect(screen.getByRole("button", { name: "Move question #1 up" })).toHaveFocus()); // now last: down disabled
    expect(screen.getByText("Question #1 moved to position 2.")).toBeInTheDocument(); // announced
  });
});

describe("ExamEditor — question picker", () => {
  const bankPage = (ids: number[], count = 25) => page(ids.map((id) => question({ id, text_en: `Bank ${id}` })), count);

  it("server-side search/paging; the selection persists across pages and close/reopen; no duplicates", async () => {
    const { calls } = mockApi(({ url }) => {
      const params = new URL(url, "http://x").searchParams;
      return json(200, params.get("page") === "2" ? bankPage([30, 31]) : bankPage([1, 20, 21]));
    });
    editor();
    fireEvent.click(screen.getByRole("button", { name: "Add questions" }));
    const dialog = await screen.findByRole("dialog", { name: "Add questions" });
    await within(dialog).findByText("Bank 20");
    // Filtered on the server from the exam's own placement/language; one page only.
    const first = new URL(calls[0].url, "http://x").searchParams;
    expect(Object.fromEntries(first)).toMatchObject({ page: "1", page_size: "20", category: "1", subject: "10", language: "bn", is_active: "true" });
    // #1 is already assigned: marked, no Add button.
    const row1 = dialog.querySelector('[data-picker-row="1"]') as HTMLElement;
    expect(row1).toHaveTextContent("Added");
    expect(within(row1).queryByRole("button", { name: "Add question #1" })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Add question #20" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Next page" }));
    await within(dialog).findByText("Bank 30");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add question #31" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Previous page" }));
    await within(dialog).findByText("Bank 20");
    expect(dialog.querySelector('[data-picker-row="20"]')).toHaveTextContent("Added");
    expect(within(dialog).getByText("4 assigned")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(ids()).toEqual([1, 2, 20, 31]);
    // Reopen: same query (page 1) and the same selection.
    fireEvent.click(screen.getByRole("button", { name: "Add questions" }));
    const again = await screen.findByRole("dialog", { name: "Add questions" });
    await within(again).findByText("Bank 20");
    expect(again.querySelector('[data-picker-row="20"]')).toHaveTextContent("Added");
    // Remove from inside the picker.
    fireEvent.click(within(again).getByRole("button", { name: "Remove question #20 from the exam" }));
    expect(within(again).getByRole("button", { name: "Add question #20" })).toBeInTheDocument();
    expect(calls.every((call) => call.method === "GET" && !call.url.includes("page_size=1000"))).toBe(true);
  });

  it("a slow, older response never overwrites the newer one", async () => {
    let releaseOld: ((response: Response) => void) | null = null;
    const { calls } = mockApi(({ url }) => {
      const search = new URL(url, "http://x").searchParams.get("search");
      if (!search) return new Promise<Response>((resolve) => (releaseOld = resolve));
      return json(200, bankPage([77], 1));
    });
    editor();
    fireEvent.click(screen.getByRole("button", { name: "Add questions" }));
    const dialog = await screen.findByRole("dialog", { name: "Add questions" });
    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "newer" } });
    fireEvent.keyDown(within(dialog).getByRole("searchbox"), { key: "Enter" });
    await within(dialog).findByText("Bank 77");
    expect(calls).toHaveLength(2);
    expect(releaseOld).not.toBeNull(); // the first (unfiltered) request is still open
    await act(async () => releaseOld!(json(200, bankPage([5, 6]))));
    expect(within(dialog).getByText("Bank 77")).toBeInTheDocument();
    expect(within(dialog).queryByText("Bank 5")).not.toBeInTheDocument();
  });

  it("a failed search shows an error with retry and keeps the selection", async () => {
    let fail = true;
    mockApi(() => (fail ? apiError(500, "server_error", "x") : json(200, bankPage([9], 1))));
    editor();
    fireEvent.click(screen.getByRole("button", { name: "Add questions" }));
    const dialog = await screen.findByRole("dialog", { name: "Add questions" });
    expect(await within(dialog).findByRole("button", { name: "Try again" })).toBeInTheDocument();
    fail = false;
    fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
    await within(dialog).findByText("Bank 9");
    expect(within(dialog).getByText("2 assigned")).toBeInTheDocument();
  });
});

describe("ExamEditor — publish", () => {
  it("validation failure: summary with section links, field errors and marked questions", async () => {
    mockApi(() =>
      apiError(400, "validation_error", "x", {
        start_at: ["Live exams need a start and an end time."],
        questions: ["This exam needs 3 questions but 2 are assigned.", "Question #2 is inactive."],
      }),
    );
    editor();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    const summary = (await screen.findByText("This exam can't be published yet")).closest("[role=alert]") as HTMLElement;
    expect(summary).toHaveTextContent("This exam needs 3 questions but 2 are assigned.");
    expect(summary).toHaveTextContent("Question #2 is inactive.");
    expect(screen.getAllByText("Live exams need a start and an end time.")).toHaveLength(2); // summary + field
    expect(screen.getByLabelText(/^Starts at/)).toHaveAttribute("aria-invalid", "true");
    const row2 = document.querySelector('[data-question-row="2"]') as HTMLElement;
    expect(row2).toHaveTextContent("Needs attention");
    expect(document.querySelector('[data-question-row="1"]')).not.toHaveTextContent("Needs attention");
    Element.prototype.scrollIntoView = vi.fn();
    fireEvent.click(within(summary).getByRole("button", { name: "Go to Schedule" }));
    expect(document.getElementById("exam-section-schedule")).toHaveFocus();
    fireEvent.click(within(summary).getByRole("button", { name: "Go to Questions" }));
    expect(document.getElementById("exam-section-questions")).toHaveFocus();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Model test"); // context kept
  });

  it("success: published, read-only, results controls appear", async () => {
    const { calls } = mockApi(() => json(200, exam({ status: "published", question_count: 3 })));
    editor();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(await findToast()).toHaveTextContent("Exam published.");
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/v1/admin/exams/7/publish/" });
    expect(screen.getByRole("button", { name: "Unpublish" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Duration/)).toBeDisabled();
    expect(screen.getByRole("region", { name: "Results" })).toBeInTheDocument();
  });

  it("409 already_published is translated and the status re-read", async () => {
    mockApi(({ method }) =>
      method === "POST" ? apiError(409, "already_published", "This exam is already published.") : json(200, exam({ status: "published" })),
    );
    editor();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(await screen.findByText("This exam is already published")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Unpublish" })).toBeInTheDocument());
  });
});

describe("ExamEditor — lifecycle actions", () => {
  it("unpublish after confirmation (never optimistic)", async () => {
    let release: (response: Response) => void = () => undefined;
    const { calls } = mockApi(() => new Promise<Response>((resolve) => (release = resolve)));
    editor({ status: "published" });
    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    const dialog = screen.getByRole("alertdialog", { name: "Unpublish this exam?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unpublish" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(within(dialog).getByRole("button", { name: "Working…" })).toBeDisabled();
    expect(screen.getByText(/Published exams can't be edited/)).toBeInTheDocument(); // unchanged until the server answers
    await act(async () => release(json(200, exam({ status: "unpublished" }))));
    expect(await findToast()).toHaveTextContent("Exam unpublished.");
    expect(screen.getByLabelText(/^Duration/)).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument(); // only drafts
  });

  it("archive conflict is shown in the dialog with its translated title", async () => {
    mockApi(({ method }) =>
      method === "POST" ? apiError(409, "not_archivable", "Only draft or unpublished exams can be archived.") : json(200, exam()),
    );
    editor();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    const dialog = screen.getByRole("alertdialog", { name: "Archive this exam?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));
    expect(await within(dialog).findByText("This exam can't be archived")).toBeInTheDocument();
    expect(within(dialog).getByText("Only draft or unpublished exams can be archived.")).toBeInTheDocument();
  });

  it("duplicate opens the new draft", async () => {
    const { calls } = mockApi(() => json(201, exam({ id: 99, slug: "model-test-copy" })));
    editor({ status: "published" });
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Duplicate this exam?" })).getByRole("button", { name: "Duplicate" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/exams/99"));
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/v1/admin/exams/7/duplicate/" });
    expect(await findToast()).toHaveTextContent("Copy created as a draft.");
  });

  it("delete: confirm; 409 exam_has_attempts / in_use explained, nothing removed", async () => {
    mockApi(() => apiError(409, "exam_has_attempts", "Students have taken this exam."));
    editor();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete this exam?" });
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await within(dialog).findByText("Students have already taken this exam")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("delete success goes back to the list", async () => {
    mockApi(() => json(204, undefined));
    editor();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/exams"));
  });

  it("actions on the saved exam wait while anything is unsaved", () => {
    editor();
    fireEvent.change(screen.getByLabelText(/^Duration/), { target: { value: "50" } });
    for (const name of ["Publish", "Archive", "Duplicate"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
      expect(screen.getByRole("button", { name })).toHaveAccessibleDescription("Save your changes first — publishing uses the saved exam.");
    }
  });
});

describe("ExamEditor — unsaved changes", () => {
  it("in-app links ask before discarding; Discard navigates", () => {
    mockApi(() => json(200, {}));
    editor();
    fireEvent.change(screen.getByLabelText(/^Duration/), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("link", { name: "Back to exams" }));
    const dialog = screen.getByRole("alertdialog", { name: "Discard unsaved changes?" });
    expect(within(dialog).getByRole("button", { name: "Keep editing" })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(router.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Discard changes" }));
    expect(router.push).toHaveBeenCalledWith("/exams");
  });

  it("beforeunload is armed only while dirty", () => {
    editor();
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Move question #1 down" }));
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it("no prompt when nothing changed", () => {
    editor();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(router.push).toHaveBeenCalledWith("/exams");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("ExamEditor — results", () => {
  it("publish/hide results and generate merit", async () => {
    const { calls } = mockApi(({ url }) =>
      url.includes("merit") ? json(200, { ranked_count: 12 }) : json(200, exam({ status: "published", result_published_at: "2026-10-01T08:00:00Z" })),
    );
    editor({ status: "published" });
    const results = screen.getByRole("region", { name: "Results" });
    fireEvent.click(within(results).getByRole("button", { name: "Publish results" }));
    expect(await within(results).findByRole("button", { name: "Hide results" })).toBeInTheDocument();
    fireEvent.click(within(results).getByRole("button", { name: "Generate merit list" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls.map((call) => call.url)).toEqual(["/api/v1/admin/exams/7/results/publish/", "/api/v1/admin/exams/7/merit/generate/"]);
    expect(await screen.findByText("Merit list generated: 12 ranked.")).toBeInTheDocument();
  });

  it("merit off: the button is disabled with the reason", () => {
    editor({ status: "published", merit_enabled: false });
    expect(screen.getByRole("button", { name: "Generate merit list" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Generate merit list" })).toHaveAccessibleDescription("The merit list is turned off for this exam.");
  });

  it("shows the server's current visibility and links to the Results screen", () => {
    editor({ status: "published", result_visibility: "after_exam_end", results_visible: false });
    const results = screen.getByRole("region", { name: "Results" });
    expect(results).toHaveTextContent("After the exam ends");
    expect(results).toHaveTextContent("Students can't see the results now");
    expect(results).toHaveTextContent("These actions apply to all results for this exam.");
    expect(within(results).getByRole("link", { name: "View results" })).toHaveAttribute("href", "/results?exam=7");
  });

  it("drafts show no results section", () => {
    editor();
    expect(screen.queryByRole("region", { name: "Results" })).not.toBeInTheDocument();
  });
});

describe("ExamEditor — Bangla", () => {
  it("renders sections, counts and actions in Bangla", () => {
    renderPanel(<ExamEditor exam={exam()} questions={rows} {...lookups} />, "bn");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("মডেল টেস্ট");
    expect(screen.getByText("মৌলিক তথ্য")).toBeInTheDocument();
    expect(screen.getByText("৩টির মধ্যে ২টি যুক্ত".replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "প্রকাশ করুন" })).toBeInTheDocument();
  });
});
