import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
let currentSearch = "";
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/questions",
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

/** apiFetch replaced by requests the test resolves by hand (in any order). */
type Pending = { path: string; resolve: (value: unknown) => void; reject: (error: unknown) => void; signal?: AbortSignal };
const requests: Pending[] = [];
vi.mock("@/lib/api/client", () => ({
  apiFetch: (path: string, options: { signal?: AbortSignal } = {}) =>
    new Promise((resolve, reject) => {
      requests.push({ path, resolve, reject, signal: options.signal });
      options.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }),
}));

import { ApiError } from "@/lib/api/errors";
import { QUESTION_LIST } from "@/lib/content-specs";
import { parseListParams, toApiQuery } from "@/lib/list-params";
import { useListData } from "@/lib/use-list-data";
import { useListUrl } from "@/lib/use-list-url";
import type { Paginated } from "@/types/content";

type Row = { id: number };
const rows = (...ids: number[]): Paginated<Row> => ({ count: ids.length, next: null, previous: null, results: ids.map((id) => ({ id })) });
const at = (query: string) => parseListParams(new URLSearchParams(query), QUESTION_LIST);
const keyOf = (query: string) => toApiQuery(at(query));
const shown = (result: { current: { data: Paginated<Row> | null } }) => result.current.data?.results.map((row) => row.id) ?? null;

/** Render the data hook as the list view does: URL key + the server's props for a URL. */
function renderList(initialUrl: string, initialServer: Paginated<Row>, onPageGone = vi.fn()) {
  return renderHook(
    ({ url, server, serverUrl }: { url: string; server: Paginated<Row>; serverUrl: string }) =>
      useListData<Row>({ serverData: server, serverState: at(serverUrl), urlKey: keyOf(url), apiPath: "/admin/questions/", onPageGone }),
    { initialProps: { url: initialUrl, server: initialServer, serverUrl: initialUrl } },
  );
}

beforeEach(() => {
  requests.length = 0;
  currentSearch = "";
  Object.values(router).forEach((fn) => fn.mockReset());
});

