/** List screens keep their state (page, page size, search, filters, sort) in the URL query
 * string, so a view can be shared, bookmarked and restored with Back. These pure helpers
 * turn untrusted URL values into a valid state — unknown values are dropped rather than
 * sent to the API (which would answer 400) — and build the API and URL queries from it. */

export const PAGE_SIZES = [10, 20, 50, 100] as const; // the API allows up to 100
export const DEFAULT_PAGE_SIZE = 20;
export const SEARCH_MAX_LENGTH = 100; // backend SEARCH_MAX_LENGTH

/** "id" = positive integer; "bool" = true/false; a list = allowed values. */
export type FilterRule = "id" | "bool" | readonly string[];

export type ListSpec = {
  filters: Record<string, FilterRule>;
  /** Fields the API accepts in `ordering` (a "-" prefix sorts descending). */
  orderings: readonly string[];
  defaultOrdering: string;
};

export type ListState = {
  page: number;
  pageSize: number;
  search: string;
  ordering: string;
  filters: Record<string, string>;
};

type RawParams = URLSearchParams | Record<string, string | string[] | undefined>;

function read(params: RawParams, name: string): string {
  if (params instanceof URLSearchParams) return params.get(name) ?? "";
  const value = params[name];
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function positiveInt(raw: string): number | null {
  if (!/^\d{1,9}$/.test(raw.trim())) return null;
  const value = Number(raw);
  return value > 0 ? value : null;
}

function validFilter(rule: FilterRule, raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (rule === "id") return positiveInt(value) === null ? null : String(Number(value));
  if (rule === "bool") return value === "true" || value === "false" ? value : null;
  return rule.includes(value) ? value : null;
}

export function parseListParams(params: RawParams, spec: ListSpec): ListState {
  const size = positiveInt(read(params, "page_size"));
  const ordering = read(params, "ordering");
  const filters: Record<string, string> = {};
  for (const [name, rule] of Object.entries(spec.filters)) {
    const value = validFilter(rule, read(params, name));
    if (value !== null) filters[name] = value;
  }
  return {
    page: positiveInt(read(params, "page")) ?? 1,
    pageSize: size !== null && (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE,
    search: read(params, "search").trim().slice(0, SEARCH_MAX_LENGTH),
    ordering: spec.orderings.includes(ordering.replace(/^-/, "")) ? ordering : spec.defaultOrdering,
    filters,
  };
}

/** Query for the backend list endpoint (always explicit). */
export function toApiQuery(state: ListState): string {
  const query = new URLSearchParams();
  query.set("page", String(state.page));
  query.set("page_size", String(state.pageSize));
  if (state.search) query.set("search", state.search);
  query.set("ordering", state.ordering);
  for (const [name, value] of Object.entries(state.filters)) query.set(name, value);
  return `?${query.toString()}`;
}

/** Query for the panel URL: defaults are left out so URLs stay short. */
export function toUrlQuery(state: ListState, spec: ListSpec): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(state.filters)) if (value) query.set(name, value);
  if (state.search) query.set("search", state.search);
  if (state.ordering !== spec.defaultOrdering) query.set("ordering", state.ordering);
  if (state.pageSize !== DEFAULT_PAGE_SIZE) query.set("page_size", String(state.pageSize));
  if (state.page > 1) query.set("page", String(state.page));
  const text = query.toString();
  return text ? `?${text}` : "";
}

/** Apply a change; anything but a page change goes back to page 1. */
export function updateListState(state: ListState, change: Partial<Omit<ListState, "filters">> & { filters?: Record<string, string> }): ListState {
  const filters = { ...state.filters, ...change.filters };
  for (const name of Object.keys(filters)) if (!filters[name]) delete filters[name];
  const next = { ...state, ...change, filters };
  if (change.page === undefined) next.page = 1;
  return next;
}

export function activeFilterCount(state: ListState): number {
  return Object.values(state.filters).filter(Boolean).length;
}
