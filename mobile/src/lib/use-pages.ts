import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";

/** A DRF page `{count, next, previous, results}`, plus whatever else the endpoint adds
 * (`server_time`, `my_position`…), kept from the latest page as `extra`. */
export type Page<T> = { count: number; next: string | null; previous?: string | null; results: T[] };

type State<T, P extends Page<T>> = {
  items: T[];
  count: number;
  page: number;
  hasMore: boolean;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: unknown;
  extra: Omit<P, "results"> | null;
};

function empty<T, P extends Page<T>>(): State<T, P> {
  return { items: [], count: 0, page: 0, hasMore: false, loading: true, refreshing: false, loadingMore: false, error: null, extra: null };
}

/** A paged list. The first page loads when `key` changes (a new filter), again quietly
 * whenever the screen comes back into view, and on pull-to-refresh; later pages load as
 * the list nears its end, without duplicates (`id`). A failed reload keeps what is on
 * screen; answers that arrive after the key changed are ignored. `load` must change only
 * with `key` (useCallback). */
export function usePages<T, P extends Page<T>>(load: (page: number) => Promise<P>, key: string, id: (item: T) => string) {
  const [state, setState] = useState<State<T, P>>(empty);
  const latest = useRef(0);
  const shown = useRef<string | null>(null);
  const busyMore = useRef(false);

  const first = useCallback(
    async (mode: "load" | "refresh" | "quiet") => {
      const request = (latest.current += 1);
      busyMore.current = false;
      setState((prev) => (mode === "load" ? empty() : { ...prev, refreshing: mode === "refresh", loadingMore: false }));
      try {
        const { results, ...extra } = await load(1);
        if (request !== latest.current) return;
        setState({ items: results, count: extra.count, page: 1, hasMore: extra.next !== null, loading: false, refreshing: false, loadingMore: false, error: null, extra });
      } catch (error) {
        if (request === latest.current) setState((prev) => ({ ...prev, error, loading: false, refreshing: false }));
      }
    },
    [load],
  );

  useFocusEffect(
    useCallback(() => {
      void first(shown.current === key ? "quiet" : "load");
      shown.current = key;
    }, [first, key]),
  );

  const loadMore = useCallback(async () => {
    if (busyMore.current || !state.hasMore || state.loading) return;
    busyMore.current = true;
    const request = latest.current;
    const next = state.page + 1;
    setState((prev) => ({ ...prev, loadingMore: true }));
    try {
      const { results, ...extra } = await load(next);
      if (request !== latest.current) return;
      setState((prev) => {
        const seen = new Set(prev.items.map(id));
        return {
          ...prev,
          items: [...prev.items, ...results.filter((item) => !seen.has(id(item)))],
          count: extra.count,
          page: next,
          hasMore: extra.next !== null,
          loadingMore: false,
          extra,
        };
      });
    } catch (error) {
      if (request === latest.current) setState((prev) => ({ ...prev, error, loadingMore: false }));
    } finally {
      if (request === latest.current) busyMore.current = false;
    }
  }, [id, load, state.hasMore, state.loading, state.page]);

  return { ...state, refresh: () => first("refresh"), retry: () => first("load"), loadMore };
}
