"use client";

import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

import { FieldError, Input, Textarea, describedBy } from "./form";

/** The bilingual editor pattern: one piece of content entered in Bangla and English,
 * side by side on wide screens and stacked on phones. Each box has its own label and
 * `lang` (correct font shaping and screen-reader voice). When the server reports the same
 * error for both languages (e.g. "at least one is required") it is shown once, for the
 * group, and both boxes are marked invalid. */
export function BilingualField({
  id,
  label,
  hint,
  values,
  onChange,
  errors = {},
  multiline = false,
  rows = 3,
  maxLength,
  required = false,
  disabled = false,
  legendHidden = false,
}: {
  id: string;
  label: string;
  hint?: string;
  values: { bn: string; en: string };
  onChange: (lang: "bn" | "en", value: string) => void;
  errors?: { bn?: string; en?: string };
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  /** At least one language is required (the backend rule); neither box alone is. */
  required?: boolean;
  disabled?: boolean;
  /** The label is already shown nearby (e.g. an option header): keep it for screen readers only. */
  legendHidden?: boolean;
}) {
  const { t } = useI18n();
  const shared = errors.bn && errors.bn === errors.en ? errors.bn : undefined;
  const groupId = `${id}-group`;

  return (
    <fieldset aria-describedby={describedBy(groupId, { hint, error: shared })} className="min-w-0">
      <legend className={cn("mb-1.5 flex items-baseline gap-1.5 text-sm font-medium text-ink", legendHidden && "sr-only")}>
        {label}
        {required && (
          <span className="text-danger-700" aria-hidden>
            *
          </span>
        )}
      </legend>
      {hint && (
        <p id={`${groupId}-hint`} className="-mt-0.5 mb-2 text-[13px] text-ink-subtle">
          {hint}
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {(["bn", "en"] as const).map((lang) => {
          const controlId = `${id}_${lang}`;
          const ownError = shared ? undefined : errors[lang];
          const value = values[lang];
          const counterId = `${controlId}-count`;
          const describers = [
            describedBy(controlId, { error: ownError }),
            shared ? `${groupId}-error` : "",
            hint ? `${groupId}-hint` : "",
            maxLength ? counterId : "",
          ]
            .filter(Boolean)
            .join(" ");
          const common = {
            id: controlId,
            lang,
            value,
            disabled,
            maxLength,
            invalid: Boolean(ownError || shared),
            "aria-describedby": describers || undefined,
          };
          return (
            <div key={lang} className="min-w-0">
              <div className="mb-1 flex items-center justify-between gap-2">
                <label htmlFor={controlId} className="text-[13px] font-medium text-ink-muted">
                  {t(lang === "bn" ? "bilingual.bn" : "bilingual.en")}
                </label>
                {maxLength && (
                  <span
                    id={counterId}
                    className={cn(
                      "text-xs tabular-nums",
                      value.length > maxLength * 0.9 ? "text-warning-700" : "text-ink-subtle",
                    )}
                  >
                    {t("bilingual.count", { n: value.length, max: maxLength })}
                  </span>
                )}
              </div>
              {multiline ? (
                <Textarea {...common} rows={rows} onChange={(event) => onChange(lang, event.target.value)} />
              ) : (
                <Input {...common} onChange={(event) => onChange(lang, event.target.value)} />
              )}
              <FieldError id={controlId} message={ownError} />
            </div>
          );
        })}
      </div>
      <FieldError id={groupId} message={shared} />
    </fieldset>
  );
}
