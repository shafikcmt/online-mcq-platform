import { act, screen, userEvent } from "@testing-library/react-native";

import type { Dashboard, DashboardExam } from "@/features/dashboard/types";

import { emptyDashboard, mockBackend, renderApp, resetDevice, STUDENT } from "./helpers";

jest.setTimeout(20_000);

const MIN = 60_000;
const HOUR = 60 * MIN;

function exam(overrides: Partial<DashboardExam>): DashboardExam {
  return {
    slug: "x",
    title: "X",
    exam_type: "regular",
    access_type: "free",
    start_at: null,
    end_at: null,
    duration_minutes: 30,
    has_access: true,
    can_start: true,
    can_resume: false,
    attempt_state: null,
    ...overrides,
  };
}

/** The server's clock is 3 days ahead of the phone's: every relative time below only
 * comes out right when it is counted from server time. */
function fullDashboard(): Dashboard {
  const server = Date.now() + 3 * 24 * HOUR;
  const at = (ms: number) => new Date(server + ms).toISOString();
  return emptyDashboard({
    server_time: at(0),
    exams: {
      available: {
        count: 7,
        items: [
          exam({ slug: "physics", title: "Physics model test", end_at: at(2 * HOUR + 15 * MIN), duration_minutes: 60 }),
          exam({ slug: "chem", title: "Chemistry weekly", can_start: false, can_resume: true, attempt_state: "in_progress" }),
          exam({ slug: "bio", title: "Biology final", access_type: "paid", has_access: false, can_start: false }),
          exam({ slug: "math", title: "Math quiz", can_start: false, attempt_state: "finished", exam_type: "live" }),
        ],
      },
      upcoming: { count: 1, items: [exam({ slug: "eng", title: "English grammar", start_at: at(45 * MIN), can_start: false })] },
      practice: { count: 1, items: [exam({ slug: "gk", title: "General knowledge practice", exam_type: "practice" })] },
    },
    subscription: {
      active_count: 1,
      items: [{ package: { slug: "hsc", name: "HSC full package" }, starts_at: at(-HOUR), expires_at: "2026-12-31T12:00:00Z" }],
    },
    results: {
      count: 1,
      items: [
        {
          attempt_id: "8d0f7a5e-1b1c-4c55-9f0e-2a6b7c8d9e01",
          exam: { slug: "physics-1", title: "Physics chapter 1", exam_type: "regular" },
          submitted_at: "2026-10-20T10:00:00Z",
          obtained_marks: "2.50",
          total_marks: "3.00",
          percentage: "83.33",
          is_passed: true,
          merit_position: 4,
        },
      ],
    },
    notifications: { unread_count: 3 },
  });
}

async function openHome(dashboard: unknown, language: "bn" | "en" = "en") {
  await resetDevice({ language, refresh: "R0" });
  const backend = mockBackend({
    "POST /auth/token/refresh/": { status: 200, body: { access: "A1", refresh: "R1" } },
    "GET /me/": { status: 200, body: { ...STUDENT, preferred_language: language } },
    "GET /me/dashboard/": dashboard as never,
  });
  await renderApp("/home");
  return backend;
}

test("shows exams, package, results and unread count, with times from the server's clock", async () => {
  const backend = await openHome({ status: 200, body: fullDashboard() });
  expect((await screen.findAllByText("Physics model test")).length).toBeGreaterThan(0);
  expect(backend.find("GET", "/me/dashboard/")[0].headers.Authorization).toBe("Bearer A1");

  expect(screen.getByText("Ends in 2 h 15 min")).toBeOnTheScreen();
  expect(screen.getByText("60 min")).toBeOnTheScreen();
  expect(screen.getByText("4 of 7")).toBeOnTheScreen();
  expect(screen.getAllByText("Ready to start")).toHaveLength(2); // physics + practice
  expect(screen.getByText("In progress — you can continue")).toBeOnTheScreen();
  expect(screen.getByText("Needs a package")).toBeOnTheScreen();
  expect(screen.getByText("Completed")).toBeOnTheScreen();
  expect(screen.getByText("Live")).toBeOnTheScreen();

  expect(screen.getByRole("heading", { name: "Upcoming" })).toBeOnTheScreen();
  expect(screen.getByText("Starts in 45 min")).toBeOnTheScreen();
  expect(screen.getByRole("heading", { name: "Practice" })).toBeOnTheScreen();

  expect(screen.getByText("HSC full package")).toBeOnTheScreen();
  expect(screen.getByText("Valid until 31 December 2026")).toBeOnTheScreen();

  expect(screen.getByText("2.5/3")).toBeOnTheScreen();
  expect(screen.getByText("83.33%")).toBeOnTheScreen();
  expect(screen.getByText("Passed")).toBeOnTheScreen();
  expect(screen.getByText("Merit 4")).toBeOnTheScreen();

  expect(screen.getByLabelText("3 unread notifications")).toBeOnTheScreen();
});

