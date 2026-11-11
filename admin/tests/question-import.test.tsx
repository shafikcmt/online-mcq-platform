import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuestionImportView } from "@/components/content/question-import-view";
import { csvCell, errorReportCsv } from "@/lib/question-import";
import type { ImportReport } from "@/types/question-import";

import { apiError, json, mockApi, renderPanel, subject } from "./content-helpers";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/questions/import",
  useSearchParams: () => new URLSearchParams(),
}));

const report = (over: Partial<ImportReport> = {}): ImportReport => ({
  total_rows: 3,
  valid_rows: 2,
  invalid_rows: 1,
  columns: ["question", "option_a", "option_b", "correct_answer", "subject"],
  unknown_columns: [],
  errors: [{ row: 4, field: "correct_answer", code: "correct_answer_missing", message: "Mark the correct answer (A, B, C, ...)." }],
  errors_truncated: false,
  preview: [
    { row: 2, subject: "Physics", question: "What is 1+1?", options: 4, correct: "B", chapter: "", topic: "" },
    { row: 3, subject: "Physics", question: "What is 2+2?", options: 4, correct: "A", chapter: "", topic: "" },
  ],
  ...over,
});

const FILE = () => new File(["question,option_a\nQ,a"], "questions.csv", { type: "text/csv" });

function view(locale: "en" | "bn" = "en") {
  return renderPanel(<QuestionImportView subjects={[subject({ id: 7, name_en: "Physics", name_bn: "পদার্থবিজ্ঞান", slug: "physics" })]} />, locale);
}

function choose(file = FILE()) {
  fireEvent.change(screen.getByLabelText("File (.csv or .xlsx)"), { target: { files: [file] } });
}

const form = (call: { body: unknown }) => call.body as FormData;

