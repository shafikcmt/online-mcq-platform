import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";

import { fetchExams } from "./api";
import type { ExamWhen, StudentExam } from "./types";

type State = {
  items: StudentExam[];
  count: number;
  page: number;
  hasMore: boolean;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: unknown;
  serverTime: string | undefined;
};

const EMPTY: State = { items: [], count: 0, page: 0, hasMore: false, loading: true, refreshing: false, loadingMore: false, error: null, serverTime: undefined };

/** A paged exam list for one filter. The first page loads when the filter changes, again
 * quietly whenever the screen comes back into view, and on pull-to-refresh; further pages
 * load as the list nears its end. A failed reload keeps what is on screen. Responses that
 * arrive after the filter changed are ignored. */
export function useExamPages(when: ExamWhen) {
  const [state, setState] = useState<State>(EMPTY);
  const latest = useRef(0);
  const shown = useRef<ExamWhen | null>(null);
  const busyMore = useRef(false);

  const first = useCallback(
    async (mode: "load" | "refresh" | "quiet") => {
      const id = (latest.current += 1);
      busyMore.current = false;
      setState((prev) => (mode === "load" ? EMPTY : { ...prev, refreshing: mode === "refresh", loadingMore: false }));
      try {
        const data = await fetchExams(when, 1);
        if (id !== latest.current) return;
        setState({
          items: data.results,
          count: data.count,
          page: 1,
          hasMore: data.next !== null,
          loading: false,
          refreshing: false,
          loadingMore: false,
          error: null,
          serverTime: data.server_time,
        });
      } catch (error) {
        if (id === latest.current) setState((prev) => ({ ...prev, error, loading: false, refreshing: false }));
      }
    },
    [when],
  );

  useFocusEffect(
    useCallback(() => {
      void first(shown.current === when ? "quiet" : "load");
      shown.current = when;
    }, [first, when]),
  );

  const loadMore = useCallback(async () => {
    if (busyMore.current || !state.hasMore || state.loading) return;
    busyMore.current = true;
    const id = latest.current;
    const next = state.page + 1;
    setState((prev) => ({ ...prev, loadingMore: true }));
    try {
      const data = await fetchExams(when, next);
      if (id !== latest.current) return;
      setState((prev) => {
        const seen = new Set(prev.items.map((exam) => exam.slug));
        return {
          ...prev,
          items: [...prev.items, ...data.results.filter((exam) => !seen.has(exam.slug))],
          count: data.count,
          page: next,
          hasMore: data.next !== null,
          loadingMore: false,
          serverTime: data.server_time,
        };
      });
    } catch (error) {
      if (id === latest.current) setState((prev) => ({ ...prev, error, loadingMore: false }));
    } finally {
      if (id === latest.current) busyMore.current = false;
    }
  }, [state.hasMore, state.loading, state.page, when]);

  return { ...state, refresh: () => first("refresh"), retry: () => first("load"), loadMore };
}
