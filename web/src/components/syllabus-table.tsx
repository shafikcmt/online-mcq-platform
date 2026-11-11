import { digits } from "@/lib/format";
import type { Lang } from "@/lib/i18n";
import type { SyllabusLine } from "@/lib/api";

type Labels = { subject: string; chapter: string; topic: string };

/** An exam's syllabus: a table on wide screens, stacked lines on a phone (each value then
 * carries its own label). Text comes from the admin and is rendered escaped. */
export function SyllabusTable({ lines, labels, lang }: { lines: SyllabusLine[]; labels: Labels; lang: Lang }) {
  const columns = ["subject", "chapter", "topic"] as const;
  return (
    <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface">
      <div className="hidden grid-cols-[2.5rem_1fr_1fr_1fr] gap-x-4 border-b border-line bg-brand-50 px-4 py-2 text-xs font-semibold text-ink-muted md:grid">
        <span aria-hidden>#</span>
        {columns.map((column) => (
          <span key={column}>{labels[column]}</span>
        ))}
      </div>
      <ol className="divide-y divide-line">
        {lines.map((line, index) => (
          <li key={index} className="grid gap-1 px-4 py-3 text-sm md:grid-cols-[2.5rem_1fr_1fr_1fr] md:gap-x-4">
            <span className="font-semibold text-ink-subtle tabular-nums">{digits(index + 1, lang)}</span>
            {columns.map((column) => (
              <span key={column} className={line[column] ? "text-ink" : "text-ink-subtle"}>
                <span className="mr-1 text-xs text-ink-subtle md:hidden">{labels[column]}:</span>
                {line[column] || "—"}
              </span>
            ))}
          </li>
        ))}
      </ol>
    </div>
  );
}
