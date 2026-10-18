import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api/client";

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
