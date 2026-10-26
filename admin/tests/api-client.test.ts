import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch, apiRequest } from "@/lib/api/client";

afterEach(() => {
  document.cookie = "csrftoken=; Max-Age=0; path=/";
  document.documentElement.lang = "";
});

describe("apiFetch", () => {
  it("sends the CSRF cookie value on unsafe requests and none on reads", async () => {
    document.cookie = "csrftoken=abc123; path=/";
    document.documentElement.lang = "bn";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await apiFetch("/admin/auth/logout/", { method: "POST" });
    await apiFetch("/admin/dashboard/").catch(() => undefined);
    const [url, post] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/admin/auth/logout/");
    const headers = post?.headers as Record<string, string>;
    expect(headers["X-CSRFToken"]).toBe("abc123");
    expect(headers["Accept-Language"]).toBe("bn");
    expect(post?.credentials).toBe("same-origin");
    expect((fetchMock.mock.calls[1][1]?.headers as Record<string, string>)["X-CSRFToken"]).toBeUndefined();
  });

  it("adds extra headers without replacing its own, and apiRequest returns status and headers", async () => {
    document.cookie = "csrftoken=abc123; path=/";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: 1 }), {
        status: 201,
        headers: { "Content-Type": "application/json", "Idempotent-Replayed": "true" },
      }),
    );
    const response = await apiRequest<{ id: number }>("/admin/subscriptions/grant/", {
      method: "POST",
      body: {},
      headers: { "Idempotency-Key": "k-1", "X-CSRFToken": "forged" },
    });
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("k-1");
    expect(headers["X-CSRFToken"]).toBe("abc123"); // the panel's own header wins
    expect(response.status).toBe(201);
    expect(response.data).toEqual({ id: 1 });
    expect(response.headers.get("Idempotent-Replayed")).toBe("true");
  });

  it("keeps extra headers on the one CSRF retry", async () => {
    document.cookie = "csrftoken=stale; path=/";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "permission_denied", message: "CSRF Failed: CSRF token incorrect." } }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockImplementationOnce(async () => {
        document.cookie = "csrftoken=fresh; path=/";
        return new Response(null, { status: 204 });
      })
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await apiFetch("/admin/subscriptions/grant/", { method: "POST", body: {}, headers: { "Idempotency-Key": "same" } });
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(2);
    for (const [, init] of posts) expect((init?.headers as Record<string, string>)["Idempotency-Key"]).toBe("same");
  });

  it("turns a connection failure into network_error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(apiFetch("/admin/dashboard/")).rejects.toMatchObject({ status: 0, code: "network_error" });
  });

  it("turns a hung request into timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
        ),
    );
    await expect(apiFetch("/admin/dashboard/", { timeoutMs: 20 })).rejects.toMatchObject({ code: "timeout" });
  });

  it("turns an HTML 500 from a proxy into server_error without its text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<!DOCTYPE html><title>Internal Server Error</title>", {
        status: 500,
        headers: { "Content-Type": "text/html" },
      }),
    );
    const error = (await apiFetch("/admin/dashboard/").catch((e: unknown) => e)) as { message: string };
    expect(error).toMatchObject({ status: 500, code: "server_error", fromServer: false });
    expect(String(error.message)).not.toContain("DOCTYPE");
  });

  it("surfaces 401 as an ApiError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "not_authenticated", message: "Sign in." } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(apiFetch("/admin/auth/me/")).rejects.toMatchObject({ status: 401, isUnauthenticated: true });
  });
});