describe("useListData — who owns the rows", () => {
  const A = "difficulty=easy";
  const B = "difficulty=hard";

  it("A: a re-read after a save is shown for the same query", async () => {
    const { result } = renderList(A, rows(1, 2));
    expect(shown(result)).toEqual([1, 2]);
    act(() => void result.current.reload());
    expect(requests[0].path).toBe(`/admin/questions/${keyOf(A)}`);
    await act(async () => requests[0].resolve(rows(1, 2, 3)));
    expect(shown(result)).toEqual([1, 2, 3]);
    expect(router.refresh).toHaveBeenCalledTimes(1); // one background re-sync
  });

  it("navigating to B discards A's re-read; Back to A shows the server's A; Forward shows B", async () => {
    const { result, rerender } = renderList(A, rows(1));
    act(() => void result.current.reload());
    await act(async () => requests[0].resolve(rows(1, 9)));
    expect(shown(result)).toEqual([1, 9]);

    rerender({ url: B, server: rows(5), serverUrl: B }); // navigation to B
    expect(shown(result)).toEqual([5]);
    rerender({ url: A, server: rows(1, 9, 10), serverUrl: A }); // Back to A
    expect(shown(result)).toEqual([1, 9, 10]); // the server's A, not the old re-read
    rerender({ url: B, server: rows(5), serverUrl: B }); // Forward to B
    expect(shown(result)).toEqual([5]);
    expect(requests).toHaveLength(1); // no extra reads when server props match the URL
  });

  it("rapid A → B → A always shows the current query's server rows", () => {
    const { result, rerender } = renderList(A, rows(1));
    rerender({ url: B, server: rows(2), serverUrl: B });
    rerender({ url: A, server: rows(1), serverUrl: A });
    rerender({ url: B, server: rows(2), serverUrl: B });
    expect(shown(result)).toEqual([2]);
  });

  it("a slow re-read for A that resolves after navigating to B never overwrites B", async () => {
    const { result, rerender } = renderList(A, rows(1));
    act(() => void result.current.reload()); // read for A in flight
    rerender({ url: B, server: rows(7), serverUrl: B });
    await act(async () => requests[0].resolve(rows(1, 2, 3))); // A's answer arrives late
    expect(shown(result)).toEqual([7]);
    expect(result.current.identity["data-reread-query"]).toBe("");
  });

  it("only the newest of two re-reads for the same query is applied", async () => {
    const { result } = renderList(A, rows(1));
    act(() => void result.current.reload());
    act(() => void result.current.reload());
    await act(async () => requests[1].resolve(rows(1, 3)));
    await act(async () => requests[0].resolve(rows(1, 2))); // older answer, later
    expect(shown(result)).toEqual([1, 3]);
  });

  it("server props rendered for ANOTHER query are never shown: the URL's page is read instead", async () => {
    // Back restored URL B, but the server props are still A's (the Next.js 15.5 desync).
    const { result } = renderList(A, rows(1));
    const { result: desynced } = renderHook(() =>
      useListData<Row>({ serverData: rows(1), serverState: at(A), urlKey: keyOf(B), apiPath: "/admin/questions/", onPageGone: vi.fn() }),
    );
    expect(shown(desynced)).toBeNull(); // loading — not A's rows
    expect(desynced.current.reloading).toBe(true);
    const read = requests.find((request) => request.path === `/admin/questions/${keyOf(B)}`)!;
    await act(async () => read.resolve(rows(8)));
    expect(shown(desynced)).toEqual([8]);
    expect(router.refresh).toHaveBeenCalled(); // and the server render is re-synced
    expect(shown(result)).toEqual([1]);
  });

  it("when the matching server render arrives first, the repair read is cancelled and not used", async () => {
    const A = "difficulty=easy";
    const B = "difficulty=hard";
    // Back to B: the restored entry still carries A's server props at first…
    const { result, rerender } = renderList(B, rows(1), vi.fn());
    rerender({ url: B, server: rows(1), serverUrl: A });
    expect(shown(result)).toBeNull();
    const repair = requests.find((request) => request.path === `/admin/questions/${keyOf(B)}`)!;
    // …then Next.js delivers B's server props.
    rerender({ url: B, server: rows(4, 5), serverUrl: B });
    expect(shown(result)).toEqual([4, 5]);
    expect(repair.signal?.aborted).toBe(true);
    await act(async () => repair.resolve(rows(99))); // too late: ignored
    expect(shown(result)).toEqual([4, 5]);
    expect(result.current.reloading).toBe(false);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("a page that no longer exists after a delete navigates to page 1", async () => {
    const onPageGone = vi.fn();
    const { result } = renderList("page=2", rows(21), onPageGone);
    act(() => void result.current.reload());
    await act(async () => requests[0].reject(new ApiError(404, "not_found", "Invalid page.")));
    expect(onPageGone).toHaveBeenCalled();
  });
});

describe("useListUrl — navigation rules", () => {
  it("state comes from the URL (not server props) and changes build one canonical URL", () => {
    currentSearch = "category=3&subject=9&page=4&search=light";
    const { result } = renderHook(() => useListUrl(QUESTION_LIST));
    expect(result.current.state).toMatchObject({ page: 4, search: "light", filters: { category: "3", subject: "9" } });
    act(() => result.current.update({ filters: { difficulty: "easy" } }));
    // unrelated filters kept, page reset to 1, fixed parameter order
    expect(router.push).toHaveBeenLastCalledWith("/questions?category=3&subject=9&difficulty=easy&search=light", { scroll: false });
  });

  it("a change that leads to the state already requested adds no history entry", () => {
    currentSearch = "difficulty=easy";
    const { result } = renderHook(() => useListUrl(QUESTION_LIST));
    act(() => result.current.update({ filters: { difficulty: "easy" } }));
    act(() => result.current.update({ page: 1 }));
    expect(router.push).not.toHaveBeenCalled();
  });

  it("chains quick changes, and restarts from the URL after Back/Forward", () => {
    currentSearch = "";
    const { result, rerender } = renderHook(() => useListUrl(QUESTION_LIST));
    act(() => result.current.update({ filters: { difficulty: "easy" } }));
    act(() => result.current.update({ filters: { language: "bn" } }));
    expect(router.push).toHaveBeenLastCalledWith("/questions?difficulty=easy&language=bn", { scroll: false });
    currentSearch = "is_active=true"; // Back/Forward landed somewhere else
    rerender();
    act(() => result.current.update({ ordering: "id" }));
    expect(router.push).toHaveBeenLastCalledWith("/questions?is_active=true&ordering=id", { scroll: false });
  });

  it("does not modify the router's search params object", () => {
    const params = new URLSearchParams("difficulty=easy");
    currentSearch = params.toString();
    const { result } = renderHook(() => useListUrl(QUESTION_LIST));
    act(() => result.current.update({ filters: { difficulty: "hard" }, search: "x" }));
    expect(params.toString()).toBe("difficulty=easy");
  });
});
