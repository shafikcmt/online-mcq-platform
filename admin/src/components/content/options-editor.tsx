"use client";

import { ArrowDown, ArrowUp, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { useRef } from "react";

import { BilingualField } from "@/components/ui/bilingual-field";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/form";
import { OPTION_TEXT_MAX_LENGTH } from "@/lib/content-limits";
import { useI18n } from "@/lib/i18n/provider";
import { emptyOption, moveOption, setCorrect, type OptionDraft } from "@/lib/question-form";
import { cn } from "@/lib/utils";

/** The option set of a question, edited as a whole: add, remove, reorder, and pick the
 * single correct answer (radio buttons — two correct options cannot be selected).
 * `errors` uses the API's keys: `options` for set-level messages and
 * `options.N.text_bn` / `options.N.text_en` for one option (N = position sent). */
export function OptionsEditor({
  options,
  onChange,
  errors,
  disabled = false,
}: {
  options: OptionDraft[];
  onChange: (options: OptionDraft[]) => void;
  errors: Record<string, string>;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const addRef = useRef<HTMLButtonElement>(null);
  const setError = errors.options;

  return (
    <div className="space-y-4">
      {setError && (
        <div id="q-options-error" role="alert" className="rounded-control border border-danger-700/25 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {setError}
        </div>
      )}
      <ol className="space-y-3" aria-describedby={setError ? "q-options-error" : undefined}>
        {options.map((option, index) => {
          const n = index + 1;
          const correctId = `q-option-${option.key}-correct`;
          const correctError = errors[`options.${index}.is_correct`];
          return (
            <li
              key={option.key}
              className={cn(
                "rounded-card border p-4 transition-colors",
                option.is_correct ? "border-success-700/40 bg-success-50/50" : "border-line bg-surface",
              )}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                  <span className="text-sm font-semibold text-ink">{t("options.option", { n })}</span>
                  <label htmlFor={correctId} className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink-muted">
                    <input
                      id={correctId}
                      type="radio"
                      name="q-correct-option"
                      checked={option.is_correct}
                      disabled={disabled}
                      onChange={() => onChange(setCorrect(options, option.key))}
                      aria-label={t("options.markCorrect", { n })}
                      className="size-4 accent-success-700"
                    />
                    <span aria-hidden>{t("options.correct")}</span>
                  </label>
                  {option.is_correct && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success-50 px-2 py-0.5 text-xs font-medium text-success-700 ring-1 ring-success-700/20 ring-inset">
                      <CheckCircle2 className="size-3.5" aria-hidden />
                      {t("options.correctAnswer")}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onChange(moveOption(options, index, -1))}
                    disabled={disabled || index === 0}
                    aria-label={t("options.moveUp", { n })}
                    title={t("options.moveUp", { n })}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onChange(moveOption(options, index, 1))}
                    disabled={disabled || index === options.length - 1}
                    aria-label={t("options.moveDown", { n })}
                    title={t("options.moveDown", { n })}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      onChange(options.filter((item) => item.key !== option.key));
                      addRef.current?.focus(); // the removed row's button is gone
                    }}
                    disabled={disabled || options.length <= 1}
                    aria-label={t("options.remove", { n })}
                    title={t("options.remove", { n })}
                    className="hover:bg-danger-50 hover:text-danger-700"
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </div>
              <BilingualField
                id={`q-option-${option.key}`}
                label={t("options.option", { n })}
                legendHidden
                maxLength={OPTION_TEXT_MAX_LENGTH}
                disabled={disabled}
                values={{ bn: option.text_bn, en: option.text_en }}
                onChange={(lang, value) =>
                  onChange(
                    options.map((item) =>
                      item.key === option.key ? { ...item, [lang === "bn" ? "text_bn" : "text_en"]: value } : item,
                    ),
                  )
                }
                errors={{ bn: errors[`options.${index}.text_bn`], en: errors[`options.${index}.text_en`] }}
              />
              <FieldError id={correctId} message={correctError} />
            </li>
          );
        })}
      </ol>
      <Button
        ref={addRef}
        variant="secondary"
        onClick={() => onChange([...options, emptyOption()])}
        disabled={disabled}
      >
        <Plus aria-hidden />
        {t("options.add")}
      </Button>
    </div>
  );
}