test("countdowns move on with the clock", async () => {
  await openHome({ status: 200, body: fullDashboard() });
  expect(await screen.findByText("Ends in 2 h 15 min")).toBeOnTheScreen();
  await act(async () => {
    jest.advanceTimersByTime(15 * MIN);
  });
  expect(screen.getByText("Ends in 2 h")).toBeOnTheScreen();
  expect(screen.getByText("Starts in 30 min")).toBeOnTheScreen();
});

test("Bangla: labels, digits and marks in Bangla", async () => {
  await openHome({ status: 200, body: fullDashboard() }, "bn");
  expect(await screen.findByText("২ ঘণ্টা ১৫ মিনিট পরে শেষ")).toBeOnTheScreen();
  expect(screen.getByText("৬০ মিনিট")).toBeOnTheScreen();
  expect(screen.getByText("২.৫/৩")).toBeOnTheScreen();
  expect(screen.getByText("৮৩.৩৩%")).toBeOnTheScreen();
  expect(screen.getByText("মেধাক্রম ৪")).toBeOnTheScreen();
  expect(screen.getByText("৭টির মধ্যে ৪টি")).toBeOnTheScreen();
  expect(screen.getByLabelText("৩টি না-পড়া নোটিফিকেশন")).toBeOnTheScreen();
});

