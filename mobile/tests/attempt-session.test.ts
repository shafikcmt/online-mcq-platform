import { ApiError } from "@/api/errors";
import { AttemptSession, progress, type Deps } from "@/features/attempt/session";
import type { Saved } from "@/features/attempt/storage";
import type { AnswerChange, Room, SaveResult, SubmitResult } from "@/features/attempt/types";

const T0 = Date.parse("2026-10-27T10:00:00Z");
const MIN = 60_000;

function room(overrides: Partial<Room> = {}): Room {
  return {
    attempt_id: "a1",
    attempt_no: 1,
    status: "in_progress",
    server_time: new Date(T0).toISOString(),
    started_at: new Date(T0).toISOString(),
    deadline_at: new Date(T0 + 30 * MIN).toISOString(),
    remaining_seconds: 1800,
    can_edit: true,
    can_submit: true,
    submitted_at: null,
    submit_source: null,
    content_language: "en",
    exam: { slug: "physics", title: "Physics", instructions: "", exam_type: "regular", content_language: "en", duration_minutes: 30, total_questions: 3, negative_marks: "0.00" },
    questions: [1, 2, 3].map((n) => ({
      question_id: n,
      number: n,
      text: `Q${n}`,
      image: null,
      marks: "1.00",
      options: [10, 20, 30, 40].map((o) => ({ id: n * 100 + o, text: `O${o}` })),
      selected_option_id: null,
      is_marked_for_review: false,
    })),
    ...overrides,
  };
}

const saved = (answers: AnswerChange[]): SaveResult => ({
  server_time: new Date(T0).toISOString(),
  deadline_at: new Date(T0 + 30 * MIN).toISOString(),
  remaining_seconds: 1800,
  answers: answers.map((a) => ({ question_id: a.question_id, status: "saved", selected_option_id: a.selected_option_id ?? null, is_marked_for_review: a.is_marked_for_review ?? false })),
});

const submitted = (source: "manual" | "client_timeout"): SubmitResult => ({
  ...room(),
  status: "submitted",
  submit_source: source,
  submitted_at: new Date(T0).toISOString(),
  can_edit: false,
  can_submit: false,
  remaining_seconds: 0,
  answers: [],
  result_available: true,
  result: null,
});

const network = () => new ApiError({ status: 0, code: "network_error", message: "" });

function setup(overrides: Partial<Deps> = {}, initial: Saved = { pending: {}, submitKey: null }) {
  let now = T0;
  let store: Saved = initial;
  const deps = {
    save: jest.fn(async (_id: string, items: AnswerChange[]) => saved(items)),
    submit: jest.fn(async (_id: string, source: "manual" | "client_timeout") => submitted(source)),
    fetch: jest.fn(async () => room({ status: "submitted" })),
    now: () => now,
    load: jest.fn(async () => store),
    store: jest.fn(async (_id: string, next: Saved) => {
      store = next;
    }),
    clear: jest.fn(async () => {
      store = { pending: {}, submitKey: null };
    }),
    debounceMs: 400,
    retryMs: 5_000,
    ...overrides,
  };
  return {
    deps,
    advance: (ms: number) => {
      now += ms;
    },
    stored: () => store,
  };
}

async function settle(ms = 0) {
  await jest.advanceTimersByTimeAsync(ms);
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("a choice shows at once, is kept on the phone, then saved in one batch", async () => {
  const { deps, stored } = setup();
  const session = await AttemptSession.open(room(), deps);
  session.select(1, 110);
  session.toggleMark(2);
  expect(session.getState().answers[1]).toEqual({ selected: 110, marked: false });
  expect(Object.keys(stored().pending)).toEqual(["1", "2"]);
  expect(deps.save).not.toHaveBeenCalled(); // debounced
  await settle(400);
  expect(deps.save).toHaveBeenCalledTimes(1);
  expect((deps.save as jest.Mock).mock.calls[0][1].map((item: AnswerChange) => item.question_id)).toEqual([1, 2]);
  expect(session.getState().pending).toEqual({});
  expect(session.getState().sync).toBe("saved");
  expect(stored().pending).toEqual({});
});

test("offline: changes stay pending and are retried after a pause", async () => {
  const { deps, advance } = setup({ save: jest.fn().mockRejectedValueOnce(network()).mockImplementation(async (_id, items) => saved(items)) });
  const session = await AttemptSession.open(room(), deps);
  session.select(1, 120);
  await settle(400);
  expect(session.getState().sync).toBe("offline");
  expect(session.getState().pending[1].selected_option_id).toBe(120);
  advance(1_000);
  session.tick();
  expect(deps.save).toHaveBeenCalledTimes(1); // not before the retry pause
  advance(5_000);
  session.tick();
  await settle();
  expect(deps.save).toHaveBeenCalledTimes(2);
  expect(session.getState().sync).toBe("saved");
});

test("a change made while saving is not lost when the earlier save returns", async () => {
  let release: (value: SaveResult) => void = () => {};
  const save = jest
    .fn()
    .mockImplementationOnce((_id: string, items: AnswerChange[]) => new Promise<SaveResult>((resolve) => (release = () => resolve(saved(items)))))
    .mockImplementation(async (_id: string, items: AnswerChange[]) => saved(items));
  const { deps, advance } = setup({ save });
  const session = await AttemptSession.open(room(), deps);
  session.select(1, 110);
  await settle(400); // first save in flight
  advance(1_000);
  session.select(1, 130); // changed again
  release(saved([])); // the first save returns after the second change
  await settle(400);
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls.at(-1)[1][0].selected_option_id).toBe(130);
  expect(session.getState().pending).toEqual({});
});

