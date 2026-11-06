"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Asks the server for the page again every few seconds for a while (the payment is
 * confirmed by the server, which can take a moment). Shows nothing. */
export function AutoRefresh({ everyMs = 4000, forMs = 120_000 }: { everyMs?: number; forMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started >= forMs) window.clearInterval(timer);
      else router.refresh();
    }, everyMs);
    return () => window.clearInterval(timer);
  }, [router, everyMs, forMs]);
  return null;
}
