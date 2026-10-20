import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/questions/100" }));

import { QuestionForm } from "@/components/content/question-form";

import { apiError, category, findToast, json, mockApi, page, question, renderPanel, subject } from "./content-helpers";

const categories = [category(), category({ id: 2, name_en: "SSC", name_bn: "এসএসসি" })];
const subjects = [subject()];

beforeEach(() => {
  router.push.mockReset();
  router.refresh.mockReset();
});

function optionItems() {
  return within(screen.getByRole("region", { name: "Options" })).getAllByRole("listitem");
}

function optionBox(index: number, label: "Bangla" | "English") {
  return within(optionItems()[index]).getByLabelText(label);
}

describe("QuestionForm — edit", () => {
  it("loads all options in order with exactly one correct (radio group)", () => {
    renderPanel(<QuestionForm question={question()} categories={categories} initialSubjects={subjects} />);
    expect(screen.getByRole("heading", { level: 1, name: "Edit question #100" })).toBeInTheDocument();
    expect(optionItems()).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "Option 2 is the correct answer" })).toBeChecked();
    expect(within(optionItems()[1]).getByText("Correct answer")).toBeInTheDocument(); // not colour alone
    fireEvent.click(screen.getByRole("radio", { name: "Option 3 is the correct answer" }));
    expect(screen.getAllByRole("radio").filter((radio) => (radio as HTMLInputElement).checked)).toHaveLength(1);
    expect(screen.getByLabelText(/^Subject/)).toHaveValue("10");
  });

  it("PATCHes the COMPLETE option set after add, edit, reorder and remove", async () => {
    const { calls } = mockApi(() => json(200, question({ updated_at: "2026-10-02T00:00:00Z" })));
    renderPanel(<QuestionForm question={question()} categories={categories} initialSubjects={subjects} />);
    fireEvent.change(optionBox(0, "English"), { target: { value: "A changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove option 3" }));
    expect(screen.getByRole("button", { name: "Add option" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Add option" }));
    fireEvent.change(optionBox(2, "Bangla"), { target: { value: "ঘ" } });
    fireEvent.change(optionBox(2, "English"), { target: { value: "D" } });
    fireEvent.click(screen.getByRole("button", { name: "Move option 3 up" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ method: "PATCH", url: "/api/v1/admin/questions/100/" });
    expect((calls[0].body as { options: unknown }).options).toEqual([
      { text_bn: "ক", text_en: "A changed", is_correct: false, sort_order: 0 },
      { text_bn: "ঘ", text_en: "D", is_correct: false, sort_order: 1 },
      { text_bn: "খ", text_en: "B", is_correct: true, sort_order: 2 },
    ]);
    expect(await findToast()).toHaveTextContent("Question saved.");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("blocks saving without a correct option (no request)", async () => {
    const { calls } = mockApi(() => json(200, question()));
    renderPanel(<QuestionForm question={null} categories={categories} initialSubjects={subjects} initialCategory={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Mark exactly one option as correct.")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("explains 409 question_locked, keeps the input, and offers no unlock", async () => {
    mockApi(() =>
      apiError(409, "question_locked", "This question is used in a published exam, so its content can no longer change."),
    );
    renderPanel(<QuestionForm question={question()} categories={categories} initialSubjects={subjects} />);
    fireEvent.change(optionBox(0, "English"), { target: { value: "Edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const alert = await screen.findByText("This question is used by a published exam and cannot be edited.");
    expect(alert.closest("[role=alert]")).toBeInTheDocument();
    expect(optionBox(0, "English")).toHaveValue("Edited");
    expect(screen.queryByRole("button", { name: /unlock|duplicate/i })).not.toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("puts server validation errors on the right option and field", async () => {
    mockApi(() =>
      apiError(400, "validation_error", "Please correct the highlighted fields.", {
        options: [{}, { text_en: ["Ensure this field has no more than 1000 characters."] }, {}],
        text_bn: ["Too long."],
      }),
    );
    renderPanel(<QuestionForm question={question()} categories={categories} initialSubjects={subjects} />);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(optionBox(1, "English")).toHaveAttribute("aria-invalid", "true"));
    expect(optionBox(1, "English")).toHaveAccessibleDescription(expect.stringContaining("no more than 1000 characters"));
    expect(optionBox(0, "English")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText("Bangla", { selector: "#q-text_bn" })).toHaveAccessibleDescription(expect.stringContaining("Too long."));
    expect(screen.getByText("Please correct the highlighted fields.")).toBeInTheDocument();
  });

  it("shows option-set rules from the server (configured option count) on the options section", async () => {
    mockApi(() => apiError(400, "validation_error", "x", { options: ["Add between 2 and 10 options."] }));
    renderPanel(<QuestionForm question={question()} categories={categories} initialSubjects={subjects} />);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Add between 2 and 10 options.")).toBeInTheDocument();
  });
});

describe("QuestionForm — create", () => {
  it("loads subjects when a category is chosen (once per category) and POSTs, then opens the edit page", async () => {
    const { calls } = mockApi(({ method, url }) => {
      if (method === "GET" && url.includes("/admin/subjects/")) return json(200, page([subject({ id: 20, category: 2, name_en: "Math" })]));
      return json(201, question({ id: 321 }));
    });
    renderPanel(<QuestionForm question={null} categories={categories} initialSubjects={[]} />);
    expect(screen.getByLabelText(/^Subject/)).toBeDisabled();
    expect(screen.getByText("Save the question first, then add an image.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Category/), { target: { value: "2" } });
    await screen.findByRole("option", { name: "Math" });
    fireEvent.change(screen.getByLabelText(/^Category/), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(/^Category/), { target: { value: "2" } });
    expect(calls.filter((call) => call.url.includes("/admin/subjects/"))).toHaveLength(1); // cached
    expect(calls[0].url).toBe("/api/v1/admin/subjects/?category=2&page_size=100&ordering=sort_order");

    fireEvent.change(screen.getByLabelText(/^Subject/), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("English", { selector: "#q-text_en" }), { target: { value: "2 + 2 = ?" } });
    fireEvent.change(optionBox(0, "English"), { target: { value: "4" } });
    fireEvent.change(optionBox(1, "English"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("radio", { name: "Option 1 is the correct answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/questions/321"));
    const post = calls.find((call) => call.method === "POST")!;
    expect(post.url).toBe("/api/v1/admin/questions/");
    expect(post.body).toMatchObject({ subject: 20, text_en: "2 + 2 = ?", difficulty: "", is_active: true });
    expect((post.body as { options: { is_correct: boolean }[] }).options.map((option) => option.is_correct)).toEqual([true, false, false, false]);
  });

  it("works in Bangla", () => {
    renderPanel(<QuestionForm question={null} categories={categories} initialSubjects={[]} />, "bn");
    expect(screen.getByRole("heading", { level: 1, name: "নতুন প্রশ্ন" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "অপশন যোগ করুন" })).toBeInTheDocument();
  });
});
