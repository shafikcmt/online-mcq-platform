import { api } from "@/api/client";
import { syncServerClock } from "@/lib/server-clock";

import type { AnswerChange, Room, SaveResult, SubmitResult } from "./types";

/** Start a new attempt, or get the open one back (the server decides; same payload). */
export async function startAttempt(slug: string): Promise<Room> {
  const room = await api<Room>(`/exams/${encodeURIComponent(slug)}/attempts/`, { method: "POST", body: {} });
  syncServerClock(room.server_time);
  return room;
}

/** Resume: questions, saved answers and timing as the server has them now. */
export async function fetchAttempt(id: string): Promise<Room> {
  const room = await api<Room>(`/attempts/${encodeURIComponent(id)}/`);
  syncServerClock(room.server_time);
  return room;
}

/** Saves changed answers in one transaction (also after a connection drop). */
export async function saveAnswers(id: string, answers: AnswerChange[]): Promise<SaveResult> {
  const result = await api<SaveResult>(`/attempts/${encodeURIComponent(id)}/answers/`, { method: "PUT", body: { answers } });
  syncServerClock(result.server_time);
  return result;
}

/** Final submit; the same Idempotency-Key makes a retried submit safe. */
export async function submitAttempt(
  id: string,
  source: "manual" | "client_timeout",
  answers: AnswerChange[],
  idempotencyKey: string,
): Promise<SubmitResult> {
  const result = await api<SubmitResult>(`/attempts/${encodeURIComponent(id)}/submit/`, {
    method: "POST",
    body: answers.length ? { source, answers } : { source },
    headers: { "Idempotency-Key": idempotencyKey },
  });
  syncServerClock(result.server_time);
  return result;
}
