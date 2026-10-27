import { fireEvent, screen } from "@testing-library/react-native";

import type { HistoryItem, LeaderboardRow, ResultDetail, Review } from "@/features/results/types";

import { apiError, mockBackend, renderApp, resetDevice, STUDENT } from "./helpers";

jest.setTimeout(20_000);

const A1 = "11111111-1111-4111-8111-111111111111";
const A2 = "22222222-2222-4222-8222-222222222222";

function result(overrides: Partial<ResultDetail> = {}): ResultDetail {
  return {
    attempt_id: A1,
    attempt_no: 1,
    status: "submitted",
    exam: { slug: "physics", title: "Physics model test", exam_type: "regular" },
    submitted_at: "2026-10-20T10:00:00Z",
    total_questions: 3,
    correct_count: 2,
    wrong_count: 1,
    unanswered_count: 0,
    positive_marks: "2.00",
    negative_marks_total: "0.25",
    obtained_marks: "1.75",
    total_marks: "3.00",
    percentage: "58.33",
    pass_marks: "1.50",
    is_passed: true,
    time_used_seconds: 750,
    is_merit_counted: true,
    merit_position: 4,
    review_available: true,
    ...overrides,
  };
}

const page = <T,>(results: T[], extra: object = {}) => ({ status: 200, body: { count: results.length, next: null, previous: null, results, ...extra } });

function review(): Review {
  const options = (n: number) => ["Alpha", "Beta", "Gamma"].map((text, i) => ({ id: n * 10 + i, text: `${text} ${n}`, is_correct: i === 0 }));
  return {
    result: result(),
    questions: [
      { question_id: 1, number: 1, text: "First question", image: null, options: options(1), selected_option_id: 10, correct_option_id: 10, is_correct: true, marks: "1.00", awarded_marks: "1.00", is_marked_for_review: false, explanation: "Because alpha." },
      { question_id: 2, number: 2, text: "Second question", image: null, options: options(2), selected_option_id: 21, correct_option_id: 20, is_correct: false, marks: "1.00", awarded_marks: "-0.25", is_marked_for_review: true, explanation: "" },
      { question_id: 3, number: 3, text: "Third question", image: null, options: options(3), selected_option_id: 30, correct_option_id: 30, is_correct: true, marks: "1.00", awarded_marks: "1.00", is_marked_for_review: false, explanation: "" },
    ],
  };
}

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

test("Results tab → result details → answer review with filters", async () => {
  await signedIn(
    {
      "GET /results/": page([result()]),
      [`GET /results/${A1}/`]: { status: 200, body: result() },
      [`GET /results/${A1}/review/`]: { status: 200, body: review() },
    },
    "/results",
  );
  await fireEvent.press(await screen.findByRole("link", { name: "Physics model test, 1.75/3, 58.33%" }));
  expect(await screen.findByText("Deducted for wrong answers")).toBeOnTheScreen();
  expect(screen.getByText("−0.25")).toBeOnTheScreen();
  expect(screen.getByText("12 min 30 s")).toBeOnTheScreen();
  expect(screen.getByText("Passed")).toBeOnTheScreen();
  expect(screen.getByText("4")).toBeOnTheScreen(); // merit position

  await fireEvent.press(screen.getByRole("button", { name: "Review answers" }));
  expect(await screen.findByText("Because alpha.")).toBeOnTheScreen();
  expect(screen.getByLabelText("B. Beta 2, Your answer")).toBeOnTheScreen();
  expect(screen.getByLabelText("A. Alpha 2, Correct answer")).toBeOnTheScreen();
  expect(screen.getByText("Marks: -0.25 of 1")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("radio", { name: "Wrong (1)" }));
  expect(screen.getByText("Second question")).toBeOnTheScreen();
  expect(screen.queryByText("First question")).toBeNull();
  await fireEvent.press(screen.getByRole("radio", { name: "Skipped (0)" }));
  expect(screen.getByText("No questions in this group.")).toBeOnTheScreen();
});

