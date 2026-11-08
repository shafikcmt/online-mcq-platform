import { describe, expect, test } from "vitest";

import {
  IDEMPOTENCY_KEY,
  MAX_SESSION_SECONDS,
  RateLimiter,
  clientIp,
  gatewayCode,
  isHttpsUrl,
  isPaymentId,
  loginFailure,
  methodCode,
  methodsForPrice,
  newIdempotencyKey,
  safeNext,
  sessionSeconds,
} from "@/lib/account-helpers";

const jwt = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;

describe("isPaymentId", () => {
  test("accepts only a UUID", () => {
    expect(isPaymentId("0c0c8ba6-11f4-4f14-bbd4-61cf05103112")).toBe(true);
    for (const bad of ["", "123", "../../etc", "0c0c8ba6-11f4-4f14-bbd4-61cf0510311", undefined, 5, null]) {
      expect(isPaymentId(bad)).toBe(false);
    }
  });
});

describe("safeNext", () => {
  const fallback = "/bn/account/buy";
  test("keeps a path inside the site under the visitor's language", () => {
    expect(safeNext("/bn/account/buy", "bn", fallback)).toBe("/bn/account/buy");
    expect(safeNext("/en/payment-return?payment=abc", "en", fallback)).toBe("/en/payment-return?payment=abc");
    expect(safeNext("/bn", "bn", fallback)).toBe("/bn");
  });
  test("refuses anything that could leave the site or switch to another path", () => {
    for (const bad of [
      "https://evil.example/bn/x",
      "//evil.example",
      "/bn//evil.example",
      "/en/account/buy", // another language than the visitor's
      "/bn/../admin",
      "/bn/%2e%2e/admin",
      "/bn/./x",
      "/bnx/account",
      "/bn/a\\b",
      "/bn/a\nb",
      "javascript:alert(1)",
      "",
      undefined,
      42,
    ]) {
      expect(safeNext(bad, "bn", fallback), String(bad)).toBe(fallback);
    }
  });
});

describe("isHttpsUrl", () => {
  test("only an https address without credentials", () => {
    expect(isHttpsUrl("https://sandbox.sslcommerz.com/gwprocess/v4/gw.php?x=1")).toBe(true);
    for (const bad of ["http://pay.example/", "javascript:alert(1)", "https://user:pw@pay.example/", "not a url", "", null, undefined]) {
      expect(isHttpsUrl(bad), String(bad)).toBe(false);
    }
  });
});

describe("isHttpsUrl in development", () => {
  test("plain http is accepted only for this computer, and only when asked", () => {
    expect(isHttpsUrl("http://127.0.0.1:8000/pay", true)).toBe(true);
    expect(isHttpsUrl("http://localhost:8000/pay", true)).toBe(true);
    expect(isHttpsUrl("http://127.0.0.1:8000/pay")).toBe(false);
    expect(isHttpsUrl("http://pay.example/", true)).toBe(false);
    expect(isHttpsUrl("http://127.0.0.1.evil.example/", true)).toBe(false);
  });
});

describe("sessionSeconds", () => {
  const now = 1_800_000_000_000;
  test("lasts as long as the token, with a small margin", () => {
    expect(sessionSeconds(jwt({ exp: now / 1000 + 900 }), now)).toBe(890);
  });
  test("never longer than the cap; 0 when already expired", () => {
    expect(sessionSeconds(jwt({ exp: now / 1000 + 10 * 24 * 3600 }), now)).toBe(MAX_SESSION_SECONDS);
    expect(sessionSeconds(jwt({ exp: now / 1000 - 5 }), now)).toBe(0);
    expect(sessionSeconds(jwt({ exp: now / 1000 + 5 }), now)).toBe(0);
  });
  test("a token without a readable expiry gets a short default", () => {
    expect(sessionSeconds("garbage", now)).toBe(600);
    expect(sessionSeconds(jwt({}), now)).toBe(600);
  });
});

