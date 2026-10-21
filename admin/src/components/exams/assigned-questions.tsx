"use client";

import { AlertTriangle, ArrowDown, ArrowUp, CircleSlash, X } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";

import { LanguageBadge } from "@/components/content/question-cells";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { moveQuestion, removeQuestion, setMarks, type AssignedQuestion } from "@/lib/exam-questions";
import { formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { localized } from "@/lib/localized";

/** The exam's question list as an ordered list: position, text, marks override, Move
 * up/down (buttons — keyboard and screen-reader friendly, no drag library) and Remove.
 * Every change only edits the local list; "Save question list" sends all of it. */
export function AssignedQuestions({
  items,
  onChange,
  defaultMarks,
  disabled,
  problems,
  marksErrors,
  announce,
  addButtonRef,
}: {
  items: AssignedQuestion[];
  onChange: (items: AssignedQuestion[]) => void;
  defaultMarks: string;
  disabled: boolean;
  /** Question ids the server named in its messages. */
  problems: Set<number>;
  /** Server errors per question id (from the save's per-row field errors). */
  marksErrors: Record<number, string>;
  announce: (message: string) => void;
  addButtonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const { locale, t } = useI18n();
  const listRef = useRef<HTMLOListElement>(null);

  /** After a re-order the row's DOM node moves; put focus back on the same control (or
   * its sibling when it is now disabled at the top/bottom). */
  function refocus(id: number, preferred: "up" | "down") {
    requestAnimationFrame(() => {
      const row = listRef.current?.querySelector<HTMLElement>(`[data-question-row="${id}"]`);
      const first = row?.querySelector<HTMLButtonElement>(`[data-move="${preferred}"]`);
      const other = row?.querySelector<HTMLButtonElement>(`[data-move="${preferred === "up" ? "down" : "up"}"]`);
      (first && !first.disabled ? first : other)?.focus();
    });
  }

  function move(index: number, delta: -1 | 1) {
    const id = items[index].question;
    onChange(moveQuestion(items, index, delta));
    announce(t("examQuestions.moved", { id, n: formatNumber(index + delta + 1, locale) }));
    refocus(id, delta < 0 ? "up" : "down");
  }

  function remove(index: number) {
    const id = items[index].question;
    const neighbour = items[index + 1]?.question ?? items[index - 1]?.question;
    onChange(removeQuestion(items, id));
    announce(t("examQuestions.removed", { id }));
    requestAnimationFrame(() => {
      const target = neighbour
        ? listRef.current?.querySelector<HTMLElement>(`[data-question-row="${neighbour}"] [data-remove]`)
        : addButtonRef.current;
      target?.focus();
    });
  }

  return (
    <ol ref={listRef} aria-label={t("examQuestions.list")} className="divide-y divide-line rounded-card border border-line">
      {items.map((item, index) => {
        const text = localized(locale, item.text_bn, item.text_en);
        const problem = problems.has(item.question);
        const marksError = marksErrors[item.question];
        const marksId = `exam-q-marks-${item.question}`;
        return (
          <li
            key={item.question}
            data-question-row={item.question}
            className={problem || marksError ? "bg-warning-50/60" : undefined}
          >
            <div className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-start sm:gap-4 sm:px-4">
              <div className="flex min-w-0 flex-1 gap-3">
                <span
                  className="mt-0.5 inline-flex h-6 min-w-7 shrink-0 items-center justify-center rounded-full bg-neutral-50 px-1.5 text-xs font-semibold tabular-nums text-ink-muted ring-1 ring-line"
                  aria-label={t("examQuestions.position", { n: formatNumber(index + 1, locale) })}
                >
                  {formatNumber(index + 1, locale)}
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/questions/${item.question}`}
                    className="line-clamp-2 rounded-control break-words text-sm text-ink hover:text-brand-700 hover:underline"
                    lang={text.lang}
                    target="_blank"
                    rel="noopener"
                  >
                    {text.text || t("questions.noText")}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-subtle">
                    <span className="tabular-nums">#{item.question}</span>
                    <LanguageBadge language={item.available_languages} />
                    {!item.is_active && (
                      <span className="inline-flex items-center gap-1 text-ink-muted">
                        <CircleSlash className="size-3.5" aria-hidden />
                        {t("examQuestions.inactive")}
                      </span>
                    )}
                    {problem && (
                      <span className="inline-flex items-center gap-1 font-medium text-warning-700">
                        <AlertTriangle className="size-3.5" aria-hidden />
                        {t("examQuestions.problem")}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-2 pl-10 sm:pl-0">
                <div className="w-24">
                  <label htmlFor={marksId} className="sr-only">
                    {t("examQuestions.marksFor", { id: item.question })} ({t("examQuestions.marksDefault", { n: defaultMarks || "—" })})
                  </label>
                  <Input
                    id={marksId}
                    type="number"
                    inputMode="decimal"
                    min={0.01}
                    step={0.01}
                    value={item.marks}
                    placeholder={defaultMarks}
                    title={t("examQuestions.marksDefault", { n: defaultMarks || "—" })}
                    onChange={(event) => onChange(setMarks(items, item.question, event.target.value))}
                    disabled={disabled}
                    invalid={Boolean(marksError)}
                    aria-describedby={marksError ? `${marksId}-error` : undefined}
                    className="h-8"
                  />
                  {marksError && (
                    <p id={`${marksId}-error`} className="mt-1 text-xs text-danger-700">
                      {marksError}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  data-move="up"
                  onClick={() => move(index, -1)}
                  disabled={disabled || index === 0}
                  aria-label={t("examQuestions.moveUp", { id: item.question })}
                  title={t("examQuestions.moveUp", { id: item.question })}
                >
                  <ArrowUp aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  data-move="down"
                  onClick={() => move(index, 1)}
                  disabled={disabled || index === items.length - 1}
                  aria-label={t("examQuestions.moveDown", { id: item.question })}
                  title={t("examQuestions.moveDown", { id: item.question })}
                >
                  <ArrowDown aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 hover:bg-danger-50 hover:text-danger-700"
                  data-remove
                  onClick={() => remove(index)}
                  disabled={disabled}
                  aria-label={t("examQuestions.remove", { id: item.question })}
                  title={t("examQuestions.remove", { id: item.question })}
                >
                  <X aria-hidden />
                </Button>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
