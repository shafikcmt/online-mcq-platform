"use client";

import { AlertCircle } from "lucide-react";
import {
  createContext,
  forwardRef,
  useContext,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/** Form building blocks. Every control gets a visible <label>; hints and errors are tied
 * to it with aria-describedby, and an error also sets aria-invalid (not colour alone). */
const CONTROL =
  "w-full rounded-control border bg-surface px-3 text-sm text-ink shadow-xs placeholder:text-ink-subtle transition-colors focus:outline-none focus-visible:border-brand-600 focus-visible:ring-2 focus-visible:ring-brand-600/25 disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-ink-subtle";

export function controlClass(invalid?: boolean, className?: string) {
  return cn(CONTROL, invalid ? "border-danger-700" : "border-line-strong", className);
}

export function describedBy(id: string, { hint, error }: { hint?: ReactNode; error?: string }) {
  const ids = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

/** A control inside <Field> picks up its id, description and error state from here. */
type FieldState = { id: string; describedBy?: string; invalid: boolean; required?: boolean };
const FieldContext = createContext<FieldState | null>(null);

function useControlProps<P extends { id?: string; invalid?: boolean; required?: boolean; "aria-describedby"?: string }>(props: P) {
  const field = useContext(FieldContext);
  const { invalid, ...rest } = props;
  const isInvalid = invalid ?? field?.invalid ?? false;
  return {
    isInvalid,
    controlProps: {
      ...rest,
      id: props.id ?? field?.id,
      required: props.required ?? field?.required,
      "aria-describedby": props["aria-describedby"] ?? field?.describedBy,
      "aria-invalid": isInvalid || undefined,
    },
  };
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={`${id}-error`} className="mt-1.5 flex items-start gap-1.5 text-[13px] text-danger-700">
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{message}</span>
    </p>
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  required,
  optional,
  className,
  labelLang,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  optional?: boolean;
  className?: string;
  labelLang?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={id} lang={labelLang} className="mb-1.5 flex items-baseline gap-1.5 text-sm font-medium text-ink">
        {label}
        {required && (
          <span className="text-danger-700" aria-hidden>
            *
          </span>
        )}
        {required && <span className="sr-only">{t("form.requiredMark")}</span>}
        {optional && <span className="text-xs font-normal text-ink-subtle">({t("common.optional")})</span>}
      </label>
      <FieldContext.Provider value={{ id, describedBy: describedBy(id, { hint, error }), invalid: Boolean(error), required }}>
        {children}
      </FieldContext.Provider>
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-[13px] text-ink-subtle">
          {hint}
        </p>
      )}
      <FieldError id={id} message={error} />
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, ...props }, ref) {
  const { isInvalid, controlProps } = useControlProps(props);
  return <input ref={ref} className={controlClass(isInvalid, cn("h-9", className))} {...controlProps} />;
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, ...props }, ref) {
  const { isInvalid, controlProps } = useControlProps(props);
  return (
    <textarea
      ref={ref}
      className={controlClass(isInvalid, cn("min-h-20 resize-y py-2 leading-relaxed", className))}
      {...controlProps}
    />
  );
});

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, ...props }, ref) {
  const { isInvalid, controlProps } = useControlProps(props);
  return <select ref={ref} className={controlClass(isInvalid, cn("h-9 pr-8", className))} {...controlProps} />;
});

/** On/off setting as a labelled checkbox styled as a switch (native semantics). */
export function Switch({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="peer h-5 w-9 cursor-pointer appearance-none rounded-full bg-line-strong transition-colors checked:bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4"
        />
      </span>
      <span className="min-w-0">
        <label htmlFor={id} className="block cursor-pointer text-sm font-medium text-ink">
          {label}
        </label>
        {hint && (
          <span id={`${id}-hint`} className="block text-[13px] text-ink-subtle">
            {hint}
          </span>
        )}
      </span>
    </div>
  );
}

export function FormSection({
  title,
  description,
  children,
  className,
  aside,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  aside?: ReactNode;
}) {
  const headingId = `section-${title.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <section aria-labelledby={headingId} className={cn("rounded-card border border-line bg-surface", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 id={headingId} className="text-[15px] font-semibold text-ink">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>}
        </div>
        {aside}
      </header>
      <div className="space-y-5 px-5 py-5">{children}</div>
    </section>
  );
}

/** Form-level errors (non-field messages, and messages for fields the form does not
 * show). Rendered as an alert so it is announced when it appears. */
export function FormErrors({ messages, title }: { messages: string[]; title?: string }) {
  if (!messages.length) return null;
  return (
    <div role="alert" className="rounded-card border border-danger-700/25 bg-danger-50 px-4 py-3 text-sm text-danger-700">
      <p className="flex items-center gap-2 font-medium">
        <AlertCircle className="size-4 shrink-0" aria-hidden />
        {title}
      </p>
      <ul className={cn("mt-1 space-y-0.5", title ? "pl-6" : "")}>
        {messages.map((message, index) => (
          <li key={index}>{message}</li>
        ))}
      </ul>
    </div>
  );
}