describe("clientIp", () => {
  const headers = (value: string | null) => ({ get: () => value });
  test("takes the last entry (the one the website's nginx added)", () => {
    expect(clientIp(headers("6.6.6.6, 203.0.113.9"))).toBe("203.0.113.9");
    expect(clientIp(headers("203.0.113.9"))).toBe("203.0.113.9");
  });
  test("unknown when there is no header", () => {
    expect(clientIp(headers(null))).toBe("unknown");
    expect(clientIp(headers(" , "))).toBe("unknown");
  });
});

describe("RateLimiter", () => {
  test("allows the limit, then refuses until the window passes", () => {
    const limiter = new RateLimiter(3, 1000);
    expect([0, 1, 2].map((i) => limiter.allow("a", i))).toEqual([true, true, true]);
    expect(limiter.allow("a", 10)).toBe(false);
    expect(limiter.allow("b", 10)).toBe(true); // another visitor is unaffected
    expect(limiter.allow("a", 1001)).toBe(true); // the oldest hit left the window
  });
});

describe("loginFailure and idempotency keys", () => {
  test("maps the API status to the sign-in message", () => {
    expect(loginFailure(401)).toBe("invalid");
    expect(loginFailure(429)).toBe("tooMany");
    expect(loginFailure(400)).toBe("check");
    expect(loginFailure(0)).toBe("unavailable");
    expect(loginFailure(503)).toBe("unavailable");
  });
  test("a generated key is one the API accepts", () => {
    const key = newIdempotencyKey("0123456789abcdef", 1_800_000_000_000);
    expect(key).toMatch(IDEMPOTENCY_KEY);
    expect(key.startsWith("web-")).toBe(true);
    expect(key.length).toBeLessThanOrEqual(64);
  });
});

describe("methodCode", () => {
  test("keeps a plain lowercase code and drops anything else", () => {
    expect(methodCode("bkash")).toBe("bkash");
    expect(methodCode("sslcommerz")).toBe("sslcommerz");
    for (const bad of ["", "BKASH", "bkash nagad", "bkash;", "../x", "a".repeat(21), null, undefined, 5]) {
      expect(methodCode(bad), String(bad)).toBe("");
    }
  });
});

describe("gatewayCode", () => {
  test("keeps a gateway identifier and drops anything else", () => {
    expect(gatewayCode("bkash-main")).toBe("bkash-main");
    expect(gatewayCode("sslcommerz")).toBe("sslcommerz");
    for (const bad of ["", "a", "-x", "BKASH", "bkash main", "bkash_main", "../x", "a".repeat(41), null, undefined, 5]) {
      expect(gatewayCode(bad), String(bad)).toBe("");
    }
  });
});

describe("methodsForPrice", () => {
  const method = (gateway: string, min: string | null, max: string | null) => ({ gateway, min_amount: min, max_amount: max });
  const all = [method("a", null, null), method("b", "100.00", null), method("c", null, "300.00"), method("d", "100.00", "300.00")];

  test("hides the methods whose limits the price does not fit", () => {
    expect(methodsForPrice(all, "50.00").map((m) => m.gateway)).toEqual(["a", "c"]);
    expect(methodsForPrice(all, "200.00").map((m) => m.gateway)).toEqual(["a", "b", "c", "d"]);
    expect(methodsForPrice(all, "500.00").map((m) => m.gateway)).toEqual(["a", "b"]);
  });

  test("the limits themselves are allowed", () => {
    expect(methodsForPrice(all, "100.00").map((m) => m.gateway)).toEqual(["a", "b", "c", "d"]);
    expect(methodsForPrice(all, "300.00").map((m) => m.gateway)).toEqual(["a", "b", "c", "d"]);
  });

  test("an unreadable price hides nothing (the server decides)", () => {
    expect(methodsForPrice(all, "abc")).toHaveLength(4);
  });
});
