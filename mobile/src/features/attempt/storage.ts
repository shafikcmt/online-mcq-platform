import AsyncStorage from "@react-native-async-storage/async-storage";

import type { AnswerChange } from "./types";

/** Answer changes not yet confirmed by the server, kept on the phone so a closed app or a
 * dropped connection loses nothing that was chosen before the deadline. Also the submit
 * Idempotency-Key, so a submit retried after a restart cannot count twice. Not secret:
 * the student's own choices — never answer keys (the app never has them). */
export type Saved = { pending: Record<number, AnswerChange>; submitKey: string | null };

const key = (attemptId: string) => `mcq.attempt.${attemptId}`;

export async function loadSaved(attemptId: string): Promise<Saved> {
  try {
    const raw = await AsyncStorage.getItem(key(attemptId));
    const parsed = raw ? (JSON.parse(raw) as Partial<Saved>) : {};
    return { pending: parsed.pending ?? {}, submitKey: parsed.submitKey ?? null };
  } catch {
    return { pending: {}, submitKey: null };
  }
}

export async function storeSaved(attemptId: string, saved: Saved): Promise<void> {
  try {
    await AsyncStorage.setItem(key(attemptId), JSON.stringify(saved));
  } catch {
    // Storage full or unavailable: the answers are still sent to the server.
  }
}

export async function clearSaved(attemptId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key(attemptId));
  } catch {
    // Nothing to do.
  }
}
