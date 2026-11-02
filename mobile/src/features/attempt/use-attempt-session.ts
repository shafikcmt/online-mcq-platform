import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { fetchAttempt } from "./api";
import { takeHandoff } from "./handoff";
import { AttemptSession, type SessionState } from "./session";

const none = () => () => {};
const nothing = () => null;

/** Opens the attempt (the start response handed over, or a fresh resume from the server),
 * drives its one-second clock and re-checks when the app comes back to the foreground. */
export function useAttemptSession(id: string) {
  const [session, setSession] = useState<AttemptSession | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let opened: AttemptSession | null = null;
    (async () => {
      try {
        const room = takeHandoff(id) ?? (await fetchAttempt(id));
        opened = await AttemptSession.open(room);
        if (cancelled) opened.dispose();
        else {
          setError(null);
          setSession(opened);
        }
      } catch (failure) {
        if (!cancelled) setError(failure);
      }
    })();
    return () => {
      cancelled = true;
      opened?.dispose();
    };
  }, [id, tries]);

  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => session.tick(), 1000);
    const foreground = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        session.tick();
        void session.flush();
      }
    });
    return () => {
      clearInterval(timer);
      foreground.remove();
    };
  }, [session]);

  const state: SessionState | null = useSyncExternalStore(session?.subscribe ?? none, session?.getState ?? nothing);
  return { session, state, error, retry: () => setTries((n) => n + 1) };
}
