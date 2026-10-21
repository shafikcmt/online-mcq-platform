import type { ContentLanguage, Question } from "@/types/content";
import type { ExamQuestionRow } from "@/types/exams";

/** The exam's assigned questions, edited as one ordered list.
 *
 * `PATCH /admin/exams/{id}/questions/` takes the COMPLETE new list and replaces the
 * stored one (apps/exams/services.py `set_exam_questions`). So the editor loads every
 * assigned row, keeps them all while the admin browses the question bank, and always
 * sends the whole list: `sort_order` = position (0…n-1), `marks` = override or null
 * (null → the exam's default marks). Never a partial list, never one row. */
export type AssignedQuestion = {
  question: number;
  /** Override as typed; "" = the exam's default marks. */
  marks: string;
  text_bn: string;
  text_en: string;
  available_languages: ContentLanguage;
  is_active: boolean;
  subject: number;
};

export function fromRows(rows: ExamQuestionRow[]): AssignedQuestion[] {
  return [...rows]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((row) => ({
      question: row.question,
      marks: row.marks ?? "",
      text_bn: row.text_bn,
      text_en: row.text_en,
      available_languages: row.available_languages,
      is_active: row.is_active,
      subject: row.subject,
    }));
}

export function fromBankQuestion(question: Question): AssignedQuestion {
  return {
    question: question.id,
    marks: "",
    text_bn: question.text_bn,
    text_en: question.text_en,
    available_languages: question.available_languages,
    is_active: question.is_active,
    subject: question.subject,
  };
}

export function isAssigned(items: AssignedQuestion[], id: number): boolean {
  return items.some((item) => item.question === id);
}

/** Append at the end; a question already in the list is never added twice. */
export function addQuestion(items: AssignedQuestion[], item: AssignedQuestion): AssignedQuestion[] {
  return isAssigned(items, item.question) ? items : [...items, item];
}

export function removeQuestion(items: AssignedQuestion[], id: number): AssignedQuestion[] {
  return items.filter((item) => item.question !== id);
}

export function moveQuestion(items: AssignedQuestion[], index: number, delta: -1 | 1): AssignedQuestion[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function setMarks(items: AssignedQuestion[], id: number, marks: string): AssignedQuestion[] {
  return items.map((item) => (item.question === id ? { ...item, marks } : item));
}

/** The COMPLETE replacement list for PATCH, in the order shown. */
export function toQuestionsPayload(items: AssignedQuestion[]) {
  return {
    questions: items.map((item, index) => ({
      question: item.question,
      sort_order: index,
      marks: item.marks.trim() === "" ? null : item.marks.trim(),
    })),
  };
}

/** Same list (order and marks) — for the unsaved-changes guard. */
export function sameAssignment(a: AssignedQuestion[], b: AssignedQuestion[]): boolean {
  return JSON.stringify(toQuestionsPayload(a)) === JSON.stringify(toQuestionsPayload(b));
}

/** Total marks as the server computes it (override or default per question), for the
 * live counter only — the server's `total_marks` is the authoritative value. */
export function totalMarks(items: AssignedQuestion[], defaultMarks: string): number | null {
  const fallback = Number(defaultMarks);
  let total = 0;
  for (const item of items) {
    const value = item.marks.trim() === "" ? fallback : Number(item.marks);
    if (!Number.isFinite(value)) return null;
    total += value;
  }
  return Math.round(total * 100) / 100;
}

/** Server messages for the list name questions as "Question #<id> …": pick out the ids
 * so the matching rows can be marked. */
export function questionIdsInMessages(messages: string[]): Set<number> {
  const ids = new Set<number>();
  for (const message of messages) for (const match of message.matchAll(/#(\d+)/g)) ids.add(Number(match[1]));
  return ids;
}
