import { describe, expect, it } from "vitest";

import { bn, en, translate } from "@/lib/i18n/messages";

describe("translate", () => {
  it("fills values and picks the English singular or plural by count", () => {
    expect(translate(en, "dashboard.activeSubsSub", { n: "1" })).toBe("1 student with access");
    expect(translate(en, "dashboard.activeSubsSub", { n: "0" })).toBe("0 students with access");
    expect(translate(en, "dashboard.activeSubsSub", { n: "2" })).toBe("2 students with access");
    expect(translate(en, "packages.days", { n: "1,000" })).toBe("1,000 days");
    expect(translate(en, "packages.days", { n: 1 })).toBe("1 day");
  });

  it("leaves Bangla, which has no plural forms, as written", () => {
    expect(translate(bn, "dashboard.activeSubsSub", { n: "1" })).toBe(bn["dashboard.activeSubsSub"].replace("{n}", "1"));
  });

  it("no message is left with an unfilled plural form", () => {
    for (const [key, text] of Object.entries(en)) {
      for (const [, name] of text.matchAll(/\{(\w+)\|[^|{}]*\|[^|{}]*\}/g)) {
        expect(text, key).toContain(`{${name}}`);
      }
    }
    expect(Object.values(bn).some((text) => /\{\w+\|/.test(text))).toBe(false);
  });
});
