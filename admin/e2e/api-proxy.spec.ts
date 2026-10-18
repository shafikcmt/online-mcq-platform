import { expect, test } from "@playwright/test";

/** The same-origin /api proxy must keep Django's contract intact: trailing slashes, query
 * strings, methods/bodies, CSRF cookie + header, and JSON errors (never Next.js HTML). */
const MOBILE = process.env.E2E_ADMIN_MOBILE ?? "";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";

test("anonymous API calls get the backend's JSON 401", async ({ request }) => {
  const response = await request.get("/api/v1/admin/auth/me/", { maxRedirects: 0 });
  expect(response.status()).toBe(401);
  expect(response.headers()["content-type"]).toContain("application/json");
  expect((await response.json()).error.code).toBeTruthy();
});

test("CSRF cookie, trailing slash, query string, POST body and JSON errors survive the proxy", async ({ request }) => {
  test.skip(!MOBILE || !PASSWORD, "Set E2E_ADMIN_MOBILE and E2E_ADMIN_PASSWORD");
  const csrf = await request.get("/api/v1/admin/auth/csrf/", { maxRedirects: 0 });
  expect(csrf.status()).toBe(204);
  const token = (await request.storageState()).cookies.find((c) => c.name === "csrftoken")?.value;
  expect(token).toBeTruthy();

  // No CSRF header → the backend refuses (403 JSON), it is not silently accepted.
  const refused = await request.post("/api/v1/admin/auth/login/", {
    data: { mobile_number: MOBILE, password: PASSWORD },
    maxRedirects: 0,
  });
  expect(refused.status()).toBe(403);
  expect(refused.headers()["content-type"]).toContain("application/json");

  const login = await request.post("/api/v1/admin/auth/login/", {
    data: { mobile_number: MOBILE, password: PASSWORD },
    headers: { "X-CSRFToken": token! },
    maxRedirects: 0,
  });
  expect(login.status()).toBe(200);
  const session = (await request.storageState()).cookies.find((c) => c.name === "sessionid");
  expect(session?.httpOnly).toBe(true);

  // Query string reaches Django: an invalid filter value comes back as a field error.
  const filtered = await request.get("/api/v1/admin/results/?exam=not-a-number", { maxRedirects: 0 });
  expect(filtered.status()).toBe(400);
  expect((await filtered.json()).error.field_errors.exam).toBeTruthy();

  const dashboard = await request.get("/api/v1/admin/dashboard/?x=1", { maxRedirects: 0 });
  expect(dashboard.status()).toBe(200);
  expect((await dashboard.json()).period.time_zone).toBe("Asia/Dhaka");

  const newToken = (await request.storageState()).cookies.find((c) => c.name === "csrftoken")?.value;
  const logout = await request.post("/api/v1/admin/auth/logout/", { headers: { "X-CSRFToken": newToken! }, maxRedirects: 0 });
  expect(logout.status()).toBe(204);
  expect((await request.get("/api/v1/admin/auth/me/")).status()).toBe(401);
});
