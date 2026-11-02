"use client";

import { CheckCircle2, Send } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { LIMITS, serverFieldErrors, validateContact, type ContactFields, type FieldErrors, type FieldKey } from "@/lib/contact";

type Labels = Record<
  | "name" | "phoneField" | "emailField" | "either" | "requiredNote" | "subject" | "message" | "honeypot" | "send" | "sending"
  | "required" | "needContact" | "invalidEmail" | "sent" | "another" | "fix" | "throttled" | "failed",
  string
>;

const EMPTY: ContactFields = { name: "", phone: "", email: "", subject: "", message: "", website: "" };

/** The Contact form. It posts to the public API on the site's own origin (nginx routes it
 * to the backend; see next.config.ts), in the page's language so the backend's messages
 * match. `website` is a honeypot: hidden from people (and from screen readers), so only
 * bots fill it; the backend then answers like a success and stores nothing. */
export function ContactForm({ lang, labels }: { lang: string; labels: Labels }) {
  const [fields, setFields] = useState<ContactFields>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [alert, setAlert] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);

  function set(key: keyof ContactFields, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
    if (key !== "website" && errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
  }

  function focusFirstError(found: FieldErrors) {
    const first = (Object.keys(LIMITS) as FieldKey[]).find((key) => found[key]);
    if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "sending") return;
    const local = validateContact(fields);
    if (Object.keys(local).length) {
      const shown = Object.fromEntries(Object.entries(local).map(([key, code]) => [key, labels[code]])) as FieldErrors;
      setErrors(shown);
      setAlert(labels.fix);
      focusFirstError(shown);
      return;
    }
    setState("sending");
    setAlert("");
    try {
      const response = await fetch("/api/v1/public/contact/", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "Accept-Language": lang },
        body: JSON.stringify(fields),
      });
      if (response.status === 202) {
        setState("sent");
        setFields(EMPTY);
        setErrors({});
        requestAnimationFrame(() => doneRef.current?.focus());
        return;
      }
      setState("idle");
      if (response.status === 429) return setAlert(labels.throttled);
      const body: unknown = await response.json().catch(() => null);
      const server = response.status === 400 ? serverFieldErrors(body) : {};
      if (Object.keys(server).length) {
        setErrors(server);
        setAlert(labels.fix);
        focusFirstError(server);
      } else setAlert(labels.failed);
    } catch {
      setState("idle");
      setAlert(labels.failed);
    }
  }

  if (state === "sent") {
    return (
      <div ref={doneRef} tabIndex={-1} role="status" className="flex flex-col items-start gap-4 rounded-card border border-success-700/20 bg-success-50 p-6 outline-none">
        <p className="flex items-start gap-2 font-semibold text-success-700">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
          {labels.sent}
        </p>
        <button type="button" onClick={() => setState("idle")} className="min-h-11 rounded-control px-3 font-semibold text-brand-700 hover:bg-brand-50">
          {labels.another}
        </button>
      </div>
    );
  }

  const input = (invalid: boolean) =>
    cn(
      "mt-1 block w-full rounded-control border bg-surface px-3 py-2.5 text-base text-ink",
      invalid ? "border-danger-700 focus-visible:outline-danger-700" : "border-line-strong",
    );
  const field = (key: FieldKey, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={`contact-${key}`} className="text-sm font-medium text-ink">
        {label}
        {props.required ? <RequiredMark /> : null}
      </label>
      <input
        id={`contact-${key}`}
        name={key}
        value={fields[key]}
        onChange={(event) => set(key, event.target.value)}
        maxLength={LIMITS[key]}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={errors[key] ? `contact-${key}-error` : undefined}
        className={input(!!errors[key])}
        {...props}
      />
      {errors[key] ? (
        <p id={`contact-${key}-error`} className="mt-1 text-sm text-danger-700">
          {errors[key]}
        </p>
      ) : null}
    </div>
  );

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-4">
      {alert ? (
        <p role="alert" className="rounded-control border border-danger-700/20 bg-danger-50 p-3 text-sm font-medium text-danger-700">
          {alert}
        </p>
      ) : null}
      <p className="text-sm text-ink-muted">{labels.requiredNote}</p>
      {field("name", labels.name, { autoComplete: "name", required: true })}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm text-ink-muted sm:col-span-2">{labels.either}</legend>
        {field("phone", labels.phoneField, { type: "tel", inputMode: "tel", autoComplete: "tel" })}
        {field("email", labels.emailField, { type: "email", autoComplete: "email" })}
      </fieldset>
      {field("subject", labels.subject, { required: true })}
      <div>
        <label htmlFor="contact-message" className="text-sm font-medium text-ink">
          {labels.message}
          <RequiredMark />
        </label>
        <textarea
          id="contact-message"
          name="message"
          rows={6}
          value={fields.message}
          onChange={(event) => set("message", event.target.value)}
          maxLength={LIMITS.message}
          required
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={errors.message ? "contact-message-error" : undefined}
          className={input(!!errors.message)}
        />
        {errors.message ? (
          <p id="contact-message-error" className="mt-1 text-sm text-danger-700">
            {errors.message}
          </p>
        ) : null}
      </div>
      {/* Honeypot: off-screen, not focusable, hidden from assistive technology. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="contact-website">{labels.honeypot}</label>
        <input id="contact-website" name="website" tabIndex={-1} autoComplete="off" value={fields.website} onChange={(event) => set("website", event.target.value)} />
      </div>
      <button
        type="submit"
        disabled={state === "sending"}
        className="inline-flex min-h-12 items-center justify-center gap-2 self-start rounded-control bg-brand-600 px-6 font-semibold text-white hover:bg-brand-700 disabled:opacity-70"
      >
        <Send className="size-4" aria-hidden />
        {state === "sending" ? labels.sending : labels.send}
      </button>
    </form>
  );
}

/** The visible "*" of a required field; screen readers hear "required" from the input. */
function RequiredMark() {
  return (
    <span className="ml-1 text-danger-700" aria-hidden>
      *
    </span>
  );
}
