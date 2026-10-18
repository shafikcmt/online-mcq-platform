import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { middleware } from "@/middleware";

describe("middleware", () => {
  it("sends visitors without a session to sign-in, keeping the target", () => {
    const response = middleware(new NextRequest("http://admin.test/dashboard?x=1"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://admin.test/login?next=%2Fdashboard%3Fx%3D1");
  });

  it("lets requests with a session cookie through (the backend still decides)", () => {
    const request = new NextRequest("http://admin.test/dashboard", { headers: { cookie: "sessionid=abc" } });
    expect(middleware(request).headers.get("location")).toBeNull();
  });
});
