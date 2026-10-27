import { describe, expect, test } from "vitest";

import { apiPath, pageHref, parseFilters, scheduleState } from "@/lib/exam-filters";

describe("exam filters", () => {
  test("defaults: open now, page 1, nothing else", () => {
    expect(parseFilters({})).toEqual({ when: "open", type: undefined, access: undefined, category: undefined, page: 1 });
  });

  test("valid values pass (case and spaces ignored)", () => {
    expect(parseFilters({ when: "Upcoming", type: " live ", access: "paid", category: "hsc-science", page: "3" })).toEqual({
      when: "upcoming",
      type: "live",
      access: "paid",
      category: "hsc-science",
      page: 3,
    });
  });

  test("anything unknown in the address is dropped, never sent to the API", () => {
    const filters = parseFilters({ when: "soon", type: "marathon", access: "x", category: "../admin", page: "-2" });
    expect(filters).toEqual({ when: "open", type: undefined, access: undefined, category: undefined, page: 1 });
    expect(parseFilters({ page: "1.5" }).page).toBe(1);
    expect(parseFilters({ page: "99999" }).page).toBe(1);
    expect(parseFilters({ category: "a".repeat(141) }).category).toBeUndefined();
    expect(parseFilters({ type: ["live", "practice"] }).type).toBe("live"); // repeated → the first
  });

  test("API path and page address", () => {
    const filters = parseFilters({ when: "ended", type: "live", category: "maths", page: "2" });
    expect(apiPath(filters)).toBe("exams/?when=ended&type=live&category=maths&page=2&page_size=12");
    expect(apiPath(parseFilters({}))).toBe("exams/?when=open&page_size=12");
    expect(pageHref("en", filters)).toBe("/en/exams?when=ended&type=live&category=maths&page=2");
    expect(pageHref("bn", { when: "open", page: 1 })).toBe("/bn/exams"); // the defaults stay out of the address
  });
});

test("schedule state follows the exam engine's window", () => {
  const now = Date.parse("2026-11-01T10:00:00Z");
  expect(scheduleState({ start_at: null, end_at: null }, now)).toBe("open");
  expect(scheduleState({ start_at: "2026-11-01T10:00:00Z", end_at: null }, now)).toBe("open"); // starts exactly now
  expect(scheduleState({ start_at: "2026-11-01T11:00:00Z", end_at: null }, now)).toBe("upcoming");
  expect(scheduleState({ start_at: null, end_at: "2026-11-01T10:00:00Z" }, now)).toBe("ended"); // ends exactly now
});
