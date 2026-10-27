import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, userEvent } from "@testing-library/react-native";

import type { Room, SubmitResult } from "@/features/attempt/types";
import type { StudentExamDetail } from "@/features/exams/types";

import { mockBackend, renderApp, resetDevice, STUDENT } from "./helpers";

jest.setTimeout(30_000);

const MIN = 60_000;
const ID = "6f1c2d3e-1111-4222-8333-944455556666";

function room(overrides: Partial<Room> = {}): Room {
  const now = Date.now();
  return {
    attempt_id: ID,
    attempt_no: 1,
    status: "in_progress",
    server_time: new Date(now).toISOString(),
    started_at: new Date(now).toISOString(),
    deadline_at: new Date(now + 30 * MIN).toISOString(),
    remaining_seconds: 1800,
    can_edit: true,
    can_submit: true,
    submitted_at: null,
    submit_source: null,
    content_language: "en",
    exam: { slug: "physics", title: "Physics model test", instructions: "", exam_type: "regular", content_language: "en", duration_minutes: 30, total_questions: 3, negative_marks: "0.25" },
    questions: [1, 2, 3].map((n) => ({
      question_id: n,
      number: n,
      text: `What is question ${n}?`,
      image: null,
      marks: "1.00",
      options: ["Alpha", "Beta", "Gamma", "Delta"].map((text, i) => ({ id: n * 10 + i, text: `${text} ${n}` })),
      selected_option_id: null,
      is_marked_for_review: false,
    })),
    ...overrides,
  };
}

function detail(overrides: Partial<StudentExamDetail> = {}): StudentExamDetail {
  return {
    slug: "physics",
    title: "Physics model test",
    description: "",
    instructions: "",
    exam_type: "regular",
    access_type: "free",
    content_language: "en",
    category: { slug: "hsc", name: "HSC" },
    subject: null,
    duration_minutes: 30,
    total_questions: 3,
    total_marks: "3.00",
    negative_marks: "0.25",
    pass_marks: null,
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
    server_time: new Date().toISOString(),
    ...overrides,
  };
}

function submitted(source: "manual" | "client_timeout", withResult = true): SubmitResult {
  const { questions: _q, exam: _e, content_language: _c, ...summary } = room();
  return {
    ...summary,
    status: "submitted",
    submit_source: source,
    submitted_at: new Date().toISOString(),
    can_edit: false,
    can_submit: false,
    answers: [],
    result_available: withResult,
    result: withResult
      ? {
          attempt_id: ID,
          total_questions: 3,
          correct_count: 2,
          wrong_count: 1,
          unanswered_count: 0,
          positive_marks: "2.00",
          negative_marks_total: "0.25",
          obtained_marks: "1.75",
          total_marks: "3.00",
          percentage: "58.33",
          pass_marks: null,
          is_passed: null,
        }
      : null,
  };
}

