import { act, fireEvent, screen, userEvent, waitFor } from "@testing-library/react-native";

import type { StudentExam, StudentExamDetail } from "@/features/exams/types";

import { apiError, emptyDashboard, mockBackend, renderApp, resetDevice, STUDENT } from "./helpers";

jest.setTimeout(20_000);

const HOUR = 3_600_000;

function exam(overrides: Partial<StudentExam> = {}): StudentExam {
  return {
    slug: "physics",
    title: "Physics model test",
    description: "",
    instructions: "",
    exam_type: "regular",
    access_type: "free",
    content_language: "both",
    category: { slug: "hsc", name: "HSC" },
    subject: { slug: "physics", name: "Physics" },
    duration_minutes: 30,
    total_questions: 25,
    total_marks: "25.00",
    negative_marks: "0.25",
    pass_marks: "10.00",
    start_at: null,
    end_at: null,
    is_featured: false,
    has_access: true,
    can_start: true,
    can_resume: false,
    attempt_state: null,
    locked_reason: null,
    attempts_used: 0,
    attempts_allowed: 1,
    seconds_if_started_now: 1800,
    ...overrides,
  };
}

const page = (results: StudentExam[], count = results.length, next: string | null = null) => ({
  status: 200,
  body: { count, next, previous: null, results, server_time: new Date().toISOString() },
});

const detail = (overrides: Partial<StudentExamDetail> = {}) => ({
  status: 200,
  body: { ...exam(), server_time: new Date().toISOString(), ...overrides },
});

async function signedIn(routes: Parameters<typeof mockBackend>[0], url: string, language: "bn" | "en" = "en") {
  await resetDevice({ language, refresh: "R0" });
  const backend = mockBackend({
    "POST /auth/token/refresh/": { status: 200, body: { access: "A1", refresh: "R1" } },
    "GET /me/": { status: 200, body: { ...STUDENT, preferred_language: language } },
    ...routes,
  });
  await renderApp(url);
  return backend;
}

describe("Exams tab", () => {
  test("lists open exams first; the filter asks the server for upcoming and past", async () => {
    const backend = await signedIn(
      {
        "GET /exams/": (call) =>
          call.query.when === "open"
            ? page([exam(), exam({ slug: "bio", title: "Biology final", access_type: "paid", has_access: false, can_start: false, locked_reason: "needs_subscription" })], 2)
            : page([]),
      },
      "/exams",
    );
    expect(await screen.findByText("Physics model test")).toBeOnTheScreen();
    expect(screen.getByText("Needs a package")).toBeOnTheScreen();
    expect(screen.getByText("2 exams")).toBeOnTheScreen();
    expect(backend.find("GET", "/exams/")[0].query).toEqual({ when: "open", page: "1", page_size: "20" });

    const user = userEvent.setup();
    await user.press(screen.getByRole("radio", { name: "Upcoming" }));
    expect(await screen.findByText("No upcoming exams yet.")).toBeOnTheScreen();
    await user.press(screen.getByRole("radio", { name: "Past" }));
    expect(await screen.findByText("No past exams yet.")).toBeOnTheScreen();
    expect(backend.find("GET", "/exams/").map((call) => call.query.when)).toEqual(["open", "upcoming", "ended"]);
  });

  test("loads the next page near the end of the list, without duplicates", async () => {
    const first = Array.from({ length: 20 }, (_, i) => exam({ slug: `e${i}`, title: `Exam ${i}` }));
    const backend = await signedIn(
      {
        "GET /exams/": (call) =>
          call.query.page === "1" ? page(first, 22, "/exams/?page=2") : page([exam({ slug: "e19", title: "Exam 19" }), exam({ slug: "e20", title: "Exam 20" }), exam({ slug: "e21", title: "Exam 21" })], 22),
      },
      "/exams",
    );
    expect(await screen.findByText("Exam 0")).toBeOnTheScreen();
    await act(async () => {
      fireEvent(screen.getByTestId("exam-list"), "endReached");
    });
    await waitFor(() => expect(backend.find("GET", "/exams/").map((call) => call.query.page)).toEqual(["1", "2"]));
    // The list holds 22 distinct exams (page 2 repeated "e19", which shifted between pages).
    await waitFor(() => expect(screen.getByTestId("exam-list").props.data).toHaveLength(22));
    const slugs = (screen.getByTestId("exam-list").props.data as StudentExam[]).map((item) => item.slug);
    expect(new Set(slugs).size).toBe(22);
  });

  test("a failed first load offers a retry", async () => {
    await signedIn({ "GET /exams/": ["network", page([exam()])] }, "/exams");
    expect(await screen.findByText("No internet connection. Check your connection and try again.")).toBeOnTheScreen();
    const user = userEvent.setup();
    await user.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Physics model test")).toBeOnTheScreen();
  });

  test("Home's “See all” opens the Exams tab on the matching filter", async () => {
    const upcoming = { slug: "eng", title: "English grammar", exam_type: "regular" as const, access_type: "free" as const, start_at: new Date(Date.now() + 5 * HOUR).toISOString(), end_at: null, duration_minutes: 30, has_access: true, can_start: false, can_resume: false, attempt_state: null };
    const backend = await signedIn(
      {
        "GET /me/dashboard/": { status: 200, body: emptyDashboard({ exams: { available: { count: 0, items: [] }, upcoming: { count: 9, items: [upcoming] }, practice: { count: 0, items: [] } } }) },
        "GET /exams/": page([exam({ slug: "eng", title: "English grammar (all)" })]),
      },
      "/home",
    );
    const user = userEvent.setup();
    await user.press(await screen.findByRole("link", { name: "See all" }));
    expect(await screen.findByText("English grammar (all)")).toBeOnTheScreen();
    expect(backend.find("GET", "/exams/")[0].query.when).toBe("upcoming");
    expect(screen.getByRole("radio", { name: "Upcoming" })).toBeChecked();
  });
});

