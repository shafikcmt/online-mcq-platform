import i18n from "@/i18n";
import { shortGap, relativeOrDate } from "@/features/exams/time";
import { formatDateTime, formatDecimal } from "@/lib/format";
import { resetServerClock, serverNow, syncServerClock } from "@/lib/server-clock";

const t = i18n.getFixedT("en");
const tbn = i18n.getFixedT("bn");
const MIN = 60_000;

test("decimals from the API lose only trailing zeros", () => {
  expect(formatDecimal("45.00", "en")).toBe("45");
  expect(formatDecimal("37.50", "en")).toBe("37.5");
  expect(formatDecimal("83.33", "en")).toBe("83.33");
  expect(formatDecimal("120", "en")).toBe("120");
  expect(formatDecimal("0.00", "en")).toBe("0");
  expect(formatDecimal("37.50", "bn")).toBe("৩৭.৫");
});

test("short gaps round up to the minute; a day or more, or the past, gives no gap", () => {
  expect(shortGap(30_000, 0, t, "en")).toBe("1 min");
  expect(shortGap(60 * MIN, 0, t, "en")).toBe("1 h");
  expect(shortGap(61 * MIN, 0, t, "en")).toBe("1 h 1 min");
  expect(shortGap(24 * 60 * MIN, 0, t, "en")).toBeNull();
  expect(shortGap(-1, 0, t, "en")).toBeNull();
  expect(shortGap(90 * MIN, 0, tbn, "bn")).toBe("১ ঘণ্টা ৩০ মিনিট");
});

test("beyond a day the date and time are shown (phone time zone)", () => {
  const iso = "2026-11-02T03:00:00Z"; // 9:00 am in Dhaka
  expect(formatDateTime(iso, "en")).toMatch(/2 Nov.*9:00\s?am/i);
  expect(relativeOrDate("starts", iso, Date.parse("2026-10-27T00:00:00Z"), t, "en")).toMatch(/^Starts 2 Nov/);
  expect(relativeOrDate("ends", iso, Date.parse("2026-10-27T00:00:00Z"), tbn, "bn")).toMatch(/^শেষ: ২ নভে/);
});

test("server clock follows the last server_time seen", () => {
  resetServerClock();
  syncServerClock("2030-01-01T00:00:00Z", Date.parse("2029-12-31T23:00:00Z"));
  expect(serverNow() - Date.now()).toBeGreaterThan(59 * MIN);
  syncServerClock("not a date");
  expect(serverNow() - Date.now()).toBeGreaterThan(59 * MIN);
  resetServerClock();
});
