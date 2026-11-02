import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { fetchPayment } from "./api";
import type { Payment } from "./types";

export const POLL_MS = 3_000;
export const POLL_FOR_MS = 120_000;

/** The payment as the server knows it. While it is `pending`, asks again every few
 * seconds for up to two minutes (the server verifies with the provider on the return and
 * on its notification), and whenever the app comes back to the foreground. After that the
 * student can ask again by hand ("still confirming"). */
export function usePaymentStatus(id: string) {
  const [payment, setPayment] = useState<Payment | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [polling, setPolling] = useState(true);
  const [round, setRound] = useState(0);
  const started = useRef(0);

  const check = useCallback(async () => {
    try {
      const next = await fetchPayment(id);
      setPayment(next);
      setError(null);
      return next;
    } catch (failure) {
      setError(failure);
      return null;
    }
  }, [id]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    started.current = Date.now();
    const run = async () => {
      const next = await check();
      if (stopped) return;
      if (next && next.status !== "pending") {
        setPolling(false);
        return;
      }
      if (Date.now() - started.current >= POLL_FOR_MS) {
        setPolling(false);
        return;
      }
      timer = setTimeout(run, POLL_MS);
    };
    void run();
    const foreground = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      foreground.remove();
    };
  }, [check, round]);

  const checkAgain = () => {
    setPolling(true);
    setRound((n) => n + 1);
  };
  return { payment, error, polling, checkAgain };
}
