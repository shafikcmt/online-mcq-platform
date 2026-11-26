import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/groups",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { GroupsView } from "@/components/content/groups-view";
import { GROUP_LIST } from "@/lib/content-specs";
import { parseListParams } from "@/lib/list-params";

import { category, group, json, mockApi, page, renderPanel } from "./content-helpers";

const state = (query = "") => {
  window.history.replaceState({}, "", `/groups${query ? `?${query}` : ""}`);
  return parseListParams(new URLSearchParams(query), GROUP_LIST);
};
const categories = [category(), category({ id: 2, name_en: "SSC", name_bn: "এসএসসি", slug: "ssc" })];

beforeEach(() => {
  router.push.mockReset();
  router.refresh.mockReset();
});

describe("GroupsView", () => {
  it("shows the category, the parent group and the exam count of each group", () => {
    const top = group();
    const kid = group({ id: 31, parent: 30, name_en: "Weekly test", name_bn: "সাপ্তাহিক", slug: "weekly", exam_count: 5 });
    renderPanel(<GroupsView data={page([top, kid])} state={state()} categories={categories} groups={[top, kid]} lookupTruncated={false} />);
    const rows = within(screen.getByRole("table", { name: "Exam groups" })).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("HSC");
    expect(rows[2]).toHaveTextContent("BCS prep"); // the parent of the sub-group
    expect(rows[2]).toHaveTextContent("5");
  });

  it("filters by category through the URL", () => {
    renderPanel(<GroupsView data={page([group()])} state={state()} categories={categories} groups={[group()]} lookupTruncated={false} />);
    fireEvent.change(document.getElementById("filter-category")!, { target: { value: "2" } });
    expect(router.push).toHaveBeenLastCalledWith("/groups?category=2", { scroll: false });
  });

  it("offers only top-level groups of the chosen category as the parent and sends it", async () => {
    const top = group();
    const otherCategory = group({ id: 40, category: 2, name_en: "SSC prep", slug: "ssc-prep" });
    const kid = group({ id: 31, parent: 30, slug: "kid", name_en: "Kid" });
    const { calls } = mockApi(({ method }) => (method === "GET" ? json(200, page([top])) : json(201, group({ id: 50, parent: 30 }))));
    renderPanel(<GroupsView data={page([])} state={state("category=1")} categories={categories} groups={[top, otherCategory, kid]} lookupTruncated={false} />);
    fireEvent.click(screen.getByRole("button", { name: "New group" }));
    const dialog = await screen.findByRole("dialog", { name: "New group" });
    const parent = within(dialog).getByLabelText(/^Parent group/);
    const options = within(parent).getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["None (a top-level group)", "BCS prep"]); // not SSC's group, not a sub-group
    fireEvent.change(parent, { target: { value: "30" } });
    fireEvent.change(within(dialog).getAllByRole("textbox", { name: /English/ })[0], { target: { value: "Weekly" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls.filter((call) => call.method === "POST").at(-1)).toMatchObject({
      url: "/api/v1/admin/groups/",
      body: expect.objectContaining({ category: 1, parent: 30, name_en: "Weekly" }),
    });
  });
});
