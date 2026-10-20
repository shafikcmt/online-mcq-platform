import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/subjects",
  // The list's state comes from the URL, as in the app.
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { SubjectsView } from "@/components/content/subjects-view";
import { SUBJECT_LIST } from "@/lib/content-specs";
import { parseListParams } from "@/lib/list-params";

import { apiError, category, json, mockApi, page, renderPanel, subject } from "./content-helpers";

/** Visit the list at `query` (the URL is the list's source of truth) and return the state
 * the server page would have parsed from it. */
const state = (query = "") => {
  window.history.replaceState({}, "", `/subjects${query ? `?${query}` : ""}`);
  return parseListParams(new URLSearchParams(query), SUBJECT_LIST);
};
const categories = [category(), category({ id: 2, name_en: "SSC", name_bn: "এসএসসি", slug: "ssc" })];

beforeEach(() => {
  router.push.mockReset();
  router.refresh.mockReset();
});

describe("SubjectsView", () => {
  it("shows each subject's category name from one lookup and filters by category via the URL", () => {
    renderPanel(
      <SubjectsView data={page([subject(), subject({ id: 11, category: 99 })])} state={state()} categories={categories} categoriesTruncated={false} />,
    );
    const rows = within(screen.getByRole("table", { name: "Subjects" })).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("HSC");
    expect(rows[2]).toHaveTextContent("Category #99"); // unknown id: still readable
    fireEvent.change(document.getElementById("filter-category")!, { target: { value: "2" } });
    expect(router.push).toHaveBeenLastCalledWith("/subjects?category=2", { scroll: false });
  });

  it("keeps earlier filter changes when several are made before the page reloads", () => {
    renderPanel(<SubjectsView data={page([subject()])} state={state()} categories={categories} categoriesTruncated={false} />);
    fireEvent.change(document.getElementById("filter-category")!, { target: { value: "2" } });
    fireEvent.change(document.getElementById("filter-status")!, { target: { value: "true" } });
    expect(router.push).toHaveBeenLastCalledWith("/subjects?category=2&is_active=true", { scroll: false });
  });

  it("requires a category first and pre-selects the filtered category in the form", async () => {
    const { calls } = mockApi(({ method, body }) =>
      method === "GET"
        ? json(200, page([subject({ id: 12, category: 2 })]))
        : (body as { category: number | null }).category
        ? json(201, subject({ id: 12, category: 2 }))
        : apiError(400, "validation_error", "x", { category: ["This field may not be null."] }),
    );
    renderPanel(<SubjectsView data={page([])} state={state("category=2")} categories={categories} categoriesTruncated={false} />);
    fireEvent.click(screen.getByRole("button", { name: "New subject" }));
    const dialog = await screen.findByRole("dialog", { name: "New subject" });
    const select = within(dialog).getByLabelText(/^Category/);
    expect(select).toHaveValue("2");
    fireEvent.change(select, { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(select).toHaveAttribute("aria-invalid", "true"));
    fireEvent.change(select, { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls.filter((call) => call.method === "POST").at(-1)).toMatchObject({ url: "/api/v1/admin/subjects/", body: expect.objectContaining({ category: 2 }) });
    expect(calls.at(-1)).toMatchObject({ method: "GET", url: "/api/v1/admin/subjects/?page=1&page_size=20&ordering=sort_order&category=2" });
    expect(router.refresh).toHaveBeenCalled();
  });

  it("disables creating subjects when there are no categories", () => {
    renderPanel(<SubjectsView data={page([])} state={state()} categories={[]} categoriesTruncated={false} />);
    expect(screen.getByRole("button", { name: "New subject" })).toBeDisabled();
    expect(screen.getByText("Create a category first.")).toBeInTheDocument();
  });

  it("explains a 409 in_use delete inside the dialog", async () => {
    mockApi(() => apiError(409, "in_use", "This subject has questions."));
    renderPanel(<SubjectsView data={page([subject()])} state={state()} categories={categories} categoriesTruncated={false} />);
    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "Delete Physics" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await within(dialog).findByText("This subject has questions.")).toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
