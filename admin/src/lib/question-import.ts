import type { ImportRowError } from "@/types/question-import";

/** A spreadsheet runs a cell that starts with = + - @ as a formula. Text we write into a CSV
 * (the error report holds the student-facing question text) gets a leading apostrophe. */
export function csvCell(value: unknown): string {
  let text = String(value ?? "").replace(/\r?\n/g, " ");
  if (/^[=+\-@\t]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** The downloadable error report: one line per problem, UTF-8 with a BOM so Excel shows
 * Bangla correctly. */
export function errorReportCsv(errors: ImportRowError[], labels: { row: string; field: string; problem: string }): string {
  const lines = [[labels.row, labels.field, "code", labels.problem].map(csvCell).join(",")];
  for (const error of errors) lines.push([error.row, error.field, error.code, error.message].map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

export const IMPORT_ACCEPT = ".csv,.xlsx";
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
