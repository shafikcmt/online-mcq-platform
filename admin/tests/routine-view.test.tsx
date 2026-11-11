import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RoutineView } from "@/components/exams/routine-view";
import type { RoutineExam, RoutinePdfInfo } from "@/types/routine";

import { apiError, json, mockApi, renderPanel } from "./content-helpers";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/routine",
  useSearchParams: () => new URLSearchParams(),
}));

const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

const exam = (over: Partial<RoutineExam> = {}): RoutineExam => ({
  slug: "physics-1",
  title: "Physics model test",
  category: { slug: "hsc", name: "HSC" },
  subject: { slug: "physics", name: "Physics" },
  start_at: hours(5),
  end_at: hours(7),
  duration_minutes: 30,
  total_questions: 25,
  total_marks: "25.00",
  exam_type: "regular",
  access_type: "free",
  ...over,
});

const NO_PDF: RoutinePdfInfo = { available: false, name: "", size_bytes: 0, updated_at: null };
const HAS_PDF: RoutinePdfInfo = { available: true, name: "routine.pdf", size_bytes: 2048, updated_at: "2026-11-10T08:00:00Z" };

const view = (exams = [exam()], pdf = NO_PDF, locale: "en" | "bn" = "en") => renderPanel(<RoutineView exams={exams} initialPdf={pdf} />, locale);
const pdfFile = (name = "routine.pdf", size = 1000) => {
  const file = new File(["%PDF-1.4\n%%EOF"], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: size });
  return file;
};
const choose = (file: File) => fireEvent.change(screen.getByTestId("routine-file"), { target: { files: [file] } });

describe("exam routine page (admin)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("lists the live schedule with the time, exam, details and whether it is live or upcoming", () => {
    view([exam({ start_at: hours(-1), end_at: hours(2), title: "Live one", slug: "live-one" }), exam()]);
    expect(screen.getAllByText("Live one").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Live now").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Upcoming").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/30 min · 25 questions · 25.00 marks/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Manage exams" })).toHaveAttribute("href", "/exams");
  });

  it("an empty routine says so", () => {
    view([]);
    expect(screen.getByText("No scheduled exams")).toBeInTheDocument();
  });

  it("with no PDF: says so and offers Upload only", () => {
    view();
    expect(screen.getByText("No routine PDF is published.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload PDF" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("with a PDF: shows its name and size, and Open / Replace / Remove", () => {
    view([exam()], HAS_PDF);
    expect(screen.getByText("Published: routine.pdf")).toBeInTheDocument();
    expect(screen.getByText(/2 KB/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/api/v1/public/routine/pdf/");
    expect(screen.getByRole("button", { name: "Replace PDF" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("uploading sends the file as multipart and shows the published PDF", async () => {
    const { calls } = mockApi(() => json(200, HAS_PDF));
    view();
    choose(pdfFile());
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toMatch(/\/admin\/routine\/pdf\/$/);
    expect(((calls[0].body as FormData).get("file") as File).name).toBe("routine.pdf");
    expect(await screen.findByText("Published: routine.pdf")).toBeInTheDocument();
  });

  it("a file that is obviously wrong is refused before anything is sent", () => {
    const { calls } = mockApi(() => json(200, HAS_PDF));
    view();
    choose(pdfFile("notes.txt"));
    expect(screen.getByText("Choose a .pdf file.")).toBeInTheDocument();
    choose(pdfFile("big.pdf", 11 * 1024 * 1024));
    expect(screen.getByText("The file is too large (maximum 10 MB).")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("the server's refusal of a PDF with scripts is explained, and the published PDF stays", async () => {
    mockApi(() => apiError(400, "pdf_active_content", "This PDF contains scripts or actions"));
    view([exam()], HAS_PDF);
    choose(pdfFile());
    expect(await screen.findByText(/contains scripts or actions and cannot be accepted/)).toBeInTheDocument();
    expect(screen.getByText("Published: routine.pdf")).toBeInTheDocument();
  });

  it("removing asks first, then removes and offers Upload again", async () => {
    const { calls } = mockApi(() => json(200, NO_PDF));
    view([exam()], HAS_PDF);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/The schedule above is not affected/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].method).toBe("DELETE");
    expect(await screen.findByText("No routine PDF is published.")).toBeInTheDocument();
  });

  it("is available in Bangla", () => {
    view([exam()], NO_PDF, "bn");
    expect(screen.getByRole("heading", { name: "পরীক্ষার রুটিন" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PDF আপলোড করুন" })).toBeInTheDocument();
  });
});
