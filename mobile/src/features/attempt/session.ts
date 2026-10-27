import { isApiError } from "@/api/errors";
import { serverNow } from "@/lib/server-clock";

import { fetchAttempt, saveAnswers, submitAttempt } from "./api";
import { clearSaved, loadSaved, storeSaved, type Saved } from "./storage";
import type { AnswerChange, Room, SubmitResult } from "./types";

/** One student's attempt while the exam room is open.
 *
 * - Every choice shows at once and is kept as *pending* (on the phone too), then sent
 *   to the server (debounced, as one batch). The server is the record: it answers per
 *   question `saved`, `stale` (it already has a newer change — its value wins) or
 *   `deadline_passed`.
 * - Unsent changes are retried every few seconds after a connection drop and sent again
 *   on the next start (resume after the app was closed).
 * - The deadline is the server's `deadline_at`, compared with the server clock; at the
 *   deadline the room submits by itself (`client_timeout`). Answers change only before
 *   the deadline (the server enforces it too).
 * - Submit carries any still-pending answers and a stored Idempotency-Key, and is retried
 *   after a timeout until the server answers (it finalizes late attempts itself).
 *
 * Plain TypeScript (no React) so the rules can be tested on their own; the screen
 * subscribes to it. */
export type Phase = "active" | "submitting" | "finished";
export type SyncStatus = "saved" | "saving" | "offline";
export type Answer = { selected: number | null; marked: boolean };

export type SessionState = {
  room: Room;
  answers: Record<number, Answer>;
  pending: Record<number, AnswerChange>;
  current: number;
  sync: SyncStatus;
  phase: Phase;
  /** Set when the room submitted by itself because time ran out. */
  timedOut: boolean;
  result: SubmitResult | null;
  /** A problem saving that retrying will not fix (e.g. access ended). */
  blocked: unknown;
  /** The last submit failure (shown while retrying or after a manual submit failed). */
  submitError: unknown;
};

export type Deps = {
  save: typeof saveAnswers;
  submit: typeof submitAttempt;
  fetch: typeof fetchAttempt;
  now: () => number;
  load: (id: string) => Promise<Saved>;
  store: (id: string, saved: Saved) => Promise<void>;
  clear: (id: string) => Promise<void>;
  debounceMs: number;
  retryMs: number;
};

const DEFAULTS: Deps = {
  save: saveAnswers,
  submit: submitAttempt,
  fetch: fetchAttempt,
  now: serverNow,
  load: loadSaved,
  store: storeSaved,
  clear: clearSaved,
  debounceMs: 400,
  retryMs: 5_000,
};

function newKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export class AttemptSession {
  private state: SessionState;
  private listeners = new Set<() => void>();
  private deps: Deps;
  private submitKey: string | null;
  private saving = false;
  private submitting = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private nextRetryAt = 0;
  private disposed = false;

  private constructor(room: Room, saved: Saved, deps: Deps) {
    this.deps = deps;
    this.submitKey = saved.submitKey;
    const answers: Record<number, Answer> = {};
    for (const question of room.questions) {
      answers[question.question_id] = { selected: question.selected_option_id, marked: question.is_marked_for_review };
    }
    // Changes the server never confirmed (app closed or offline) are newer than its copy.
    const pending: Record<number, AnswerChange> = {};
    for (const change of Object.values(saved.pending)) {
      if (!(change.question_id in answers)) continue;
      pending[change.question_id] = change;
      answers[change.question_id] = applyChange(answers[change.question_id], change);
    }
    const finished = room.status !== "in_progress";
    this.state = {
      room,
      answers,
      pending: finished ? {} : pending,
      current: 0,
      sync: "saved",
      phase: finished ? "finished" : "active",
      timedOut: false,
      result: null,
      blocked: null,
      submitError: null,
    };
  }

  /** Opens a session for a room payload (start or resume), restoring unsent changes. */
  static async open(room: Room, deps: Partial<Deps> = {}): Promise<AttemptSession> {
    const all = { ...DEFAULTS, ...deps };
    const saved = await all.load(room.attempt_id);
    const session = new AttemptSession(room, saved, all);
    if (session.state.phase === "finished") await all.clear(room.attempt_id);
    else if (Object.keys(session.state.pending).length) void session.flush();
    return session;
  }

  // ----- subscription (useSyncExternalStore) -----
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;

  private set(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  get deadline(): number {
    return Date.parse(this.state.room.deadline_at);
  }

  canEdit(now = this.deps.now()): boolean {
    return this.state.phase === "active" && now < this.deadline;
  }

  // ----- student actions -----
  goTo(index: number) {
    const last = this.state.room.questions.length - 1;
    this.set({ current: Math.max(0, Math.min(last, index)) });
  }

  select(questionId: number, optionId: number | null) {
    this.change(questionId, { selected_option_id: optionId });
  }

  toggleMark(questionId: number) {
    const answer = this.state.answers[questionId];
    if (answer) this.change(questionId, { is_marked_for_review: !answer.marked });
  }

  private change(questionId: number, fields: Pick<AnswerChange, "selected_option_id" | "is_marked_for_review">) {
    if (!this.canEdit() || !(questionId in this.state.answers)) return;
    const merged: AnswerChange = {
      ...this.state.pending[questionId],
      ...fields,
      question_id: questionId,
      client_saved_at: new Date(this.deps.now()).toISOString(),
    };
    this.set({
      answers: { ...this.state.answers, [questionId]: applyChange(this.state.answers[questionId], merged) },
      pending: { ...this.state.pending, [questionId]: merged },
    });
    this.persist();
    this.scheduleFlush(this.deps.debounceMs);
  }

  // ----- saving -----
  private persist() {
    void this.deps.store(this.state.room.attempt_id, { pending: this.state.pending, submitKey: this.submitKey });
  }

  private scheduleFlush(delay: number) {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, delay);
  }

  /** Sends every pending change in one request. Safe to call any time. */
  async flush(): Promise<void> {
    if (this.saving || this.disposed || this.state.phase !== "active") return;
    const sent = { ...this.state.pending };
    const items = Object.values(sent);
    if (!items.length) {
      if (this.state.sync !== "saved") this.set({ sync: "saved" });
      return;
    }
    this.saving = true;
    this.set({ sync: "saving" });
    try {
      const result = await this.deps.save(this.state.room.attempt_id, items);
      if (this.state.phase !== "active") return; // submitted meanwhile (with these answers)
      const pending = { ...this.state.pending };
      const answers = { ...this.state.answers };
      for (const item of result.answers) {
        const unchanged = pending[item.question_id]?.client_saved_at === sent[item.question_id]?.client_saved_at;
        if (!unchanged) continue; // changed again meanwhile: the newer change is still to send
        delete pending[item.question_id];
        if (item.status === "stale") answers[item.question_id] = { selected: item.selected_option_id, marked: item.is_marked_for_review };
      }
      this.set({ pending, answers, sync: Object.keys(pending).length ? "saving" : "saved", blocked: null });
      this.persist();
      if (Object.keys(pending).length) this.scheduleFlush(0);
    } catch (error) {
      if (this.state.phase === "active") this.onSaveError(error);
    } finally {
      this.saving = false;
    }
  }

  private onSaveError(error: unknown) {
    if (isApiError(error) && error.code === "attempt_deadline_passed") {
      void this.submit("client_timeout");
      return;
    }
    if (isApiError(error) && error.code === "attempt_not_in_progress") {
      void this.reloadFinished();
      return;
    }
    if (isApiError(error) && error.status === 403) {
      this.set({ sync: "offline", blocked: error });
      return;
    }
    // No connection, server trouble or rate limit: keep the changes and try again.
    this.nextRetryAt = this.deps.now() + this.deps.retryMs;
    this.set({ sync: "offline" });
  }

  private async reloadFinished() {
    try {
      const room = await this.deps.fetch(this.state.room.attempt_id);
      if (room.status !== "in_progress") {
        await this.deps.clear(room.attempt_id);
        this.set({ room, phase: "finished", pending: {}, sync: "saved" });
      }
    } catch {
      this.nextRetryAt = this.deps.now() + this.deps.retryMs;
    }
  }

  // ----- clock -----
  /** Called every second by the screen: auto-submit at the deadline, retries. */
  tick(now = this.deps.now()) {
    if (this.disposed) return;
    const { phase, pending, sync } = this.state;
    if (phase === "active" && now >= this.deadline) {
      void this.submit("client_timeout");
      return;
    }
    if (now < this.nextRetryAt) return;
    if (phase === "active" && sync === "offline" && !this.state.blocked && Object.keys(pending).length) void this.flush();
    if (phase === "submitting" && this.state.timedOut && this.state.submitError && !this.submitting) void this.submit("client_timeout");
  }

  // ----- submit -----
  async submit(source: "manual" | "client_timeout"): Promise<void> {
    if (this.disposed || this.state.phase === "finished" || this.submitting) return;
    if (this.state.phase === "submitting" && !this.state.submitError) return;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (!this.submitKey) {
      this.submitKey = newKey();
      this.persist();
    }
    const timedOut = this.state.timedOut || source === "client_timeout";
    this.set({ phase: "submitting", timedOut, submitError: null });
    this.submitting = true;
    try {
      const result = await this.deps.submit(this.state.room.attempt_id, timedOut ? "client_timeout" : "manual", Object.values(this.state.pending), this.submitKey);
      await this.deps.clear(this.state.room.attempt_id);
      this.set({ phase: "finished", result, pending: {}, sync: "saved", room: { ...this.state.room, ...stripAnswers(result) } });
    } catch (error) {
      this.nextRetryAt = this.deps.now() + this.deps.retryMs;
      // After the deadline there is nothing left to answer: keep trying to hand it in.
      this.set(timedOut ? { submitError: error } : { phase: "active", submitError: error });
    } finally {
      this.submitting = false;
    }
  }

  dismissSubmitError() {
    this.set({ submitError: null });
  }

  dispose() {
    this.disposed = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.listeners.clear();
  }
}

function applyChange(answer: Answer, change: AnswerChange): Answer {
  return {
    selected: change.selected_option_id !== undefined ? change.selected_option_id : answer.selected,
    marked: change.is_marked_for_review !== undefined ? change.is_marked_for_review : answer.marked,
  };
}

function stripAnswers({ answers: _answers, result: _result, result_available: _available, ...summary }: SubmitResult) {
  return summary;
}

/** Counts for the palette and the submit summary. */
export function progress(state: SessionState) {
  let answered = 0;
  let marked = 0;
  for (const question of state.room.questions) {
    const answer = state.answers[question.question_id];
    if (answer?.selected != null) answered += 1;
    if (answer?.marked) marked += 1;
  }
  return { answered, marked, unanswered: state.room.questions.length - answered, total: state.room.questions.length };
}
