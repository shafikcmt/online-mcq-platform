import { fireEvent, screen, userEvent, waitFor } from "@testing-library/react-native";
import * as Linking from "expo-linking";

import { clockTime, dayKey, dayLabel, groupByDay, isLive, timeRange } from "@/features/routine/group";
import type { RoutineExam, RoutineResponse } from "@/features/routine/types";

import { mockBackend, renderApp, resetDevice, STUDENT } from "./helpers";

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

const routine = (over: Partial<RoutineResponse> = {}): { status: number; body: RoutineResponse } => ({
  status: 200,
  body: { pdf: { available: false, size_bytes: 0, updated_at: null }, exams: [exam()], ...over },
});

async function open(routes: Parameters<typeof mockBackend>[0], language: "bn" | "en" = "en") {
  await resetDevice({ language, refresh: "R0" });
  const backend = mockBackend({
    "POST /auth/token/refresh/": { status: 200, body: { access: "A1", refresh: "R1" } },
    "GET /me/": { status: 200, body: { ...STUDENT, preferred_language: language } },
    ...routes,
  });
  await renderApp("/routine");
  return backend;
}

describe("routine helpers (Bangladesh time)", () => {
  test("a day is the Bangladesh day: 18:00 UTC is already the next morning there", () => {
    expect(dayKey("2026-11-14T17:59:00Z")).toBe("2026-11-14");
    expect(dayKey("2026-11-14T18:00:00Z")).toBe("2026-11-15");
  });

  test("groups by day in time order and drops exams with no start", () => {
    const days = groupByDay([
      exam({ slug: "c", start_at: "2026-11-16T05:00:00Z" }),
      exam({ slug: "a", start_at: "2026-11-14T12:30:00Z" }),
      exam({ slug: "b", start_at: "2026-11-14T03:00:00Z" }),
      exam({ slug: "none", start_at: null, end_at: null }),
    ]);
    expect(days.map((day) => day.key)).toEqual(["2026-11-14", "2026-11-16"]);
    expect(days[0].exams.map((row) => row.slug)).toEqual(["b", "a"]);
  });

  test("clock and range in both languages", () => {
    expect(clockTime("2026-11-14T12:30:00Z", "en")).toBe("6:30 pm");
    expect(clockTime("2026-11-14T12:30:00Z", "bn")).toBe("সন্ধ্যা ৬:৩০");
    expect(timeRange(exam(), "en")).toBe("6:30 pm – 8:30 pm");
    expect(timeRange(exam({ end_at: null }), "en")).toBe("6:30 pm");
    // An end on a later day names that day (a 24-hour window is not "2:13 pm – 2:13 pm").
    expect(timeRange({ start_at: "2026-11-15T08:13:00Z", end_at: "2026-11-16T08:13:00Z" }, "en")).toBe("2:13 pm – 16 November, 2:13 pm");
  });

  test("day label and live state", () => {
    expect(dayLabel("2026-11-14", "en")).toBe("Saturday, 14 November 2026");
    expect(isLive(exam(), Date.parse("2026-11-14T13:00:00Z"))).toBe(true);
    expect(isLive(exam(), Date.parse("2026-11-14T10:00:00Z"))).toBe(false);
  });
});