test("History: an open attempt goes back to the room; an unpublished result says so", async () => {
  const now = Date.now();
  const base = { attempt_no: 1, server_time: new Date(now).toISOString(), started_at: new Date(now - 60_000).toISOString(), remaining_seconds: 0, can_edit: false, can_submit: false, submit_source: null };
  const history: HistoryItem[] = [
    { ...base, attempt_id: A1, status: "in_progress", deadline_at: new Date(now + 600_000).toISOString(), submitted_at: null, can_edit: true, can_submit: true, exam: { slug: "chem", title: "Chemistry weekly" } },
    { ...base, attempt_id: A2, status: "submitted", deadline_at: new Date(now).toISOString(), submitted_at: new Date(now).toISOString(), exam: { slug: "bio", title: "Biology final" } },
  ];
  await signedIn(
    {
      "GET /results/": page([]),
      "GET /attempts/": page(history),
      [`GET /results/${A2}/`]: apiError(403, "result_not_visible", "Results are not published yet."),
    },
    "/results",
  );
  expect(await screen.findByText("Your results will appear here after you finish an exam.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("radio", { name: "History" }));
  expect(await screen.findByText("In progress — tap to continue")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("link", { name: "Biology final, Submitted" }));
  expect(await screen.findByText("Your answers were submitted. The result will be shown when the exam's results are published.")).toBeOnTheScreen();
});

test("review not allowed: the details say so and offer no review", async () => {
  await signedIn({ [`GET /results/${A1}/`]: { status: 200, body: result({ review_available: false, merit_position: null }) } }, `/result/${A1}`);
  expect(await screen.findByText("Answer review is not available for this exam.")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Review answers" })).toBeNull();
  expect(screen.getByText("Not ranked yet")).toBeOnTheScreen();
});

test("the review endpoint refusing (403) is explained", async () => {
  await signedIn({ [`GET /results/${A1}/review/`]: apiError(403, "review_not_allowed", "Not allowed.") }, `/review/${A1}`);
  expect(await screen.findByText("Answer review is not available for this exam.")).toBeOnTheScreen();
});

test("leaderboard: my position and my row; names as the server sends them", async () => {
  const rows: LeaderboardRow[] = [
    { position: 1, name: "Aye*** S.", obtained_marks: "3.00", total_marks: "3.00", percentage: "100.00", time_used_seconds: 300, is_me: false },
    { position: 2, name: "Rahim Uddin", obtained_marks: "2.00", total_marks: "3.00", percentage: "66.67", time_used_seconds: 420, is_me: true },
  ];
  await signedIn({ "GET /exams/physics/leaderboard/": page(rows, { my_position: 2 }) }, "/leaderboard/physics");
  expect(await screen.findByText("Your position: 2")).toBeOnTheScreen();
  expect(screen.getByText("2 ranked")).toBeOnTheScreen();
  expect(screen.getByLabelText("Position 1, Aye*** S., 3/3, 100%")).toBeOnTheScreen();
  expect(screen.getByLabelText("Position 2, Rahim Uddin (You), 2/3, 66.67%")).toBeOnTheScreen();
});

test.each([
  ["merit_disabled", 404, "This exam has no leaderboard."],
  ["result_not_visible", 403, "The leaderboard will be shown when the exam's results are published."],
])("leaderboard refused (%s)", async (code, status, message) => {
  await signedIn({ "GET /exams/physics/leaderboard/": apiError(status, code, "x") }, "/leaderboard/physics");
  expect(await screen.findByText(message)).toBeOnTheScreen();
});

test("Bangla result details", async () => {
  await signedIn({ [`GET /results/${A1}/`]: { status: 200, body: result() } }, `/result/${A1}`, "bn");
  expect(await screen.findByText("১.৭৫/৩")).toBeOnTheScreen();
  expect(screen.getByText("৫৮.৩৩%")).toBeOnTheScreen();
  expect(screen.getByText("১২ মিনিট ৩০ সেকেন্ড")).toBeOnTheScreen();
  expect(screen.getByText("উত্তীর্ণ")).toBeOnTheScreen();
});
