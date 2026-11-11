import type { SyllabusLineData } from "@/types/syllabus";

/** Editor state for the syllabus. `key` is a client-only id for React lists (never sent). */
export type SyllabusLine = SyllabusLineData & { key: string };

export const SYLLABUS_MAX_LINES = 200;
export const SYLLABUS_MAX_LENGTH = 150;

let counter = 0;
export const lineKey = () => `syl-${(counter += 1)}`;

export const blankLine = (): SyllabusLine => ({ key: lineKey(), subject: "", chapter: "", topic: "" });

export const fromServer = (rows: SyllabusLineData[]): SyllabusLine[] => rows.map((row) => ({ key: lineKey(), ...row }));

const isBlank = (line: SyllabusLineData) => !line.subject.trim() && !line.chapter.trim() && !line.topic.trim();

/** What is sent: lines in order, without the rows left completely blank (a stray empty row
 * must not block saving); the server checks the rest. */
export function toPayload(lines: SyllabusLine[]): SyllabusLineData[] {
  return lines.filter((line) => !isBlank(line)).map(({ subject, chapter, topic }) => ({ subject, chapter, topic }));
}

/** Same content as the saved list? (blank rows and client keys do not count). */
export function sameSyllabus(lines: SyllabusLine[], saved: SyllabusLineData[]): boolean {
  const now = toPayload(lines);
  return now.length === saved.length && now.every((line, index) => line.subject === saved[index].subject && line.chapter === saved[index].chapter && line.topic === saved[index].topic);
}

export function moveLine(lines: SyllabusLine[], index: number, delta: -1 | 1): SyllabusLine[] {
  const target = index + delta;
  if (target < 0 || target >= lines.length) return lines;
  const next = [...lines];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
