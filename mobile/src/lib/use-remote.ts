import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";

type State<T> = { data: T | null; error: unknown; loading: boolean; refreshing: boolean };

/** Loads a screen's data when the screen comes into view (again on every return, quietly,
 * so the language and status stay current) and on pull-to-refresh. Keeps the last good
 * data when a later reload fails, so a short connection drop never blanks the screen.
 * `load` must be stable (a module-level function). */
export function useRemote<T>(load: () => Promise<T>) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: true, refreshing: false });
  const latest = useRef(0);

  const run = useCallback(
    async (mode: "load" | "refresh" | "quiet") => {
      const id = (latest.current += 1);
      setState((prev) => ({
        ...prev,
        loading: mode === "load" && prev.data === null,
        refreshing: mode === "refresh",
        error: mode === "quiet" ? prev.error : null,
      }));
      try {
        const data = await load();
        if (id === latest.current) setState({ data, error: null, loading: false, refreshing: false });
      } catch (error) {
        if (id === latest.current) setState((prev) => ({ ...prev, error, loading: false, refreshing: false }));
      }
    },
    [load],
  );

  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      void run(first.current ? "load" : "quiet");
      first.current = false;
    }, [run]),
  );

  return {
    ...state,
    refresh: () => run("refresh"),
    retry: () => run("load"),
  };
}
