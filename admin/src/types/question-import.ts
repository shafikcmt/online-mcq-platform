/** Bulk question import (apps/questions/importer.py): `POST /admin/questions/import/`. */
export type ImportRowError = { row: number; field: string; code: string; message: string };

export type ImportPreviewRow = {
  row: number;
  subject: string;
  question: string;
  options: number;
  correct: string;
  chapter: string;
  topic: string;
};

export type ImportReport = {
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  columns: string[];
  unknown_columns: string[];
  errors: ImportRowError[];
  errors_truncated: boolean;
  preview: ImportPreviewRow[];
  /** Only after an import (not a preview). */
  created?: number;
  skipped?: number;
  aborted?: boolean;
};