describe("Routine screen", () => {
  afterEach(() => jest.restoreAllMocks());

  test("the PDF button appears only when a routine PDF is published and opens the API address", async () => {
    jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await open({ "GET /public/routine/": routine({ pdf: { available: true, size_bytes: 2048, updated_at: "2026-11-10T08:00:00Z" } }) });
    const user = userEvent.setup();
    await user.press(await screen.findByRole("button", { name: "Download routine PDF" }));
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith(expect.stringMatching(/\/public\/routine\/pdf\/$/)));
  });

  test("shows each day with its exams, time, details and state; needs no sign-in call for the schedule", async () => {
    const backend = await open({
      "GET /public/routine/": routine({
        exams: [exam(), exam({ slug: "bio-1", title: "Biology final", start_at: "2026-11-16T05:00:00Z", end_at: "2026-11-16T07:00:00Z", access_type: "paid" })],
      }),
    });
    expect(await screen.findByText("Exam routine")).toBeOnTheScreen();
    expect(screen.getByText("Saturday, 14 November 2026")).toBeOnTheScreen();
    expect(screen.getByText("Monday, 16 November 2026")).toBeOnTheScreen();
    expect(screen.getByText("6:30 pm – 8:30 pm")).toBeOnTheScreen();
    expect(screen.getByText("Physics model test")).toBeOnTheScreen();
    expect(screen.getAllByText("HSC · Physics")).toHaveLength(2);
    for (const fact of ["25 marks", "30 min", "25 questions"]) expect(screen.getAllByText(fact)).toHaveLength(2);
    expect(backend.find("GET", "/public/routine/")[0].headers.Authorization).toBeUndefined();
  });

  test("a card shows the topics (two, then Show more), the study materials and a Live mark", async () => {
    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-14T13:00:00Z")); // inside the exam's window
    const syllabus = ["Motion", "Force", "Energy"].map((topic) => ({ subject: "Physics", chapter: "", topic }));
    await open({ "GET /public/routine/": routine({ exams: [exam({ syllabus, material_count: 2 })] }) });
    expect(await screen.findByText("1. Physics: Motion")).toBeOnTheScreen();
    expect(screen.getByText("Live")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Open Physics model test" })).toHaveTextContent("Start live exam");
    expect(screen.queryByText("3. Physics: Energy")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText("3. Physics: Energy")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("link", { name: "Study materials (2)" }));
    expect(screen).toHavePathname("/materials");
  });

  test("opened from a category it shows that category only, until the chip is cleared", async () => {
    await resetDevice({ language: "en", refresh: "R0" });
    mockBackend({
      "POST /auth/token/refresh/": { status: 200, body: { access: "A1", refresh: "R1" } },
      "GET /me/": { status: 200, body: STUDENT },
      "GET /public/routine/": routine({ exams: [exam(), exam({ slug: "bcs-1", title: "BCS quiz", category: { slug: "bcs", name: "BCS" } })] }),
    });
    await renderApp("/routine?category=bcs&categoryName=BCS");
    expect(await screen.findByText("BCS quiz")).toBeOnTheScreen();
    expect(screen.queryByText("Physics model test")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Show all categories (now: BCS)" }));
    expect(screen.getByText("Physics model test")).toBeOnTheScreen();
  });

  test("no PDF, no button", async () => {
    await open({ "GET /public/routine/": routine() });
    await screen.findByText("Physics model test");
    expect(screen.queryByRole("button", { name: "Download routine PDF" })).not.toBeOnTheScreen();
  });

  test("an empty routine says so", async () => {
    await open({ "GET /public/routine/": routine({ exams: [] }) });
    expect(await screen.findByText("No exams are scheduled right now. Check back soon.")).toBeOnTheScreen();
  });

  test("a failed load offers Retry and then shows the routine", async () => {
    let failing = true;
    await open({
      "GET /public/routine/": () => (failing ? { status: 503, body: { error: { code: "unavailable", message: "Service unavailable" } } } : routine()),
    });
    const retry = await screen.findByRole("button", { name: "Try again" });
    failing = false;
    await fireEvent.press(retry);
    expect(await screen.findByText("Physics model test")).toBeOnTheScreen();
  });

  test("is available in Bangla", async () => {
    await open({ "GET /public/routine/": routine() }, "bn");
    expect(await screen.findByText("পরীক্ষার রুটিন")).toBeOnTheScreen();
    expect(screen.getByText("সন্ধ্যা ৬:৩০ – রাত ৮:৩০")).toBeOnTheScreen();
  });

  test("tapping an exam opens its own screen", async () => {
    await open({ "GET /public/routine/": routine(), "GET /exams/physics-1/": { status: 404, body: { error: { code: "not_found", message: "x" } } } });
    await fireEvent.press(await screen.findByRole("button", { name: "Open Physics model test" }));
    expect(screen).toHavePathname("/exam/physics-1");
  });
});
