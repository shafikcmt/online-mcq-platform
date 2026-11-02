import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { renderRouter } from "expo-router/testing-library";

import { setAccessToken } from "@/auth/token-store";
import type { Dashboard } from "@/features/dashboard/types";
import { resetServerClock } from "@/lib/server-clock";

/** A fake backend for `fetch`: handlers keyed by "METHOD /path" (path after /api/v1).
 * Every call is recorded with its headers and parsed body. */
export type Call = { method: string; path: string; query: Record<string, string>; body: unknown; headers: Record<string, string> };
type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | "network";
type Handler = Reply | ((call: Call) => Reply);

export function mockBackend(routes: Record<string, Handler | Handler[]>) {
  const calls: Call[] = [];
  // Home loads the dashboard after every sign-in; an empty one unless the test says otherwise.
  const all = {
    "GET /me/dashboard/": { status: 200, body: emptyDashboard() },
    // Home's category grid (hidden while empty).
    "GET /public/categories/": { status: 200, body: { count: 0, next: null, previous: null, results: [] } },
    ...routes,
  };
  const queues = new Map(Object.entries(all).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]));
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const method = init?.method ?? "GET";
    const call: Call = {
      method,
      path,
      query: Object.fromEntries(url.searchParams),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init?.headers as Record<string, string>) ?? {},
    };
    calls.push(call);
    const entry = queues.get(`${method} ${path}`);
    let handler: Handler | undefined;
    if (Array.isArray(entry)) handler = entry.length > 1 ? entry.shift() : entry[0];
    else handler = entry;
    if (!handler) throw new Error(`Unexpected request ${method} ${path}`);
    const reply = typeof handler === "function" ? handler(call) : handler;
    if (reply === "network") throw new TypeError("Network request failed");
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "Content-Type": "application/json", ...reply.headers },
    });
  }) as unknown as typeof fetch;
  return {
    calls,
    find: (method: string, path: string) => calls.filter((call) => call.method === method && call.path === path),
  };
}

export function apiError(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return { status, body: { error: { code, message, details: {}, field_errors: {}, ...extra } } };
}

export const STUDENT = {
  id: 7,
  mobile_number: "+8801712345678",
  full_name: "Rahim Uddin",
  email: null,
  preferred_language: "en" as const,
  display_name: "",
  is_mobile_verified: true,
  date_joined: "2026-10-01T09:00:00Z",
};

export const secureStore = (SecureStore as unknown as { __store: Map<string, string> }).__store;

/** Fresh phone: no language chosen, no tokens. */
export async function resetDevice({ language, refresh }: { language?: "bn" | "en"; refresh?: string } = {}) {
  await AsyncStorage.clear();
  secureStore.clear();
  setAccessToken(null);
  resetServerClock();
  if (language) await AsyncStorage.setItem("mcq.language", language);
  if (refresh) secureStore.set("mcq.refresh_token", refresh);
}

export function renderApp(initialUrl = "/") {
  return renderRouter("./src/app", { initialUrl });
}

/** A dashboard with nothing in it: no exams, package, results or notifications. */
export function emptyDashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  const none = { count: 0, items: [] };
  return {
    server_time: new Date().toISOString(),
    exams: { available: none, upcoming: none, practice: none },
    subscription: { active_count: 0, items: [] },
    results: none,
    notifications: { unread_count: 0 },
    ...overrides,
  };
}