test("stale: the server already has a newer answer, and it wins", async () => {
  const save = jest.fn(async () => ({ ...saved([]), answers: [{ question_id: 1, status: "stale" as const, selected_option_id: 140, is_marked_for_review: true }] }));
  const { deps } = setup({ save });
  const session = await AttemptSession.open(room(), deps);
  session.select(1, 110);
  await settle(400);
  expect(session.getState().answers[1]).toEqual({ selected: 140, marked: true });
  expect(session.getState().pending).toEqual({});
});

test("resume: unsent changes from before the app closed are applied and sent", async () => {
  const change: AnswerChange = { question_id: 2, selected_option_id: 220, client_saved_at: new Date(T0).toISOString() };
  const { deps } = setup({}, { pending: { 2: change, 99: { ...change, question_id: 99 } }, submitKey: null });
  const session = await AttemptSession.open(room(), deps);
  expect(session.getState().answers[2].selected).toBe(220);
  await settle();
  expect((deps.save as jest.Mock).mock.calls[0][1]).toEqual([change]); // unknown question 99 dropped
});

test("at the deadline the room submits by itself with what is still pending; no edits after", async () => {
  const { deps, advance, stored } = setup({ save: jest.fn().mockRejectedValue(network()) });
  const session = await AttemptSession.open(room(), deps);
  session.select(3, 310);
  await settle(400);
  advance(30 * MIN);
  session.select(1, 110); // after the deadline: ignored
  expect(session.getState().answers[1].selected).toBeNull();
  session.tick();
  await settle();
  expect(deps.submit).toHaveBeenCalledTimes(1);
  const [, source, answers, key] = (deps.submit as jest.Mock).mock.calls[0];
  expect(source).toBe("client_timeout");
  expect(answers.map((a: AnswerChange) => a.question_id)).toEqual([3]);
  expect(key).toMatch(/^[A-Za-z0-9._:-]{1,64}$/);
  expect(session.getState().phase).toBe("finished");
  expect(session.getState().timedOut).toBe(true);
  expect(stored()).toEqual({ pending: {}, submitKey: null });
});

test("a manual submit that fails can be retried with the same Idempotency-Key", async () => {
  const submit = jest.fn().mockRejectedValueOnce(network()).mockImplementation(async () => submitted("manual"));
  const { deps } = setup({ submit });
  const session = await AttemptSession.open(room(), deps);
  await session.submit("manual");
  expect(session.getState().phase).toBe("active");
  expect(session.getState().submitError).toBeTruthy();
  await session.submit("manual");
  expect(session.getState().phase).toBe("finished");
  expect(submit.mock.calls[0][3]).toBe(submit.mock.calls[1][3]);
});

test("a timed-out submit keeps retrying until the server answers", async () => {
  const submit = jest.fn().mockRejectedValueOnce(network()).mockImplementation(async () => submitted("client_timeout"));
  const { deps, advance } = setup({ submit });
  const session = await AttemptSession.open(room(), deps);
  advance(30 * MIN);
  session.tick();
  await settle();
  expect(session.getState().phase).toBe("submitting");
  advance(5_000);
  session.tick();
  await settle();
  expect(session.getState().phase).toBe("finished");
  expect(submit).toHaveBeenCalledTimes(2);
});

test("the server says the deadline passed (410): hand it in", async () => {
  const { deps } = setup({ save: jest.fn().mockRejectedValue(new ApiError({ status: 410, code: "attempt_deadline_passed", message: "Time is up." })) });
  const session = await AttemptSession.open(room(), deps);
  session.select(1, 110);
  await settle(400);
  expect(deps.submit).toHaveBeenCalledWith("a1", "client_timeout", expect.any(Array), expect.any(String));
});

test("already finished elsewhere (409): reload and show it as finished", async () => {
  const { deps } = setup({ save: jest.fn().mockRejectedValue(new ApiError({ status: 409, code: "attempt_not_in_progress", message: "" })) });
  const session = await AttemptSession.open(room(), deps);
  session.select(1, 110);
  await settle(400);
  expect(deps.fetch).toHaveBeenCalled();
  expect(session.getState().phase).toBe("finished");
});

test("opening a finished attempt shows it as finished and forgets local data", async () => {
  const { deps } = setup({}, { pending: { 1: { question_id: 1, selected_option_id: 110, client_saved_at: "x" } }, submitKey: "k" });
  const session = await AttemptSession.open(room({ status: "auto_submitted" }), deps);
  expect(session.getState().phase).toBe("finished");
  expect(deps.clear).toHaveBeenCalled();
  expect(deps.save).not.toHaveBeenCalled();
});

test("progress counts answered, marked and unanswered", async () => {
  const { deps } = setup();
  const session = await AttemptSession.open(room(), deps);
  session.select(1, 110);
  session.toggleMark(1);
  session.toggleMark(2);
  expect(progress(session.getState())).toEqual({ answered: 1, marked: 2, unanswered: 2, total: 3 });
  session.select(1, null); // clearing an answer
  expect(progress(session.getState()).answered).toBe(0);
});
