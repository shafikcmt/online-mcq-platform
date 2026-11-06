import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => {
  class Redirect extends Error {
    constructor(public url: string) {
      super(url);
    }
  }
  return {
    Redirect,
    cookies: new Map<string, string>(),
    cookieWrites: [] as { name: string; value: string; options: Record<string, unknown> }[],
    forwardedFor: "203.0.113.1",
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.cookies.has(name) ? { name, value: state.cookies.get(name) } : undefined),
    set: (name: string, value: string, options: Record<string, unknown>) => {
      state.cookies.set(name, value);
      state.cookieWrites.push({ name, value, options });
    },
    delete: (name: string) => state.cookies.delete(name),
  }),
  headers: async () => new Headers({ "x-forwarded-for": state.forwardedFor }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new state.Redirect(url);
  },
}));

import { signIn, signOut, startCheckout } from "@/app/[lang]/account/actions";
import { SESSION_COOKIE, getPayment, getToken, listPackages, login, setSession, startPayment } from "@/lib/account";

const PAYMENT_ID = "0c0c8ba6-11f4-4f14-bbd4-61cf05103112";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const token = (lifetime = 900) => `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + lifetime })).toString("base64url")}.s`;

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof state.Redirect) return error.url;
    throw error;
  }
  throw new Error("expected a redirect");
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  state.cookies.clear();
  state.cookieWrites.length = 0;
  state.forwardedFor = `203.0.113.${Math.floor(Math.random() * 200) + 1}`; // a fresh visitor each test
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("API client", () => {
  test("login posts the credentials as JSON, without an Authorization header", async () => {
    fetchMock.mockResolvedValue(json(200, { access: "a", refresh: "r", user: {} }));
    const result = await login("01712345678", "secret-pw", "bn");
    expect(result).toEqual({ ok: true, data: { access: "a", refresh: "r", user: {} } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/auth\/login\/$/);
    expect(JSON.parse(String(init.body))).toEqual({ mobile_number: "01712345678", password: "secret-pw" });
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(init.redirect).toBe("manual");
    expect(init.cache).toBe("no-store");
  });

  test("an API error becomes its stable code; a proxy page or a dead network never leaks text", async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: { code: "invalid_credentials", message: "x" } }));
    expect(await login("1", "2", "en")).toEqual({ ok: false, status: 401, code: "invalid_credentials" });
    fetchMock.mockResolvedValueOnce(new Response("<html>Bad gateway</html>", { status: 502 }));
    expect(await login("1", "2", "en")).toEqual({ ok: false, status: 502, code: "http_502" });
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await login("1", "2", "en")).toEqual({ ok: false, status: 0, code: "network_error" });
  });

  test("authenticated calls send the bearer token; the checkout carries the idempotency key", async () => {
    fetchMock.mockResolvedValue(json(201, { payment_id: PAYMENT_ID, status: "pending", package: { slug: "p", name: "P" }, checkout_url: null }));
    await startPayment("tok", 7, "web-key-1", "en");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/payments\/$/);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["Idempotency-Key"]).toBe("web-key-1");
    expect(JSON.parse(String(init.body))).toEqual({ package_id: 7 }); // only the package: the price is the server's
    fetchMock.mockResolvedValue(json(200, { count: 0, results: [] }));
    await listPackages("tok", "bn");
    await getPayment("tok", PAYMENT_ID, "bn");
    expect((fetchMock.mock.calls[2] as [string])[0]).toMatch(new RegExp(`/api/v1/payments/${PAYMENT_ID}/$`));
  });
});

