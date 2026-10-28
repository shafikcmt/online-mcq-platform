import { NextRequest } from "next/server";
import { describe, expect, test } from "vitest";

import { clock, date, dateTime, decimal, digits, money } from "@/lib/format";
import { translator } from "@/lib/i18n";
import { alternates } from "@/lib/site";
import { middleware } from "@/middleware";

describe("format", () => {
  test("digits, decimals and money in both languages", () => {
    expect(digits(2026, "bn")).toBe("২০২৬");
    expect(decimal("37.50", "en")).toBe("37.5");
    expect(money("500.00", "BDT", "en")).toBe("৳500");
    expect(money("500.00", "BDT", "bn")).toBe("৳৫০০");
    expect(money("10.00", "USD", "en")).toBe("10 USD");
  });

  test("time used as a clock", () => {
    expect(clock(0, "en")).toBe("0:00");
    expect(clock(245, "en")).toBe("4:05");
    expect(clock(3729, "en")).toBe("1:02:09");
    expect(clock(245, "bn")).toBe("৪:০৫");
  });

  test("Bangla times name the part of the day instead of an English AM/PM (Bangladesh time)", () => {
    expect(dateTime("2026-10-27T00:29:00Z", "bn")).toBe("২৭ অক্টো, সকাল ৬:২৯");
    expect(dateTime("2026-10-27T06:05:00Z", "bn")).toBe("২৭ অক্টো, দুপুর ১২:০৫");
    expect(dateTime("2026-10-27T10:30:00Z", "bn")).toBe("২৭ অক্টো, বিকাল ৪:৩০");
    expect(dateTime("2026-10-27T12:15:00Z", "bn")).toBe("২৭ অক্টো, সন্ধ্যা ৬:১৫");
    expect(dateTime("2026-10-26T18:00:00Z", "bn")).toBe("২৭ অক্টো, রাত ১২:০০"); // midnight in Dhaka
    expect(dateTime("2026-10-26T22:45:00Z", "bn")).toBe("২৭ অক্টো, ভোর ৪:৪৫");
    expect(dateTime("2026-10-27T00:29:00Z", "en")).toMatch(/^27 Oct, 6:29\s?am$/i);
  });

  test("dates in Bangladesh time", () => {
    expect(date("2026-10-31T20:00:00Z", "en")).toBe("1 November 2026"); // 2 am in Dhaka
  });
});

test("translator fills placeholders and shows the key when missing", () => {
  const t = translator("en");
  expect(t("exam.minutes", { n: 30 })).toBe("30 min");
  expect(t("no.such.key")).toBe("no.such.key");
});

test("hreflang alternates: both languages and x-default (Bangla)", () => {
  expect(alternates("en", "/exams")).toEqual({
    canonical: "https://livemodeltest.com/en/exams",
    languages: { "bn-BD": "https://livemodeltest.com/bn/exams", en: "https://livemodeltest.com/en/exams", "x-default": "https://livemodeltest.com/bn/exams" },
  });
});

describe("language routing", () => {
  const go = (path: string, headers: Record<string, string> = {}) => middleware(new NextRequest(new URL(path, "https://livemodeltest.com"), { headers }));

  test("a path without a language goes to Bangla by default, keeping the query", () => {
    expect(go("/").headers.get("location")).toBe("https://livemodeltest.com/bn");
    expect(go("/exams?type=live").headers.get("location")).toBe("https://livemodeltest.com/bn/exams?type=live");
  });

  test("an English browser goes to English; a saved choice wins", () => {
    expect(go("/", { "accept-language": "en-GB,en;q=0.9" }).headers.get("location")).toBe("https://livemodeltest.com/en");
    expect(go("/", { "accept-language": "en-GB", cookie: "lang=bn" }).headers.get("location")).toBe("https://livemodeltest.com/bn");
  });

  test("a page with a language passes and remembers it", () => {
    const response = go("/en/exams");
    expect(response.headers.get("location")).toBeNull();
    expect(response.cookies.get("lang")?.value).toBe("en");
  });
});
