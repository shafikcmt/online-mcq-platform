import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadConfig(nodeEnv: string) {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.resetModules();
  return (await import("../next.config")).default;
}

describe("API routing config", () => {
  it("development proxies /api/* and keeps Django's trailing slash (slash rule first)", async () => {
    const config = await loadConfig("development");
    const rules = (await config.rewrites!()) as { source: string; destination: string }[];
    expect(rules.map((r) => r.source)).toEqual(["/api/:path*/", "/api/:path*"]);
    expect(rules[0].destination).toMatch(/\/api\/:path\*\/$/);
    expect(config.skipTrailingSlashRedirect).toBe(true);
  });

  it("production has NO /api rewrite — nginx routes /api/* to Django", async () => {
    const config = await loadConfig("production");
    expect(await config.rewrites!()).toEqual([]);
  });

  it("sends security headers on every page", async () => {
    const config = await loadConfig("production");
    const keys = (await config.headers!())[0].headers.map((h) => h.key);
    expect(keys).toEqual(expect.arrayContaining(["X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy"]));
  });
});
