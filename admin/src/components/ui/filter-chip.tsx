"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "./button";

/** An active list filter shown as a removable chip ("Exam: Physics ×"), with optional
 * extra controls (e.g. "Change exam"). Used by the Results and Attempts lists. */
export function FilterChip({
  prefix,
  label,
  clearLabel,
  onClear,
  extra,
}: {
  prefix: string;
  label: string;
  clearLabel: string;
  onClear: () => void;
  extra?: ReactNode;
}) {
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-brand-600/40 bg-brand-50 py-0.5 pr-1 pl-3 text-sm text-ink">
      <span className="min-w-0 truncate">
        <span className="text-ink-muted">{prefix}: </span>
        <span className="font-medium">{label}</span>
      </span>
      {extra}
      <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={onClear} aria-label={clearLabel} title={clearLabel}>
        <X aria-hidden />
      </Button>
    </span>
  );
}
