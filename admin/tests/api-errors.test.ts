import { describe, expect, it } from "vitest";

import { ApiError, describeError, networkError, timeoutError, toApiError } from "@/lib/api/errors";
import { en, translate } from "@/lib/i18n/messages";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const t = (key: Parameters<typeof describeError>[1] extends (k: infer K) => string ? K : never) =>
  translate(en, key);

describe("toApiError", () => {
  it("reads the backend's standard error shape", async () => {
    const error = await toApiError(
      json(400, { error: { code: "validation_error", message: "Fix the errors.", field_errors: { slug: ["Taken."] } } }),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("validation_error");
    expect(error.fieldErrors).toEqual({ slug: ["Taken."] });
    expect(error.fromServer).toBe(true);
  });

  it("never surfaces an HTML error page (e.g. a proxy's 500)", async () => {
    const html = new Response("<html><body><h1>Internal Server Error</h1><pre>Traceback…</pre></body></html>", {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
    const error = await toApiError(html);
    expect(error.code).toBe("server_error");
    expect(error.fromServer).toBe(false);
    expect(error.message).not.toMatch(/html|Traceback/i);
    expect(describeError(error, t)).toBe(en["error.server"]);
  });

  it("treats JSON that is not our error shape, and empty bodies, as generic", async () => {
    expect((await toApiError(json(502, { detail: "<b>bad gateway</b>" }))).code).toBe("server_error");
    expect((await toApiError(new Response(null, { status: 404 }))).code).toBe("http_404");
    expect(describeError(await toApiError(new Response(null, { status: 404 })), t)).toBe(en["error.generic"]);
  });

  it("describes network, timeout, 401, 403 and 429 with translated text", async () => {
    expect(describeError(networkError(), t)).toBe(en["error.network"]);
    expect(describeError(timeoutError(), t)).toBe(en["error.timeout"]);
    expect(describeError(await toApiError(new Response("", { status: 401 })), t)).toBe(en["error.unauthenticated"]);
    expect(describeError(await toApiError(new Response("", { status: 403 })), t)).toBe(en["error.forbidden"]);
    expect(describeError(await toApiError(new Response("", { status: 429 })), t)).toBe(en["error.rateLimited"]);
    expect(describeError(new Error("boom"), t)).toBe(en["error.generic"]);
  });

  it("keeps the backend's own localized message", async () => {
    const error = await toApiError(json(401, { error: { code: "invalid_credentials", message: "মোবাইল নম্বর বা পাসওয়ার্ড ভুল।" } }));
    expect(describeError(error, t)).toBe("মোবাইল নম্বর বা পাসওয়ার্ড ভুল।");
  });
});