const savedReply = (call: { body: unknown }) => ({
  status: 200,
  body: {
    server_time: new Date().toISOString(),
    deadline_at: room().deadline_at,
    remaining_seconds: 1700,
    answers: (call.body as { answers: { question_id: number; selected_option_id?: number | null; is_marked_for_review?: boolean }[] }).answers.map((a) => ({
      question_id: a.question_id,
      status: "saved",
      selected_option_id: a.selected_option_id ?? null,
      is_marked_for_review: a.is_marked_for_review ?? false,
    })),
  },
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

const wait = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

test("start after a confirmation, answer, autosave, move around, submit and see the result", async () => {
  const backend = await signedIn(
    {
      "GET /exams/physics/": { status: 200, body: detail() },
      "POST /exams/physics/attempts/": { status: 201, body: room() },
      "PUT /attempts/6f1c2d3e-1111-4222-8333-944455556666/answers/": savedReply,
      "POST /attempts/6f1c2d3e-1111-4222-8333-944455556666/submit/": { status: 200, body: submitted("manual") },
    },
    "/exam/physics",
  );
  const footerStart = await screen.findByRole("button", { name: "Start exam" });
  await fireEvent.press(footerStart);
  expect(screen.getByText("You will have 30 min. The timer starts now and keeps running even if you leave the app.")).toBeOnTheScreen();
  expect(backend.find("POST", "/exams/physics/attempts/")).toHaveLength(0); // not before confirming
  await fireEvent.press(screen.getAllByRole("button", { name: "Start exam" }).find((button) => button !== footerStart)!);

  expect(await screen.findByText("What is question 1?")).toBeOnTheScreen();
  expect(screen.getByText("Question 1 of 3")).toBeOnTheScreen();
  expect(screen.getByText("Marks: 1 · Wrong answer: −0.25")).toBeOnTheScreen();
  expect(screen.getByLabelText(/^Time left: /)).toBeOnTheScreen();
  expect(backend.find("GET", `/attempts/${ID}/`)).toHaveLength(0); // the start response was used

  await fireEvent.press(screen.getByRole("radio", { name: "B. Beta 1" }));
  expect(screen.getByRole("radio", { name: "B. Beta 1" })).toBeChecked();
  expect(screen.getByText("Answered 1/3")).toBeOnTheScreen();
  await wait(500);
  const put = backend.find("PUT", `/attempts/${ID}/answers/`);
  expect(put).toHaveLength(1);
  expect((put[0].body as { answers: unknown[] }).answers).toEqual([{ question_id: 1, selected_option_id: 11, client_saved_at: expect.any(String) }]);
  expect(await screen.findByText("All answers saved")).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("What is question 2?")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("checkbox", { name: "Mark for review" }));
  expect(screen.getByRole("checkbox", { name: "Marked for review" })).toBeChecked();

  await fireEvent.press(screen.getByRole("button", { name: "All questions" }));
  expect(screen.getByRole("button", { name: "Question 1: Answered" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Question 2: Not answered, Marked, Current" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Question 3: Not answered" }));
  expect(screen.getByText("What is question 3?")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("radio", { name: "D. Delta 3" }));

  const footerSubmit = screen.getByRole("button", { name: "Submit" });
  await fireEvent.press(footerSubmit);
  expect(screen.getByText("Answered 2 of 3. Not answered: 1. Marked for review: 1. You cannot change answers after submitting.")).toBeOnTheScreen();
  await fireEvent.press(screen.getAllByRole("button", { name: "Submit" }).find((button) => button !== footerSubmit)!);
  expect(await screen.findByText("Answers submitted")).toBeOnTheScreen();
  expect(screen.getByText("1.75/3")).toBeOnTheScreen();
  expect(screen.getByText("58.33%")).toBeOnTheScreen();

  const submit = backend.find("POST", `/attempts/${ID}/submit/`)[0];
  expect(submit.headers["Idempotency-Key"]).toMatch(/^[A-Za-z0-9._:-]{1,64}$/);
  expect((submit.body as { source: string }).source).toBe("manual");
  expect(await AsyncStorage.getItem(`mcq.attempt.${ID}`)).toBeNull(); // nothing left on the phone
});

test("continue (no confirmation) opens the open attempt with its saved answers", async () => {
  const resumed = room();
  resumed.questions[0].selected_option_id = 12;
  await signedIn(
    {
      "GET /exams/physics/": { status: 200, body: detail({ can_start: false, can_resume: true, attempt_state: "in_progress" }) },
      "POST /exams/physics/attempts/": { status: 200, body: resumed },
    },
    "/exam/physics",
  );
  await fireEvent.press(await screen.findByRole("button", { name: "Continue exam" }));
  expect(await screen.findByRole("radio", { name: "C. Gamma 1" })).toBeChecked();
});

test("resume after the app was closed: unsent answers on the phone are restored and sent", async () => {
  const backend = await signedIn(
    {
      [`GET /attempts/${ID}/`]: { status: 200, body: room() },
      [`PUT /attempts/${ID}/answers/`]: savedReply,
    },
    `/attempt/${ID}`,
  );
  // (written before render in a real restart; here right after, then the room re-opens)
  await AsyncStorage.setItem(`mcq.attempt.${ID}`, JSON.stringify({ pending: { 1: { question_id: 1, selected_option_id: 13, client_saved_at: new Date().toISOString() } }, submitKey: null }));
  await renderApp(`/attempt/${ID}`);
  expect(await screen.findByRole("radio", { name: "D. Delta 1" })).toBeChecked();
  await wait(10);
  expect(backend.find("PUT", `/attempts/${ID}/answers/`).at(-1)?.body).toEqual({ answers: [expect.objectContaining({ question_id: 1, selected_option_id: 13 })] });
});

test("no connection: the answer stays on the phone and the room says so", async () => {
  await signedIn({ [`GET /attempts/${ID}/`]: { status: 200, body: room() }, [`PUT /attempts/${ID}/answers/`]: "network" }, `/attempt/${ID}`);
  await fireEvent.press(await screen.findByRole("radio", { name: "A. Alpha 1" }));
  await wait(500);
  expect(await screen.findByText("Not saved yet — kept on this phone, retrying")).toBeOnTheScreen();
  const kept = JSON.parse((await AsyncStorage.getItem(`mcq.attempt.${ID}`)) ?? "{}");
  expect(kept.pending[1].selected_option_id).toBe(10);
});

test("time runs out: the room hands the answers in by itself", async () => {
  const backend = await signedIn(
    {
      [`GET /attempts/${ID}/`]: { status: 200, body: room({ deadline_at: new Date(Date.now() + 3_000).toISOString() }) },
      [`PUT /attempts/${ID}/answers/`]: savedReply,
      [`POST /attempts/${ID}/submit/`]: { status: 200, body: submitted("client_timeout", false) },
    },
    `/attempt/${ID}`,
  );
  expect(await screen.findByText("What is question 1?")).toBeOnTheScreen();
  await wait(4_000);
  expect(await screen.findByText("Time is up — your answers were submitted")).toBeOnTheScreen();
  expect(screen.getByText("Your result will be available when the exam's results are published.")).toBeOnTheScreen();
  expect((backend.find("POST", `/attempts/${ID}/submit/`)[0].body as { source: string }).source).toBe("client_timeout");
});

test("an attempt already submitted opens as finished", async () => {
  await signedIn({ [`GET /attempts/${ID}/`]: { status: 200, body: room({ status: "submitted", can_edit: false, can_submit: false }) } }, `/attempt/${ID}`);
  expect(await screen.findByText("This exam has already been submitted.")).toBeOnTheScreen();
});

test("leaving asks first", async () => {
  await signedIn({ [`GET /attempts/${ID}/`]: { status: 200, body: room() } }, `/attempt/${ID}`);
  const user = userEvent.setup();
  await user.press(await screen.findByRole("button", { name: "Leave" }));
  expect(screen.getByText("Leave the exam room?")).toBeOnTheScreen();
});

test("an exam in both languages can switch the question language; Bangla UI", async () => {
  const both = room({ content_language: "bn" });
  both.exam.content_language = "both";
  both.questions = both.questions.map((q) => ({ ...q, text: `বাংলা প্রশ্ন ${q.number}`, text_bn: `বাংলা প্রশ্ন ${q.number}`, text_en: `Question text ${q.number}`, options: q.options.map((o) => ({ ...o, text_bn: `বিকল্প ${o.id}`, text_en: `Choice ${o.id}` })) }));
  await signedIn({ [`GET /attempts/${ID}/`]: { status: 200, body: both } }, `/attempt/${ID}`, "bn");
  expect(await screen.findByText("বাংলা প্রশ্ন 1")).toBeOnTheScreen();
  expect(screen.getByText("প্রশ্ন ১ / ৩")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("radio", { name: "English" }));
  expect(screen.getByText("Question text 1")).toBeOnTheScreen();
  expect(screen.getByRole("radio", { name: "A. Choice 10" })).toBeOnTheScreen();
});
