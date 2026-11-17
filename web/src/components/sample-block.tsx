import { Users } from "lucide-react";

import { decimal, digits } from "@/lib/format";
import type { Lang, T } from "@/lib/i18n";
import type { SampleList } from "@/lib/sample";

import { Chip } from "./cards";

/** The sample participants of an exam, under the real merit list: a heading and a note that say they
 * are not real students, a "Sample" label on every row, and no position column. A small line may
 * say where the marks would stand in the real list: a comparison in words, never a rank. */
export function SampleBlock({ data, lang, t }: { data: SampleList; lang: Lang; t: T }) {
  if (data.count === 0) return null;
  return (
    <section aria-labelledby="sample-participants" className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="sample-participants" className="flex items-center gap-2 text-lg font-semibold text-ink">
          <Users className="size-5 shrink-0 text-ink-subtle" aria-hidden />
          {t("merit.sampleTitle")}
        </h2>
        <p className="text-sm text-ink-muted">{t("merit.sampleCount", { n: digits(data.count, lang) })}</p>
      </div>
      <p className="mt-1 text-sm text-ink-muted">{t("merit.sampleNote")}</p>
      <div className="mt-3 overflow-x-auto rounded-card border border-dashed border-line-strong bg-surface">
        <table className="w-full text-sm">
          <caption className="sr-only">{t("merit.sampleTitle")}</caption>
          <thead className="bg-neutral-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            <tr>
              <th scope="col" className="px-4 py-3">{t("merit.name")}</th>
              <th scope="col" className="px-4 py-3 text-right">{t("merit.marks")}</th>
              <th scope="col" className="hidden px-4 py-3 text-right sm:table-cell">{t("merit.percent")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.results.map((row, index) => (
              <tr key={`${row.name}-${index}`}>
                <th scope="row" className="px-4 py-3 text-left font-medium text-ink">
                  <span className="mr-2">{row.name}</span>
                  <Chip tone="neutral">{t("merit.sampleLabel")}</Chip>
                  {row.position_by_marks ? <span className="mt-0.5 block text-xs font-normal text-ink-muted">{t("merit.samplePosition", { n: digits(row.position_by_marks, lang) })}</span> : null}
                </th>
                <td className="px-4 py-3 text-right tabular-nums text-ink">
                  {decimal(row.marks, lang)} / {decimal(data.total_marks, lang)}
                </td>
                <td className="hidden px-4 py-3 text-right tabular-nums text-ink sm:table-cell">{digits(`${decimal(row.percentage, "en")}%`, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