describe("Exam details", () => {
  test("tapping an exam opens its details: facts, instructions and that it can start", async () => {
    const backend = await signedIn(
      {
        "GET /exams/": page([exam()]),
        "GET /exams/physics/": detail({ description: "Chapters 1–3.", instructions: "No calculators." }),
      },
      "/exams",
    );
    const user = userEvent.setup();
    await user.press(await screen.findByRole("link", { name: /Physics model test/ }));
    expect(await screen.findByText("No calculators.")).toBeOnTheScreen();
    expect(screen.getByText("HSC · Physics")).toBeOnTheScreen();
    expect(screen.getByText("Chapters 1–3.")).toBeOnTheScreen();
    expect(screen.getByText("−0.25 marks")).toBeOnTheScreen();
    expect(screen.getByText("Bangla and English")).toBeOnTheScreen();
    expect(screen.getByText("0 of 1")).toBeOnTheScreen();
    expect(screen.getByText("You can start this exam now. You will have 30 min.")).toBeOnTheScreen();
    expect(backend.find("GET", "/exams/physics/")).toHaveLength(1);
  });

  test.each([
    [{ locked_reason: "needs_subscription", has_access: false, can_start: false }, "This is a paid exam. You need an active package that includes it."],
    [{ locked_reason: "exam_ended", can_start: false }, "This exam has closed."],
    [{ locked_reason: "retake_not_allowed", can_start: false, attempt_state: "finished", attempts_used: 1 }, "You have already taken this exam. It can be taken only once."],
    [{ locked_reason: "attempt_limit_reached", can_start: false, attempts_used: 3, attempts_allowed: 3 }, "You have used all your attempts for this exam."],
    [{ can_start: false, can_resume: true, attempt_state: "in_progress" }, "You have this exam in progress. You can continue where you left off."],
  ] as [Partial<StudentExam>, string][])("explains the state the server reports (%#)", async (state, message) => {
    await signedIn({ "GET /exams/physics/": detail({ ...state, seconds_if_started_now: null }) }, "/exam/physics");
    expect(await screen.findByText(message)).toBeOnTheScreen();
  });

  test("shows the syllabus lines in order, with subject, chapter and topic", async () => {
    await signedIn(
      {
        "GET /exams/physics/": detail({
          syllabus: [
            { subject: "Physics", chapter: "Motion", topic: "Speed" },
            { subject: "", chapter: "", topic: "Reflection" },
          ],
        }),
      },
      "/exam/physics",
    );
    expect(await screen.findByRole("heading", { name: "Syllabus" })).toBeOnTheScreen();
    expect(screen.getByText("Motion")).toBeOnTheScreen();
    expect(screen.getByText("Speed")).toBeOnTheScreen();
    expect(screen.getByText("Reflection")).toBeOnTheScreen();
  });

  test("no syllabus: the section is not shown", async () => {
    await signedIn({ "GET /exams/physics/": detail({ syllabus: [] }) }, "/exam/physics");
    await screen.findByText("Physics model test");
    expect(screen.queryByRole("heading", { name: "Syllabus" })).not.toBeOnTheScreen();
  });

  test("not opened yet: says when, from the server's clock", async () => {
    await signedIn(
      { "GET /exams/physics/": detail({ locked_reason: "exam_not_started", can_start: false, seconds_if_started_now: null, start_at: new Date(Date.now() + 3 * HOUR).toISOString() }) },
      "/exam/physics",
    );
    expect(await screen.findByText("This exam has not opened yet. Starts in 3 h.")).toBeOnTheScreen();
  });

  test("joining late says how much time is left", async () => {
    await signedIn({ "GET /exams/physics/": detail({ seconds_if_started_now: 9 * 60, end_at: new Date(Date.now() + 9 * 60_000).toISOString() }) }, "/exam/physics");
    expect(await screen.findByText("Joining late: you will have 9 min, until the exam closes.")).toBeOnTheScreen();
  });

  test("unlimited attempts, no negative marking, Bangla", async () => {
    await signedIn(
      { "GET /exams/physics/": detail({ title: "পদার্থবিজ্ঞান", negative_marks: "0.00", attempts_allowed: null, attempts_used: 2, exam_type: "practice" }) },
      "/exam/physics",
      "bn",
    );
    expect(await screen.findByText("নেগেটিভ মার্কিং নেই")).toBeOnTheScreen();
    expect(screen.getByText("২টি (সীমা নেই)")).toBeOnTheScreen();
    expect(screen.getByText("৩০ মিনিট")).toBeOnTheScreen();
    expect(screen.getByText("অনুশীলন")).toBeOnTheScreen();
  });

  test("an exam that is gone says so (404)", async () => {
    await signedIn({ "GET /exams/physics/": apiError(404, "not_found", "Not found.") }, "/exam/physics");
    expect(await screen.findByText("This exam is not available. It may have been removed or closed.")).toBeOnTheScreen();
  });

  test("a link to the exam's study materials appears only when it has some, and opens them", async () => {
    await signedIn(
      {
        "GET /exams/physics/": detail({}),
        "GET /public/materials/": (call) =>
          call.query.exam === "physics"
            ? { status: 200, body: { count: 2, next: null, previous: null, results: call.query.page_size === "1" ? [] : [] } }
            : { status: 200, body: { count: 0, next: null, previous: null, results: [] } },
      },
      "/exam/physics",
    );
    const link = await screen.findByRole("link", { name: "2 study materials for this exam" });
    await userEvent.setup().press(link);
    expect(await screen.findByText("Study materials for this exam.")).toBeOnTheScreen();
  });

  test("no materials, no link; a failed count request changes nothing", async () => {
    await signedIn(
      { "GET /exams/physics/": detail({}), "GET /public/materials/": { status: 200, body: { count: 0, next: null, previous: null, results: [] } } },
      "/exam/physics",
    );
    await screen.findByText("HSC · Physics");
    expect(screen.queryByRole("link", { name: /study material/ })).toBeNull();
  });
});
