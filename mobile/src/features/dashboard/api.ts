import { api } from "@/api/client";
import { syncServerClock } from "@/lib/server-clock";

import type { Dashboard } from "./types";

/** The Home screen in one call. Also re-reads the server's clock: every time shown
 * ("ends in 2 h") is counted from server time, not the phone's. */
export async function fetchDashboard(): Promise<Dashboard> {
  const data = await api<Dashboard>("/me/dashboard/");
  syncServerClock(data.server_time);
  return data;
}
