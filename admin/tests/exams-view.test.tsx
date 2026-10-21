import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/exams",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { ExamsView } from "@/components/exams/exams-view";
import { EXAM_LIST } from "@/lib/content-specs";
import { parseListParams } from "@/lib/list-params";

import { apiError, category, exam, findToast, json, mockApi, page, renderPanel, subject } from "./content-helpers";

const state = (query = "") => {
  window.history.replaceState({}, "", `/exams${query ? `?${query}` : ""}`);
  return parseListParams(new URLSearchParams(query), EXAM_LIST);
};
const lookups = { categories: [category()], subjects: [subject()], lookupTruncated: false };

beforeEach(() => {
  router.push.mockReset();
  router.replace.mockReset();
});

describe("ExamsView", () => {
  it("shows status (text + icon), type, schedule in Dhaka time and assigned of planned", () => {
    renderPanel(
      <ExamsView
        data={page([
          exam({ start_at: "2030-01-15T03:30:00Z", end_at: "2030-01-15T06:00:00Z", exam_type: "live" }),
          exam({ id: 8, status: "published", question_count: 3, title_en: "Full" }),
        ])}
        state={state()}
        {...lookups}
      />,
    );
    const rows = within(screen.getByRole("table", { name: "Exams" })).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Draft");
    expect(rows[1]).toHaveTextContent("Live");
    expect(rows[1]).toHaveTextContent("Free · Bangla");
    expect(rows[1]).toHaveTextContent("Starts 15 Jan 2030, 09:30");
    expect(rows[1]).toHaveTextContent("2 of 3");
    expect(rows[1]).toHaveTextContent("HSC");
    expect(rows[2]).toHaveTextContent("Published");
    expect(rows[2]).toHaveTextContent("No schedule");
    // Only drafts can be deleted.
    expect(within(rows[1]).getByRole("button", { name: "Delete Model test" })).toBeInTheDocument();
    expect(within(rows[2]).queryByRole("button", { name: /^Delete/ })).not.toBeInTheDocument();
  });

  it("every filter and the sort go to the URL (server-side)", () => {
    renderPanel(<ExamsView data={page([exam()])} state={state()} {...lookups} />);
    fireEvent.change(document.getElementById("filter-status")!, { target: { value: "published" } });
    fireEvent.change(document.getElementById("filter-type")!, { target: { value: "live" } });
    fireEvent.change(document.getElementById("filter-language")!, { target: { value: "en" } });
    fireEvent.change(document.getElementById("filter-access")!, { target: { value: "paid" } });
    fireEvent.change(document.getElementById("filter-category")!, { target: { value: "1" } });
    fireEvent.change(document.getElementById("filter-subject")!, { target: { value: "10" } });
    fireEvent.change(document.getElementById("filter-featured")!, { target: { value: "true" } });
    fireEvent.change(document.getElementById("filter-upcoming")!, { target: { value: "true" } });
    expect(router.push).toHaveBeenLastCalledWith(
      "/exams?status=published&exam_type=live&content_language=en&access_type=paid&category=1&subject=10&is_featured=true&upcoming=true",
      { scroll: false },
    );
    fireEvent.click(screen.getByRole("button", { name: /Schedule/ }));
    expect(router.push).toHaveBeenLastCalledWith(expect.stringContaining("ordering=start_at"), { scroll: false });
  });

  it("changing the category clears a subject of another category", () => {
    renderPanel(<ExamsView data={page([exam()])} state={state("category=1&subject=10")} {...lookups} />);
    fireEvent.change(document.getElementById("filter-category")!, { target: { value: "" } });
    expect(router.push).toHaveBeenLastCalledWith("/exams", { scroll: false });
  });

  it("delete: confirmation, then the list is re-read (never optimistic)", async () => {
    const { calls } = mockApi(({ method }) => (method === "DELETE" ? json(204, undefined) : json(200, page([]))));
    renderPanel(<ExamsView data={page([exam()])} state={state()} {...lookups} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Delete Model test" })[0]);
    const dialog = screen.getByRole("alertdialog", { name: "Delete this exam?" });
    expect(dialog).toHaveTextContent("“Model test” and its question list will be deleted permanently.");
    expect(screen.getByRole("table", { hidden: true })).toHaveTextContent("Model test"); // still there
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await findToast()).toHaveTextContent("Exam deleted.");
    await waitFor(() => expect(calls.map((call) => call.method)).toEqual(["DELETE", "GET"]));
    expect(calls[0].url).toBe("/api/v1/admin/exams/7/");
  });

  it("delete conflict (in_use) is explained inside the dialog", async () => {
    mockApi(() => apiError(409, "in_use", "A package still grants this exam."));
    renderPanel(<ExamsView data={page([exam()])} state={state()} {...lookups} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Delete Model test" })[0]);
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await within(dialog).findByText("This exam is still in use")).toBeInTheDocument();
    expect(within(dialog).getByText("A package still grants this exam.")).toBeInTheDocument();
  });

  it("empty and no-match states; New exam keeps the filtered category", () => {
    const { unmount } = renderPanel(<ExamsView data={page([])} state={state()} {...lookups} />);
    expect(screen.getByText("No exams yet")).toBeInTheDocument();
    unmount();
    renderPanel(<ExamsView data={page([])} state={state("category=1")} {...lookups} />);
    expect(screen.getByText("No exams match these filters")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "New exam" })[0]).toHaveAttribute("href", "/exams/new?category=1");
  });

  it("Bangla labels", () => {
    renderPanel(<ExamsView data={page([exam()])} state={state()} {...lookups} />, "bn");
    expect(screen.getByRole("heading", { level: 1, name: "পরীক্ষা" })).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("খসড়া")).toBeInTheDocument();
  });
});
