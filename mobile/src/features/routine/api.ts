import { API_BASE_URL, api } from "@/api/client";

import type { RoutineResponse } from "./types";

export function fetchRoutine() {
  return api<RoutineResponse>("/public/routine/", { auth: false });
}

/** Where the routine PDF is served (the API itself; never a file path). */
export const ROUTINE_PDF_URL = `${API_BASE_URL}/public/routine/pdf/`;
