import { beforeEach, describe, expect, it, vi } from "vitest";

const adminRead = vi.fn();
vi.mock("@/lib/api/server", async () => {
  const { ApiError } = await import("@/lib/api/errors");
  return { adminRead: (path: string) => adminRead(path), ApiError };
});
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: () => notFound() }));

import { ApiError } from "@/lib/api/errors";
import { readExamOrNull, readResult } from "@/lib/api/result-page";
import { RESULT_LIST } from "@/lib/content-specs";
import { parseListParams, toApiQuery } from "@/lib/list-params";
import { durationParts } from "@/lib/results";

import { adminResult, exam, page } from "./content-helpers";

const ID = "6f1c2b9e-1d2a-4c3b-8e4f-5a6b7c8d9e01";

beforeEach(() => {
  adminRead.mockReset();
  notFound.mockClear();
});

describe("readResult: one result through the list's attempt filter", () => {
  it("asks the list for exactly this attempt and returns the single row", async () => {
    adminRead.mockResolvedValue(page([adminResult({ attempt_id: ID })]));
    expect(await readResult(ID)).toMatchObject({ attempt_id: ID, user_full_name: "Ayesha Siddika" });
    expect(adminRead).toHaveBeenCalledWith(`/admin/results/?attempt=${ID}`);
  });

  it("0 rows → not found", async () => {
    adminRead.mockResolvedValue(page([]));
    await expect(readResult(ID)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a malformed id never reaches the API", async () => {
    await expect(readResult("not-a-uuid")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(readResult("../exams")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(adminRead).not.toHaveBeenCalled();
  });

  it("more than one row is a broken contract: fail safely, never pick one", async () => {
    adminRead.mockResolvedValue(page([adminResult({ attempt_id: ID }), adminResult({ attempt_id: ID })]));
    await expect(readResult(ID)).rejects.toThrow("more than one result");
    adminRead.mockResolvedValue(page([adminResult({ attempt_id: ID })], 2));
    await expect(readResult(ID)).rejects.toThrow("more than one result");
    expect(notFound).not.toHaveBeenCalled();
  });

  it("a row for another attempt is rejected too", async () => {
    adminRead.mockResolvedValue(page([adminResult({ attempt_id: "00000000-0000-4000-8000-000000000000" })]));
    await expect(readResult(ID)).rejects.toThrow();
  });

  it("readExamOrNull: 404 → null, other errors propagate", async () => {
    adminRead.mockResolvedValueOnce(exam());
    expect(await readExamOrNull(7)).toMatchObject({ id: 7 });
    adminRead.mockRejectedValueOnce(new ApiError(404, "not_found", "x"));
    expect(await readExamOrNull(7)).toBeNull();
    adminRead.mockRejectedValueOnce(new ApiError(500, "server_error", "x"));
    await expect(readExamOrNull(7)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("results list query", () => {
  it("accepts only the server's filters and orderings", () => {
    const state = parseListParams(
      new URLSearchParams("exam=7&user=40&is_passed=false&merit_counted=true&ordering=merit_position&search=ayesha&evil=1"),
      RESULT_LIST,
    );
    expect(toApiQuery(state)).toBe(
      "?page=1&page_size=20&search=ayesha&ordering=merit_position&exam=7&user=40&is_passed=false&merit_counted=true",
    );
    const fallback = parseListParams(new URLSearchParams("ordering=obtained_marks&is_passed=maybe&exam=x"), RESULT_LIST);
    expect(fallback.ordering).toBe("-submitted_at");
    expect(fallback.filters).toEqual({});
  });

  it("duration parts", () => {
    expect(durationParts(754)).toEqual({ minutes: 12, seconds: 34 });
    expect(durationParts(59)).toEqual({ minutes: 0, seconds: 59 });
    expect(durationParts(-5)).toEqual({ minutes: 0, seconds: 0 });
  });
});
