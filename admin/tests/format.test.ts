import { describe, expect, it } from "vitest";

import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { bn, en, translate } from "@/lib/i18n/messages";

describe("formatting", () => {
  it("formats BDT with the taka sign and Western digits", () => {
    expect(formatMoney("1000.00", "BDT")).toBe("৳ 1,000.00");
    expect(formatMoney("1234567.5", "BDT", "bn")).toBe("৳ 12,34,567.50");
    expect(formatNumber(12500)).toBe("12,500");
  });

  it("Bangla times name the part of the day instead of an English AM/PM (Western digits, Dhaka time)", () => {
    expect(formatDateTime("2026-10-27T10:29:00Z", "bn")).toBe("27 অক্টো, 2026, বিকাল 4:29");
    expect(formatDateTime("2026-10-27T00:29:00Z", "bn")).toBe("27 অক্টো, 2026, সকাল 6:29");
    expect(formatDateTime("2026-10-26T18:00:00Z", "bn")).toBe("27 অক্টো, 2026, রাত 12:00");
    expect(formatDateTime("2026-10-27T10:29:00Z", "bn")).not.toMatch(/AM|PM/i);
    expect(formatDateTime("2026-10-27T10:29:00Z", "en")).toBe("27 Oct 2026, 16:29");
  });

  it("every English key has a Bangla translation", () => {
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
    for (const value of Object.values(bn)) expect(value.trim()).not.toBe("");
  });

  it("fills placeholders", () => {
    expect(translate(en, "dashboard.studentsActive", { n: "3" })).toBe("3 active accounts");
  });
});
