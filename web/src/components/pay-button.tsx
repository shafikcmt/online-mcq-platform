"use client";

import { useFormStatus } from "react-dom";

import { cn } from "@/lib/cn";

/** The submit button of a checkout form: disabled while the request runs, so a double
 * click cannot start two payments (the server also de-duplicates by idempotency key). */
export function PayButton({ label, busyLabel, variant = "primary", disabled = false }: { label: string; busyLabel: string; variant?: "primary" | "secondary"; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending || undefined}
      className={cn(
        "inline-flex min-h-11 w-full items-center justify-center rounded-control px-5 font-semibold disabled:opacity-70",
        variant === "primary" ? "bg-brand-600 text-white hover:bg-brand-700" : "border border-brand-600 bg-surface text-brand-700 hover:bg-brand-50",
      )}
    >
      {pending ? busyLabel : label}
    </button>
  );
}