describe("session cookie", () => {
  test("is HttpOnly, SameSite=Lax, site-wide, and never outlives the token", async () => {
    expect(await setSession(token(900))).toBe(true);
    const write = state.cookieWrites[0];
    expect(write.name).toBe(SESSION_COOKIE);
    expect(write.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(write.options.maxAge).toBeGreaterThan(0);
    expect(write.options.maxAge as number).toBeLessThanOrEqual(900);
    expect(await getToken()).toBe(write.value);
  });
  test("an already expired token is not stored", async () => {
    expect(await setSession(token(-60))).toBe(false);
    expect(state.cookieWrites).toHaveLength(0);
    expect(await getToken()).toBeNull();
  });
});

describe("signIn", () => {
  const fields = { lang: "bn", mobile_number: "01712345678", password: "secret-pw" };

  test("a wrong password shows the message and stores nothing", async () => {
    fetchMock.mockResolvedValue(json(401, { error: { code: "invalid_credentials", message: "x" } }));
    expect(await signIn({ error: null }, formData(fields))).toEqual({ error: "invalid" });
    expect(state.cookieWrites).toHaveLength(0);
  });

  test("empty fields never reach the API", async () => {
    expect(await signIn({ error: null }, formData({ ...fields, password: "" }))).toEqual({ error: "check" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("success stores the session and goes to the page the student came from", async () => {
    fetchMock.mockResolvedValue(json(200, { access: token(), refresh: "r" }));
    const target = await redirectOf(() => signIn({ error: null }, formData({ ...fields, next: "/bn/account/buy?notice=failed" })));
    expect(target).toBe("/bn/account/buy?notice=failed");
    expect(state.cookies.has(SESSION_COOKIE)).toBe(true);
    expect([...state.cookies.keys()]).toEqual([SESSION_COOKIE]); // no refresh token is kept on the website
  });

  test("a 'next' pointing outside the site is ignored", async () => {
    fetchMock.mockResolvedValue(json(200, { access: token(), refresh: "r" }));
    expect(await redirectOf(() => signIn({ error: null }, formData({ ...fields, next: "https://evil.example/" })))).toBe("/bn/account/buy");
  });

  test("one visitor cannot spend the shared sign-in budget", async () => {
    fetchMock.mockResolvedValue(json(401, { error: { code: "invalid_credentials", message: "x" } }));
    const results = [];
    for (let i = 0; i < 22; i += 1) results.push((await signIn({ error: null }, formData(fields))).error);
    expect(results.slice(0, 20).every((error) => error === "invalid")).toBe(true);
    expect(results.slice(20)).toEqual(["tooMany", "tooMany"]);
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });
});

describe("startCheckout", () => {
  const pay = (extra: Record<string, string> = {}) => formData({ lang: "en", package_id: "5", idempotency_key: "web-abc-123", ...extra });
  const paymentBody = (checkout_url: string | null) => ({ payment_id: PAYMENT_ID, status: "pending", package: { slug: "p", name: "P" }, checkout_url });

  test("not signed in → sign-in page, then back to the package list", async () => {
    expect(await redirectOf(() => startCheckout(pay()))).toBe("/en/account/login?next=%2Fen%2Faccount%2Fbuy");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("sends the student to the provider's https page", async () => {
    state.cookies.set(SESSION_COOKIE, "tok");
    fetchMock.mockResolvedValue(json(201, paymentBody("https://sandbox.sslcommerz.com/gw/abc")));
    expect(await redirectOf(() => startCheckout(pay()))).toBe("https://sandbox.sslcommerz.com/gw/abc");
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers).toMatchObject({ "Idempotency-Key": "web-abc-123" });
  });

  test("never opens a non-https checkout address", async () => {
    state.cookies.set(SESSION_COOKIE, "tok");
    fetchMock.mockResolvedValue(json(201, paymentBody("http://pay.example/gw")));
    expect(await redirectOf(() => startCheckout(pay()))).toBe(`/en/payment-return?payment=${PAYMENT_ID}`);
  });

  test("payments switched off → a clear notice; an expired session → sign in again", async () => {
    state.cookies.set(SESSION_COOKIE, "tok");
    fetchMock.mockResolvedValueOnce(json(503, { error: { code: "payment_unavailable", message: "x" } }));
    expect(await redirectOf(() => startCheckout(pay()))).toBe("/en/account/buy?notice=unavailable");
    fetchMock.mockResolvedValueOnce(json(401, { error: { code: "not_authenticated", message: "x" } }));
    expect(await redirectOf(() => startCheckout(pay()))).toBe("/en/account/login?next=%2Fen%2Faccount%2Fbuy&expired=1");
    fetchMock.mockResolvedValueOnce(json(400, { error: { code: "validation_error", message: "x" } }));
    expect(await redirectOf(() => startCheckout(pay()))).toBe("/en/account/buy?notice=failed");
  });

  test("a bad package id never reaches the API", async () => {
    state.cookies.set(SESSION_COOKIE, "tok");
    for (const bad of ["", "abc", "-3", "0", "1.5"]) {
      expect(await redirectOf(() => startCheckout(pay({ package_id: bad })))).toBe("/en/account/buy?notice=failed");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("the chosen payment method is sent to the API; without one nothing extra is sent", async () => {
    state.cookies.set(SESSION_COOKIE, "tok");
    fetchMock.mockResolvedValue(json(201, paymentBody("https://pay.example/gw")));
    await redirectOf(() => startCheckout(pay({ provider: "bkash" })));
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ package_id: 5, provider: "bkash" });
    await redirectOf(() => startCheckout(pay()));
    expect(JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body))).toEqual({ package_id: 5 });
  });

  test("a malformed method code is dropped before it reaches the API", async () => {
    state.cookies.set(SESSION_COOKIE, "tok");
    fetchMock.mockResolvedValue(json(201, paymentBody("https://pay.example/gw")));
    for (const bad of ["BKASH", "bkash; drop", "../x", "a".repeat(40)]) {
      await redirectOf(() => startCheckout(pay({ provider: bad })));
    }
    for (const call of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(JSON.parse(String(call[1].body))).toEqual({ package_id: 5 });
    }
  });

  test("a bad idempotency key is replaced by a valid one", async () => {
    state.cookies.set(SESSION_COOKIE, "tok");
    fetchMock.mockResolvedValue(json(201, paymentBody("https://pay.example/gw")));
    await redirectOf(() => startCheckout(pay({ idempotency_key: "bad key with spaces!" })));
    const key = ((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>)["Idempotency-Key"];
    expect(key).toMatch(/^[A-Za-z0-9._:-]{1,64}$/);
  });
});

describe("signOut", () => {
  test("clears the cookie and goes home in the same language", async () => {
    state.cookies.set(SESSION_COOKIE, "tok");
    expect(await redirectOf(() => signOut(formData({ lang: "en" })))).toBe("/en");
    expect(state.cookies.has(SESSION_COOKIE)).toBe(false);
  });
});
