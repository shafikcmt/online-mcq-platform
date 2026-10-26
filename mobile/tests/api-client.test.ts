import { api, refreshTokens, setApiLanguage, setSessionExpiredHandler } from "@/api/client";
import { ApiError } from "@/api/errors";
import { getAccessToken, saveTokens, setAccessToken } from "@/auth/token-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { apiError, mockBackend, resetDevice, secureStore } from "./helpers";

beforeEach(async () => {
  await resetDevice();
  setApiLanguage("bn");
  setSessionExpiredHandler(null);
});

test("sends the UI language and the access token; public calls send no token", async () => {
  const backend = mockBackend({ "GET /me/": { status: 200, body: { ok: 1 } }, "GET /public/faqs/": { status: 200, body: {} } });
  await saveTokens({ access: "A1", refresh: "R1" });
  setApiLanguage("en");
  await api("/me/");
  await api("/public/faqs/", { auth: false });
  expect(backend.calls[0].headers).toMatchObject({ "Accept-Language": "en", Authorization: "Bearer A1" });
  expect(backend.calls[1].headers.Authorization).toBeUndefined();
});

test("tokens: refresh token only in SecureStore, access token only in memory, nothing in AsyncStorage", async () => {
  await saveTokens({ access: "A1", refresh: "R1" });
  expect(secureStore.get("mcq.refresh_token")).toBe("R1");
  expect(getAccessToken()).toBe("A1");
  const keys = await AsyncStorage.getAllKeys();
  for (const key of keys) expect(await AsyncStorage.getItem(key)).not.toMatch(/A1|R1/);
});

test("a 401 refreshes ONCE for concurrent calls, stores the rotated pair and retries", async () => {
  const backend = mockBackend({
    "GET /me/": (call) => (call.headers.Authorization === "Bearer A2" ? { status: 200, body: { id: 1 } } : apiError(401, "token_not_valid", "")),
    "GET /me/dashboard/": (call) => (call.headers.Authorization === "Bearer A2" ? { status: 200, body: { d: 1 } } : apiError(401, "token_not_valid", "")),
    "POST /auth/token/refresh/": { status: 200, body: { access: "A2", refresh: "R2" } },
  });
  await saveTokens({ access: "expired", refresh: "R1" });
  const [me, dashboard] = await Promise.all([api("/me/"), api("/me/dashboard/")]);
  expect(me).toEqual({ id: 1 });
  expect(dashboard).toEqual({ d: 1 });
  const refreshes = backend.find("POST", "/auth/token/refresh/");
  expect(refreshes).toHaveLength(1);
  expect(refreshes[0].body).toEqual({ refresh: "R1" });
  expect(secureStore.get("mcq.refresh_token")).toBe("R2");
  expect(getAccessToken()).toBe("A2");
});

test("a refused refresh clears the tokens and reports the session as expired", async () => {
  mockBackend({
    "GET /me/": apiError(401, "token_not_valid", ""),
    "POST /auth/token/refresh/": apiError(401, "token_not_valid", "Token is invalid or expired"),
  });
  const expired = jest.fn();
  setSessionExpiredHandler(expired);
  await saveTokens({ access: "old", refresh: "R1" });
  await expect(api("/me/")).rejects.toMatchObject({ code: "session_expired", status: 401 });
  expect(expired).toHaveBeenCalledTimes(1);
  expect(secureStore.has("mcq.refresh_token")).toBe(false);
  expect(getAccessToken()).toBeNull();
});

test("no stored refresh token → refresh is false without calling the server", async () => {
  const backend = mockBackend({});
  setAccessToken(null);
  expect(await refreshTokens()).toBe(false);
  expect(backend.calls).toHaveLength(0);
});

test("a network failure during refresh keeps the stored session", async () => {
  mockBackend({ "POST /auth/token/refresh/": "network" });
  await saveTokens({ access: "old", refresh: "R1" });
  await expect(refreshTokens()).rejects.toMatchObject({ code: "network_error" });
  expect(secureStore.get("mcq.refresh_token")).toBe("R1");
});

test("errors: standard shape, Retry-After, 5xx and no answer", async () => {
  mockBackend({
    "POST /auth/otp/request/": [
      apiError(429, "otp_resend_cooldown", "Please wait before requesting a new code.", { details: { retry_after: 42 } }),
      { status: 429, body: { error: { code: "throttled", message: "Slow down", details: {}, field_errors: {} } }, headers: { "Retry-After": "17" } },
      { status: 502, body: { nope: true } },
      "network",
    ],
  });
  const first = await api("/auth/otp/request/", { method: "POST", body: {}, auth: false }).catch((error: ApiError) => error);
  expect(first).toMatchObject({ status: 429, code: "otp_resend_cooldown", retryAfter: 42, message: "Please wait before requesting a new code." });
  const second = await api("/auth/otp/request/", { method: "POST", body: {}, auth: false }).catch((error: ApiError) => error);
  expect(second).toMatchObject({ code: "throttled", retryAfter: 17 });
  const third = await api("/auth/otp/request/", { method: "POST", body: {}, auth: false }).catch((error: ApiError) => error);
  expect(third).toMatchObject({ status: 502, code: "server_error" });
  const fourth = await api("/auth/otp/request/", { method: "POST", body: {}, auth: false }).catch((error: ApiError) => error);
  expect(fourth).toMatchObject({ status: 0, code: "network_error" });
});

test("field errors are kept for the form", async () => {
  mockBackend({
    "POST /auth/register/": apiError(400, "validation_error", "Invalid input.", { field_errors: { password: ["This password is too common."] } }),
  });
  const error = await api("/auth/register/", { method: "POST", body: {}, auth: false }).catch((caught: ApiError) => caught);
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).fieldErrors).toEqual({ password: ["This password is too common."] });
});
