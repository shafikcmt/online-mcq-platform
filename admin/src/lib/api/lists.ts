import "server-only";

import { redirect } from "next/navigation";

import { toApiQuery, toUrlQuery, type ListSpec, type ListState } from "@/lib/list-params";
import type { Paginated } from "@/types/content";

import { ApiError, adminRead } from "./server";

/** One page of an admin list for a server-rendered list screen. A page past the end
 * (e.g. after the last row of the last page was deleted) answers 404: go to page 1. */
export async function adminList<T>(
  apiPath: string,
  state: ListState,
  spec: ListSpec,
  panelPath: string,
): Promise<Paginated<T>> {
  try {
    return await adminRead<Paginated<T>>(`${apiPath}${toApiQuery(state)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 && state.page > 1) {
      redirect(`${panelPath}${toUrlQuery({ ...state, page: 1 }, spec)}`);
    }
    throw error;
  }
}

const LOOKUP_PAGE_SIZE = 100; // the API maximum
const LOOKUP_MAX_PAGES = 20;

/** Every row of a small reference list (categories/subjects for names and filter menus):
 * the first page, then the remaining pages in parallel. Capped, so a huge catalogue
 * cannot turn one screen into hundreds of requests; `truncated` reports the cap. */
export async function adminLookup<T>(apiPath: string, query = ""): Promise<{ rows: T[]; truncated: boolean }> {
  const base = `${apiPath}?page_size=${LOOKUP_PAGE_SIZE}&ordering=sort_order${query ? `&${query}` : ""}`;
  const first = await adminRead<Paginated<T>>(`${base}&page=1`);
  const pages = Math.min(Math.ceil(first.count / LOOKUP_PAGE_SIZE), LOOKUP_MAX_PAGES);
  const rest = await Promise.all(
    Array.from({ length: Math.max(pages - 1, 0) }, (_, index) =>
      adminRead<Paginated<T>>(`${base}&page=${index + 2}`),
    ),
  );
  const rows = [first, ...rest].flatMap((page) => page.results);
  return { rows, truncated: rows.length < first.count };
}
