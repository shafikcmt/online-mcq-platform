import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RoutineSchedule } from "@/components/routine-schedule";
import { translator } from "@/lib/i18n";
import { clockTime, dayKey, dayLabel, groupByDay, routineState, timeRange, type RoutineExam } from "@/lib/routine";

const exam = (over: Partial<RoutineExam> = {}): RoutineExam => ({
  slug: "physics-1",
  title: "Physics model test",
  category: { slug: "hsc", name: "HSC" },
  subject: { slug: "physics", name: "Physics" },
  start_at: "2026-11-14T12:30:00Z", // 6:30 pm in Bangladesh
  end_at: "2026-11-14T14:30:00Z",
  duration_minutes: 30,
  total_questions: 25,
  total_marks: "25.00",
  exam_type: "regular",
  access_type: "free",
  ...over,
});

describe("routine helpers (Bangladesh time)", () => {
  it("a day is the Bangladesh day: 18:30 UTC is already the next morning there", () => {
    expect(dayKey("2026-11-14T17:59:00Z")).toBe("2026-11-14");
    expect(dayKey("2026-11-14T18:00:00Z")).toBe("2026-11-15");
    expect(dayKey("2026-11-14T18:30:00Z")).toBe("2026-11-15");
  });

  it("groups by day and keeps days and exams in time order, dropping exams with no start", () => {
    const days = groupByDay([
      exam({ slug: "c", start_at: "2026-11-16T05:00:00Z" }),
      exam({ slug: "a", start_at: "2026-11-14T12:30:00Z" }),
      exam({ slug: "b", start_at: "2026-11-14T03:00:00Z" }),
      exam({ slug: "none", start_at: null, end_at: null }),
    ]);
    expect(days.map((day) => day.key)).toEqual(["2026-11-14", "2026-11-16"]);
    expect(days[0].exams.map((row) => row.slug)).toEqual(["b", "a"]);
  });

  it("formats the clock in English and Bangla", () => {
    expect(clockTime("2026-11-14T12:30:00Z", "en")).toBe("6:30 pm");
    expect(clockTime("2026-11-14T03:00:00Z", "en")).toBe("9:00 am");
    expect(clockTime("2026-11-14T12:30:00Z", "bn")).toBe("সন্ধ্যা ৬:৩০");
    expect(clockTime("2026-11-14T18:00:00Z", "en")).toBe("12:00 am"); // midnight, next day there
  });

  it("a range shows the end only when there is one", () => {
    expect(timeRange(exam(), "en")).toBe("6:30 pm – 8:30 pm");
    expect(timeRange(exam({ end_at: null }), "en")).toBe("6:30 pm");
  });

  it("labels a day with its weekday in the page's language", () => {
    expect(dayLabel("2026-11-14", "en")).toBe("Saturday, 14 November 2026");
    expect(dayLabel("2026-11-14", "bn")).toContain("শনিবার");
  });

  it("is live from the start and upcoming before it", () => {
    const now = Date.parse("2026-11-14T13:00:00Z");
    expect(routineState(exam(), now)).toBe("live");
    expect(routineState(exam({ start_at: "2026-11-14T15:00:00Z" }), now)).toBe("upcoming");
  });
});

describe("RoutineSchedule", () => {
  const html = (exams: RoutineExam[], lang: "en" | "bn" = "en", now = Date.parse("2026-11-14T00:00:00Z")) =>
    renderToStaticMarkup(<RoutineSchedule exams={exams} lang={lang} t={translator(lang)} now={now} />);

  it("shows the day, the time, the title and links to the exam's own page", () => {
    const out = html([exam()]);
    expect(out).toContain("Saturday, 14 November 2026");
    expect(out).toContain("6:30 pm – 8:30 pm");
    expect(out).toContain("Physics model test");
    expect(out).toContain('href="/en/exams/physics-1"');
    expect(out).toContain("Upcoming");
    expect(out).toContain("Free");
  });

  it("marks an exam that has started as live", () => {
    expect(html([exam()], "en", Date.parse("2026-11-14T13:00:00Z"))).toContain("Live now");
  });

  it("is readable in Bangla", () => {
    const out = html([exam()], "bn");
    expect(out).toContain("শনিবার");
    expect(out).toContain("সন্ধ্যা ৬:৩০");
    expect(out).toContain("আসছে");
  });

  it("writes the admin's title escaped, never as markup", () => {
    const out = html([exam({ title: "<img src=x onerror=alert(1)>" })]);
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });
});
