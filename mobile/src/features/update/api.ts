import { api } from "@/api/client";

import type { AppUpdate } from "./types";

export function fetchAppUpdate(version: string): Promise<AppUpdate> {
  return api<AppUpdate>(`/public/app-update/?version=${encodeURIComponent(version)}`, { auth: false });
}