describe("question import page", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/questions/import");
  });
  afterEach(() => vi.restoreAllMocks());

  it("explains the format and offers both templates", () => {
    view();
    expect(screen.getByRole("heading", { name: "Import questions" })).toBeInTheDocument();
    expect(screen.getByText(/The first row holds the column names/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download CSV template" })).toHaveAttribute("href", "/api/v1/admin/questions/import/template/?file_format=csv");
    expect(screen.getByRole("link", { name: "Download Excel template" })).toHaveAttribute("href", "/api/v1/admin/questions/import/template/?file_format=xlsx");
    expect(screen.getByRole("link", { name: "All questions" })).toHaveAttribute("href", "/questions");
  });

  it("checking without a file asks for one and sends nothing", async () => {
    const { calls } = mockApi(() => json(200, report()));
    view();
    fireEvent.click(screen.getByRole("button", { name: "Check file" }));
    expect(await screen.findByText("Choose a file first.")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("checks the file (preview mode, chosen subject) and shows counts, problems and the first rows", async () => {
    const { calls } = mockApi(() => json(200, report()));
    view();
    choose();
    fireEvent.change(screen.getByLabelText(/Default subject/), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Check file" }));
    expect(await screen.findByText("Ready to import")).toBeInTheDocument();
    const sent = form(calls[0]);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toMatch(/\/admin\/questions\/import\/$/);
    expect(sent.get("mode")).toBe("preview");
    expect(sent.get("subject")).toBe("7");
    expect(sent.get("on_error")).toBe("skip");
    expect((sent.get("file") as File).name).toBe("questions.csv");
    const problems = screen.getAllByRole("table")[0];
    expect(within(problems).getAllByText("The correct answer is missing.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Mark the correct answer (A, B, C, ...).").length).toBeGreaterThan(0);
    expect(screen.getAllByText("What is 1+1?").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Import 2 questions" })).toBeEnabled();
  });

  it("nothing correct: the import button is disabled and says why", async () => {
    mockApi(() => json(200, report({ valid_rows: 0, invalid_rows: 3, preview: [] })));
    view();
    choose();
    fireEvent.click(screen.getByRole("button", { name: "Check file" }));
    expect(await screen.findByText("No correct rows to import.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import 0 questions" })).toBeDisabled();
  });

  it("unknown columns are named, not silently ignored", async () => {
    mockApi(() => json(200, report({ unknown_columns: ["colour"] })));
    view();
    choose();
    fireEvent.click(screen.getByRole("button", { name: "Check file" }));
    expect(await screen.findByText("These columns are not used: colour.")).toBeInTheDocument();
  });

  it("imports after a confirmation, then shows what was added and skipped", async () => {
    const { calls } = mockApi((call) =>
      form(call).get("mode") === "import" ? json(200, report({ created: 2, skipped: 1, aborted: false })) : json(200, report()),
    );
    view();
    choose();
    fireEvent.click(screen.getByRole("button", { name: "Check file" }));
    fireEvent.click(await screen.findByRole("button", { name: "Import 2 questions" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/1 wrong rows are left out/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Import 2 questions" }));
    });
    expect(await screen.findByText("Import finished")).toBeInTheDocument();
    expect(screen.getByText("2 questions added, 1 rows skipped.")).toBeInTheDocument();
    expect(form(calls[1]).get("mode")).toBe("import");
    expect(screen.getByRole("link", { name: "View questions" })).toHaveAttribute("href", "/questions");
  });

  it("'import nothing unless every row is correct' is sent as on_error=abort and an aborted run says so", async () => {
    const { calls } = mockApi((call) =>
      form(call).get("mode") === "import" ? json(200, report({ created: 0, skipped: 1, aborted: true })) : json(200, report()),
    );
    view();
    choose();
    fireEvent.change(screen.getByLabelText("If some rows are wrong"), { target: { value: "abort" } });
    fireEvent.click(screen.getByRole("button", { name: "Check file" }));
    fireEvent.click(await screen.findByRole("button", { name: "Import 2 questions" }));
    const dialog = await screen.findByRole("alertdialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Import 2 questions" }));
    });
    expect(await screen.findByText("Nothing was imported")).toBeInTheDocument();
    expect(form(calls[1]).get("on_error")).toBe("abort");
  });

  it("a file the server refuses is explained in the panel's own words", async () => {
    mockApi(() => apiError(400, "csv_encoding", "Save the CSV as UTF-8"));
    view();
    choose();
    fireEvent.click(screen.getByRole("button", { name: "Check file" }));
    expect(await screen.findByText("Save the CSV as UTF-8 (in Excel: “CSV UTF-8”).")).toBeInTheDocument();
  });

  it("an unknown server code falls back to the server's message", async () => {
    mockApi(() => apiError(429, "throttled", "Too many requests. Try again later."));
    view();
    choose();
    fireEvent.click(screen.getByRole("button", { name: "Check file" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Too many|try again|later/i));
  });

  it("downloads the error report as a CSV with every problem", async () => {
    mockApi(() => json(200, report()));
    let blob: Blob | undefined;
    Object.assign(URL, {
      createObjectURL: vi.fn((value: Blob) => {
        blob = value;
        return "blob:test";
      }),
      revokeObjectURL: vi.fn(),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    view();
    choose();
    fireEvent.click(screen.getByRole("button", { name: "Check file" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Download error report (CSV)" }))[0]);
    expect(click).toHaveBeenCalled();
    // Read the raw bytes: text() would strip the UTF-8 BOM that makes Excel show Bangla.
    const bytes = await new Promise<Uint8Array>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.readAsArrayBuffer(blob as Blob);
    });
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toContain('"4","correct_answer","correct_answer_missing"');
  });

  it("is available in Bangla", () => {
    view("bn");
    expect(screen.getByRole("heading", { name: "প্রশ্ন ইমপোর্ট" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ফাইল যাচাই করুন" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "পদার্থবিজ্ঞান" })).toBeInTheDocument();
  });
});

describe("error report text", () => {
  it("keeps spreadsheet formulas from running: a leading apostrophe on = + - @", () => {
    for (const bad of ["=1+1", "+1", "-1", "@SUM(A1)", "\t=1"]) {
      expect(csvCell(bad), bad).toBe(`"'${bad}"`);
    }
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1 line2"');
    expect(csvCell(null)).toBe('""');
  });

  it("has a header, a BOM for Excel and one line per problem", () => {
    const csv = errorReportCsv([{ row: 5, field: "question", code: "question_required", message: "=cmd" }], { row: "Row", field: "Field", problem: "Problem" });
    expect(csv.startsWith('\ufeff"Row","Field","code","Problem"')).toBe(true);
    expect(csv).toContain(`"5","question","question_required","'=cmd"`);
  });
});
