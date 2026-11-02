import { useEffect, useState } from "react";

import { serverNow } from "./server-clock";

/** Server time, re-read every `everyMs` so countdowns on screen stay current, and at once
 * whenever `syncedAt` changes (pass the `server_time` of the data on screen: a new
 * response may have moved the measured clock offset). */
export function useServerNow(syncedAt?: string, everyMs = 30_000): number {
  const [clock, setClock] = useState(() => ({ now: serverNow(), syncedAt }));
  if (clock.syncedAt !== syncedAt) setClock({ now: serverNow(), syncedAt }); // new data: re-read now
  useEffect(() => {
    const timer = setInterval(() => setClock((prev) => ({ ...prev, now: serverNow() })), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return clock.now;
}
