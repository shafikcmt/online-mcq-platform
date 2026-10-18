"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";

import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { ApiError, apiFetch, ensureCsrfToken } from "@/lib/api/client";
import { describeError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

type Field = "mobile_number" | "password";

export function LoginForm({ next, expired }: { next: string; expired: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const ids = { mobile: useId(), password: useId(), error: useId() };
  const [values, setValues] = useState({ mobile_number: "", password: "" });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(expired ? t("login.expired") : null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void ensureCsrfToken(); // the sign-in request is CSRF-protected
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const missing: Partial<Record<Field, string>> = {};
    if (!values.mobile_number.trim()) missing.mobile_number = t("login.required");
    if (!values.password) missing.password = t("login.required");
    setFieldErrors(missing);
    if (Object.keys(missing).length) return;

    setSubmitting(true);
    setFormError(null);
    try {
      await apiFetch("/admin/auth/login/", { method: "POST", body: values });
      router.replace(next);
      router.refresh();
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      const mapped: Partial<Record<Field, string>> = {};
      for (const field of ["mobile_number", "password"] as Field[]) {
        const messages = apiError?.fieldErrors[field];
        if (messages?.length) mapped[field] = messages[0];
      }
      setFieldErrors(mapped);
      setFormError(describeError(error, t));
      setSubmitting(false);
    }
  }

  const input =
    "h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:border-brand-600 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand-600/30 aria-[invalid=true]:border-danger-700";

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex justify-center">
          <Logo size="lg" />
        </div>
        <div className="rounded-dialog border border-line bg-surface p-6 shadow-sm sm:p-8">
          <h1 className="text-xl font-semibold text-ink">{t("login.title")}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t("login.subtitle")}</p>

          {formError && (
            <div
              id={ids.error}
              role="alert"
              className="mt-5 flex gap-2.5 rounded-control border border-danger-700/20 bg-danger-50 px-3 py-2.5 text-sm text-danger-700"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{formError}</span>
            </div>
          )}

          <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate aria-describedby={formError ? ids.error : undefined}>
            <div>
              <label htmlFor={ids.mobile} className="mb-1.5 block text-sm font-medium text-ink">
                {t("login.mobile")}
              </label>
              <input
                id={ids.mobile}
                name="mobile_number"
                inputMode="tel"
                autoComplete="username"
                className={input}
                value={values.mobile_number}
                aria-invalid={Boolean(fieldErrors.mobile_number)}
                aria-describedby={fieldErrors.mobile_number ? `${ids.mobile}-error` : undefined}
                onChange={(e) => setValues((v) => ({ ...v, mobile_number: e.target.value }))}
                placeholder="01XXXXXXXXX"
              />
              {fieldErrors.mobile_number && (
                <p id={`${ids.mobile}-error`} className="mt-1.5 text-xs text-danger-700">
                  {fieldErrors.mobile_number}
                </p>
              )}
            </div>
            <div>
              <label htmlFor={ids.password} className="mb-1.5 block text-sm font-medium text-ink">
                {t("login.password")}
              </label>
              <input
                id={ids.password}
                name="password"
                type="password"
                autoComplete="current-password"
                className={input}
                value={values.password}
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={fieldErrors.password ? `${ids.password}-error` : undefined}
                onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
              />
              {fieldErrors.password && (
                <p id={`${ids.password}-error`} className="mt-1.5 text-xs text-danger-700">
                  {fieldErrors.password}
                </p>
              )}
            </div>
            <Button type="submit" size="lg" className={cn("w-full")} disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" aria-hidden />}
              {submitting ? t("login.submitting") : t("login.submit")}
            </Button>
          </form>
        </div>
        <p className="mt-6 text-center text-xs text-ink-subtle">{t("login.footer")}</p>
      </div>
    </main>
  );
}