test("a new student sees calm empty states; empty upcoming/practice blocks are hidden", async () => {
  await openHome({ status: 200, body: emptyDashboard() });
  expect(await screen.findByText("No active package")).toBeOnTheScreen();
  expect(screen.getByText("No exams are open right now. Pull down to check again.")).toBeOnTheScreen();
  expect(screen.getByText("Your results will appear here after you finish an exam.")).toBeOnTheScreen();
  expect(screen.queryByRole("heading", { name: "Upcoming" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Practice" })).toBeNull();
  expect(screen.getByLabelText("No unread notifications")).toBeOnTheScreen();
});

test("a first load without internet offers a retry that then loads", async () => {
  await openHome(["network", { status: 200, body: fullDashboard() }]);
  expect(await screen.findByText("No internet connection. Check your connection and try again.")).toBeOnTheScreen();
  const user = userEvent.setup();
  await user.press(screen.getByRole("button", { name: "Try again" }));
  expect((await screen.findAllByText("Physics model test")).length).toBeGreaterThan(0);
});

test("coming back to Home reloads quietly; a failed reload keeps the last data", async () => {
  const backend = await openHome([{ status: 200, body: fullDashboard() }, "network"]);
  expect((await screen.findAllByText("Physics model test")).length).toBeGreaterThan(0);
  const user = userEvent.setup();
  await user.press(screen.getByRole("button", { name: /Profile/ }));
  await user.press(await screen.findByRole("button", { name: /Home/ }));
  expect(await screen.findByText(/Couldn't update just now/)).toBeOnTheScreen();
  expect(screen.getAllByText("Physics model test").length).toBeGreaterThan(0);
  expect(backend.find("GET", "/me/dashboard/")).toHaveLength(2);
});


// ======================================================================================
// Redesigned top of Home: featured exam, categories, shortcuts
// ======================================================================================
test("features the open exam with a seconds countdown and one action", async () => {
  const backend = await openHome({ status: 200, body: fullDashboard() });
  // physics: open now, can start, ends in 2 h 15 min (server clock).
  expect(await screen.findByLabelText("Ends in 2 hours 15 min 0 sec")).toBeOnTheScreen();
  await act(async () => {
    jest.advanceTimersByTime(5_000);
  });
  expect(screen.getByLabelText("Ends in 2 hours 14 min 55 sec")).toBeOnTheScreen();
  const user = userEvent.setup();
  await user.press(screen.getByRole("button", { name: "Join the exam: Physics model test" }));
  await act(async () => {
    jest.advanceTimersByTime(100);
  });
  expect(backend.find("GET", "/exams/physics/").length).toBeGreaterThan(0); // its detail page
});

test("a live exam comes first; with nothing open the next upcoming exam is featured", async () => {
  const data = fullDashboard();
  data.exams.available.items[3] = exam({ slug: "live", title: "Live final", exam_type: "live" });
  await openHome({ status: 200, body: data });
  expect(await screen.findByText("LIVE")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Join the exam: Live final" })).toBeOnTheScreen();
});

test("nothing open: the upcoming exam is featured, counting down to its start", async () => {
  const data = fullDashboard();
  data.exams.available = { count: 0, items: [] };
  await openHome({ status: 200, body: data });
  expect(await screen.findByText("Up next")).toBeOnTheScreen();
  expect(screen.getByLabelText("Starts in 0 hours 45 min 0 sec")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "View details: English grammar" })).toBeOnTheScreen();
});

test("no featured card for a new student; categories with exams and shortcuts are shown", async () => {
  await resetDevice({ language: "bn", refresh: "R0" });
  const backend = mockBackend({
    "POST /auth/token/refresh/": { status: 200, body: { access: "A1", refresh: "R1" } },
    "GET /me/": { status: 200, body: { ...STUDENT, preferred_language: "bn" } },
    "GET /public/categories/": {
      status: 200,
      body: {
        count: 2,
        next: null,
        previous: null,
        results: [
          { slug: "medical", name: "মেডিকেল ভর্তি", exam_count: 12, live_count: 1 },
          { slug: "job", name: "চাকরি", exam_count: 3, live_count: 0 },
          { slug: "empty", name: "খালি", exam_count: 0 },
        ],
      },
    },
  });
  await renderApp("/home");
  expect(await screen.findByText("মেডিকেল ভর্তি")).toBeOnTheScreen();
  expect(screen.getByRole("heading", { name: "পরীক্ষা বিভাগ" })).toBeOnTheScreen();
  expect(screen.queryByText("খালি")).toBeNull(); // no exams yet: not shown
  // A red dot (and the words "live now") marks a category with a scheduled exam running.
  expect(screen.getByTestId("live-medical")).toBeOnTheScreen();
  expect(screen.queryByTestId("live-job")).toBeNull();
  expect(screen.getByRole("heading", { name: "কুইক অ্যাক্সেস" })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: /পরীক্ষায় যোগ দিন/ })).toBeNull();

  // A category opens its own screen: its exams in every state.
  const user = userEvent.setup();
  backend.calls.length = 0;
  await user.press(screen.getByRole("link", { name: "মেডিকেল ভর্তি, ১২টি পরীক্ষা, এখন লাইভ" }));
  await act(async () => {
    jest.advanceTimersByTime(100);
  });
  expect(screen).toHavePathname("/category/medical");
  expect(await screen.findByRole("heading", { name: "মেডিকেল ভর্তি" })).toBeOnTheScreen();
  const queries = backend.find("GET", "/exams/").map((call) => call.query);
  expect(queries.map((query) => query.when).sort()).toEqual(["ended", "open", "upcoming"]);
  expect(queries.every((query) => query.category === "medical")).toBe(true);
});

test("the study section says 'Coming soon' until something is published, then opens that kind", async () => {
  await resetDevice({ language: "en", refresh: "R0" });
  mockBackend({
    "POST /auth/token/refresh/": { status: 200, body: { access: "A1", refresh: "R1" } },
    "GET /me/": { status: 200, body: STUDENT },
    "GET /public/materials/": (request: { query: Record<string, string> }) => ({
      status: 200,
      body: { count: request.query.kind === "video" ? 4 : 0, next: null, previous: null, results: [] },
    }),
  });
  await renderApp("/home");
  expect(await screen.findByRole("heading", { name: "Study section" })).toBeOnTheScreen();
  expect(await screen.findByRole("link", { name: "PDF notes, Coming soon" })).toBeDisabled();
  const user = userEvent.setup();
  await user.press(await screen.findByRole("link", { name: "Video lessons" }));
  expect(screen).toHavePathname("/materials");
});

test("Home still works when categories cannot load", async () => {
  await resetDevice({ language: "en", refresh: "R0" });
  mockBackend({
    "POST /auth/token/refresh/": { status: 200, body: { access: "A1", refresh: "R1" } },
    "GET /me/": { status: 200, body: STUDENT },
    "GET /public/categories/": "network",
  });
  await renderApp("/home");
  expect(await screen.findByText("No active package")).toBeOnTheScreen();
  expect(screen.queryByRole("heading", { name: "Exam section" })).toBeNull();
});

test("quick access reaches the routine, study materials, past exams and results", async () => {
  await resetDevice({ language: "en", refresh: "R0" });
  mockBackend({
    "POST /auth/token/refresh/": { status: 200, body: { access: "A1", refresh: "R1" } },
    "GET /me/": { status: 200, body: STUDENT },
    "GET /public/routine/": { status: 200, body: { pdf: { available: false, size_bytes: 0, updated_at: null }, exams: [] } },
  });
  await renderApp("/home");
  expect(await screen.findByRole("heading", { name: "Quick access" })).toBeOnTheScreen();
  for (const name of ["Upcoming", "Open now", "Exam routine", "Study materials", "My results", "Past exams", "Packages"]) {
    expect(screen.getByRole("link", { name })).toBeOnTheScreen();
  }
  const user = userEvent.setup();
  await user.press(screen.getByRole("link", { name: "Exam routine" }));
  expect(await screen.findByText("No exams are scheduled right now. Check back soon.")).toBeOnTheScreen();
});
