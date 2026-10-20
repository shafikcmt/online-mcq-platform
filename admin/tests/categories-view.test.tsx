import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/categories",
  // The list's state comes from the URL, as in the app.
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { CategoriesView } from "@/components/content/categories-view";
import { CATEGORY_LIST } from "@/lib/content-specs";
import { parseListParams } from "@/lib/list-params";

import { apiError, category, findToast, json, mockApi, page, renderPanel } from "./content-helpers";

/** Visit the list at `query` (the URL is the list's source of truth) and return the state
 * the server page would have parsed from it. */
const state = (query = "") => {
  window.history.replaceState({}, "", `/categories${query ? `?${query}` : ""}`);
  return parseListParams(new URLSearchParams(query), CATEGORY_LIST);
};
// `hidden`: while a dialog is open the page behind it is aria-hidden.
const table = (name = "Categories") => screen.getByRole("table", { name, hidden: true });
const nameBox = (dialog: HTMLElement, label: "English" | "Bangla") =>
  within(within(dialog).getByRole("group", { name: /^Name/ })).getByLabelText(label);

beforeEach(() => {
  router.push.mockReset();
  router.replace.mockReset();
  router.refresh.mockReset();
});

describe("CategoriesView", () => {
  it("lists both languages, links subjects and shows status as text", () => {
    renderPanel(<CategoriesView data={page([category(), category({ id: 2, name_en: "", name_bn: "শুধু বাংলা", is_active: false })])} state={state()} />);
    const rows = within(table()).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("HSC");
    expect(rows[1]).toHaveTextContent("এইচএসসি");
    expect(within(rows[2]).getByText("শুধু বাংলা")).toHaveAttribute("lang", "bn"); // fallback language
    expect(within(rows[2]).getByText("Inactive")).toBeInTheDocument();
    expect(within(rows[1]).getByRole("link", { name: "View subjects of HSC" })).toHaveAttribute("href", "/subjects?category=1");
  });

  it("puts search, filters, sorting and paging into the URL (server does the filtering)", () => {
    renderPanel(<CategoriesView data={page([category()], 45)} state={state("is_active=true")} />);
    fireEvent.change(document.getElementById("filter-status")!, { target: { value: "false" } });
    expect(router.push).toHaveBeenLastCalledWith("/categories?is_active=false", { scroll: false });
    fireEvent.click(within(table()).getByRole("button", { name: /Name/ }));
    // Changes build on each other until the server re-renders (the mock router never does).
    expect(router.push).toHaveBeenLastCalledWith("/categories?is_active=false&ordering=name_en", { scroll: false });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(router.push).toHaveBeenLastCalledWith("/categories?is_active=false&ordering=name_en&page=2", { scroll: false });
  });

  it("shows distinct empty states for an empty catalogue and for no matches", () => {
    const { rerender } = renderPanel(<CategoriesView data={page([])} state={state()} />);
    expect(screen.getByText("No categories yet")).toBeInTheDocument();
    rerender(<CategoriesView data={page([])} state={state("search=zzz")} />);
    expect(screen.getByText("No categories match these filters")).toBeInTheDocument();
  });

  it("creates a category and maps server field errors onto the fields", async () => {
    const { calls } = mockApi(({ method, body }) => {
      // The list's re-read after a successful save: the server's current page.
      if (method === "GET") return json(200, page([category(), category({ id: 5, name_en: "SSC", name_bn: "", slug: "ssc" })]));
      if (method === "POST" && (body as { slug: string }).slug === "taken") {
        return apiError(400, "validation_error", "Please correct the highlighted fields.", {
          slug: ["A category with this slug already exists."],
        });
      }
      return json(201, category({ id: 5 }));
    });
    renderPanel(<CategoriesView data={page([category()])} state={state()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "New category" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New category" });
    fireEvent.change(nameBox(dialog, "English"), { target: { value: "SSC" } });
    fireEvent.change(within(dialog).getByLabelText(/^Slug/), { target: { value: "taken" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    const slug = within(dialog).getByLabelText(/^Slug/);
    await waitFor(() => expect(slug).toHaveAttribute("aria-invalid", "true"));
    expect(slug).toHaveAccessibleDescription(expect.stringContaining("A category with this slug already exists."));
    expect(router.refresh).not.toHaveBeenCalled();

    fireEvent.change(slug, { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const post = calls.filter((call) => call.method === "POST").at(-1);
    expect(post).toMatchObject({ url: "/api/v1/admin/categories/" });
    expect(post?.body).toMatchObject({ name_en: "SSC", slug: "", sort_order: 0, is_active: true });
    expect(await findToast()).toHaveTextContent("Category created.");
    // Shown from the API re-read (same page, filters and sort) — not dependent on the
    // server-rendered refresh committing (the mocked router never re-renders).
    expect(await within(table()).findByText("SSC")).toBeInTheDocument();
    expect(calls.at(-1)).toMatchObject({ method: "GET", url: "/api/v1/admin/categories/?page=1&page_size=20&ordering=sort_order" });
    expect(router.refresh).toHaveBeenCalledTimes(1); // one background refresh, nothing more
  });

  it("edits with PATCH and shows the shared 'one name required' error once", async () => {
    const message = "Enter a name in Bangla or English (at least one is required).";
    const { calls } = mockApi(() => apiError(400, "validation_error", "x", { name_bn: [message], name_en: [message] }));
    renderPanel(<CategoriesView data={page([category()])} state={state()} />);
    fireEvent.click(within(table()).getByRole("button", { name: "Edit HSC" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit category" });
    fireEvent.change(nameBox(dialog, "English"), { target: { value: "" } });
    fireEvent.change(nameBox(dialog, "Bangla"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(within(dialog).getAllByText(message)).toHaveLength(1));
    expect(nameBox(dialog, "English")).toHaveAttribute("aria-invalid", "true");
    expect(nameBox(dialog, "Bangla")).toHaveAttribute("aria-invalid", "true");
    expect(calls[0]).toMatchObject({ method: "PATCH", url: "/api/v1/admin/categories/1/" });
  });

  it("does not remove a category that is in use (409) and refreshes only after a real delete", async () => {
    let inUse = true;
    mockApi(({ method }) => {
      if (method === "GET") return json(200, page([]));
      return inUse ? apiError(409, "in_use", "This category still has subjects. Delete or move them first.") : json(204, undefined);
    });
    renderPanel(<CategoriesView data={page([category()])} state={state()} />);
    fireEvent.click(within(table()).getByRole("button", { name: "Delete HSC" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete this category?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await within(dialog).findByText("This category still has subjects. Delete or move them first.")).toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(within(table()).getAllByRole("row", { hidden: true })).toHaveLength(2); // still listed

    inUse = false;
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(await screen.findByText("No categories yet")).toBeInTheDocument(); // the server's re-read page
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(await findToast()).toHaveTextContent("Category deleted.");
  });

  it("explains an HTML error page or a dropped connection without showing raw content", async () => {
    let mode: "html" | "network" = "html";
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      if (mode === "network") throw new TypeError("Failed to fetch");
      return new Response("<html><body>502 Bad Gateway</body></html>", { status: 502, headers: { "content-type": "text/html" } });
    });
    document.cookie = "csrftoken=t; path=/";
    renderPanel(<CategoriesView data={page([category()])} state={state()} />);
    fireEvent.click(within(table()).getByRole("button", { name: "Delete HSC" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The server couldn't complete this request.");
    expect(dialog).not.toHaveTextContent("Bad Gateway");
    mode = "network";
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("Can't reach the server."));
  });

  it("after a delete, focus moves to the next row, else the previous row, else the create button", async () => {
    let rows = [category({ id: 1, name_en: "One" }), category({ id: 2, name_en: "Two" }), category({ id: 3, name_en: "Three" })];
    mockApi(({ method, url }) => {
      if (method === "DELETE") {
        const id = Number(url.split("/").at(-2));
        rows = rows.filter((row) => row.id !== id);
        return json(204, undefined);
      }
      return json(200, page(rows)); // the list's re-read: what the server has now
    });
    renderPanel(<CategoriesView data={page(rows)} state={state()} />);
    const remove = async (name: string) => {
      fireEvent.click(within(table()).getByRole("button", { name: `Delete ${name}`, hidden: true }));
      fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    };

    await remove("Two");
    await waitFor(() => expect(within(table()).getByRole("button", { name: "Delete Three" })).toHaveFocus());
    await remove("Three");
    await waitFor(() => expect(within(table()).getByRole("button", { name: "Delete One" })).toHaveFocus());
    await remove("One");
    await waitFor(() => expect(screen.getAllByRole("button", { name: "New category" })[0]).toHaveFocus());
  });

  it("deleting the last row of a later page moves to page 1 (navigation, not a stuck refresh)", async () => {
    mockApi(({ method }) =>
      method === "DELETE" ? json(204, undefined) : apiError(404, "not_found", "Invalid page."),
    );
    renderPanel(<CategoriesView data={page([category({ id: 21, name_en: "Last" })], 21)} state={state("page=2")} />);
    fireEvent.click(within(table()).getByRole("button", { name: "Delete Last" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/categories", { scroll: false }));
  });

  it("renders in Bangla", () => {
    renderPanel(<CategoriesView data={page([category()])} state={state()} />, "bn");
    expect(screen.getByRole("heading", { level: 1, name: "ক্যাটাগরি" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "নতুন ক্যাটাগরি" })[0]).toBeInTheDocument();
    expect(within(table("ক্যাটাগরি")).getAllByRole("row")[1].querySelector("[lang=bn]")).toHaveTextContent("এইচএসসি");
  });
});
