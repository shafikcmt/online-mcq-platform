import { describe, expect, it } from "vitest";

import { CATEGORY_LIST, QUESTION_LIST } from "@/lib/content-specs";
import { parseListParams, toApiQuery, toUrlQuery, updateListState } from "@/lib/list-params";

describe("list URL state", () => {
  it("uses defaults for an empty URL", () => {
    expect(parseListParams({}, QUESTION_LIST)).toEqual({
      page: 1,
      pageSize: 20,
      search: "",
      ordering: "-created_at",
      filters: {},
    });
  });

  it("keeps valid values and drops unknown or malformed ones (never sent to the API)", () => {
    const state = parseListParams(
      new URLSearchParams(
        "page=3&page_size=50&search=%20light%20&ordering=-difficulty&category=7&subject=abc&difficulty=extreme&language=bn&is_active=true&hack=1",
      ),
      QUESTION_LIST,
    );
    expect(state).toEqual({
      page: 3,
      pageSize: 50,
      search: "light",
      ordering: "-difficulty",
      filters: { category: "7", language: "bn", is_active: "true" },
    });
    const bad = parseListParams({ page: "-2", page_size: "1000", ordering: "password", is_active: "yes" }, CATEGORY_LIST);
    expect(bad).toMatchObject({ page: 1, pageSize: 20, ordering: "sort_order", filters: {} });
  });

  it("builds an explicit API query and a short panel URL", () => {
    const state = parseListParams({ search: "ভৌত", is_active: "false" }, CATEGORY_LIST);
    expect(toApiQuery(state)).toBe(
      `?page=1&page_size=20&search=${encodeURIComponent("ভৌত")}&ordering=sort_order&is_active=false`,
    );
    expect(toUrlQuery(state, CATEGORY_LIST)).toBe(`?is_active=false&search=${encodeURIComponent("ভৌত")}`);
    expect(toUrlQuery(parseListParams({}, CATEGORY_LIST), CATEGORY_LIST)).toBe("");
  });

  it("goes back to page 1 when a filter, search or sort changes, and removes cleared filters", () => {
    const state = parseListParams({ page: "4", category: "2", subject: "9" }, QUESTION_LIST);
    expect(updateListState(state, { page: 5 }).page).toBe(5);
    const next = updateListState(state, { filters: { category: "3", subject: "" } });
    expect(next.page).toBe(1);
    expect(next.filters).toEqual({ category: "3" });
    expect(state.filters).toEqual({ category: "2", subject: "9" }); // not mutated
    expect(updateListState(state, { ordering: "id" }).page).toBe(1);
  });
});
