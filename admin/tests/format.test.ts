import { describe, expect, it } from "vitest";

import { formatMoney, formatNumber } from "@/lib/format";
import { bn, en, translate } from "@/lib/i18n/messages";

describe("formatting", () => {
  it("formats BDT with the taka sign and Western digits", () => {
    expect(formatMoney("1000.00", "BDT")).toBe("৳ 1,000.00");
    expect(formatMoney("1234567.5", "BDT", "bn")).toBe("৳ 12,34,567.50");
    expect(formatNumber(12500)).toBe("12,500");
  });

  it("every English key has a Bangla translation", () => {
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
    for (const value of Object.values(bn)) expect(value.trim()).not.toBe("");
  });

  it("fills placeholders", () => {
    expect(translate(en, "dashboard.studentsActive", { n: "3" })).toBe("3 active accounts");
  });
});
