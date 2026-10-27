import { expect, request, type APIRequestContext } from "@playwright/test";

/** The disposable backend itself (the site reads it on the server; tests prepare data
 * there through the Admin API, as an admin would in the Admin Panel). */
export const DJANGO = `http://127.0.0.1:${process.env.E2E_DJANGO_PORT ?? "8000"}`;

export type Admin = { api: APIRequestContext; post: (path: string, data?: object) => Promise<unknown>; get: (path: string) => Promise<unknown> };

async function csrf(api: APIRequestContext): Promise<string> {
  const cookie = (await api.storageState()).cookies.find((c) => c.name === "csrftoken");
  expect(cookie, "csrftoken cookie").toBeTruthy();
  return cookie!.value;
}

/** An Admin API session (session cookie + CSRF), signed in as the E2E admin. */
export async function adminSession(): Promise<Admin> {
  const api = await request.newContext({ baseURL: DJANGO });
  await api.get("/api/v1/admin/auth/csrf/");
  const login = await api.post("/api/v1/admin/auth/login/", {
    data: { mobile_number: process.env.E2E_ADMIN_MOBILE, password: process.env.E2E_ADMIN_PASSWORD },
    headers: { "X-CSRFToken": await csrf(api) },
  });
  expect(login.ok(), `admin login: ${login.status()}`).toBeTruthy();
  async function check(response: Awaited<ReturnType<APIRequestContext["get"]>>, path: string) {
    expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBeTruthy();
    return response.status() === 204 ? null : response.json();
  }
  return {
    api,
    get: async (path) => check(await api.get(`/api/v1${path}`), path),
    post: async (path, data = {}) => check(await api.post(`/api/v1${path}`, { data, headers: { "X-CSRFToken": await csrf(api) } }), path),
  };
}
