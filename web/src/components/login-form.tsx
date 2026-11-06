"use client";

import { useActionState, useState } from "react";

import { signIn, type LoginState } from "@/app/[lang]/account/actions";
import { cn } from "@/lib/cn";

type Labels = {
  mobile: string;
  password: string;
  submit: string;
  submitting: string;
  errors: Record<NonNullable<LoginState["error"]>, string>;
};

const INITIAL: LoginState = { error: null };

/** Sign-in with the mobile number and password of the app account. The password is sent
 * to the server action and nowhere else; the page never shows it back. */
export function LoginForm({ lang, next, labels }: { lang: string; next: string; labels: Labels }) {
  const [state, action, pending] = useActionState(signIn, INITIAL);
  // React clears an uncontrolled form after the action runs; keep the mobile number so a
  // mistyped password only means typing the password again (the password is cleared).
  const [mobile, setMobile] = useState("");
  const input = cn("mt-1 block w-full rounded-control border border-line-strong bg-surface px-3 py-2.5 text-base text-ink");
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="next" value={next} />
      {state.error ? (
        <p role="alert" className="rounded-control border border-danger-700/20 bg-danger-50 p-3 text-sm font-medium text-danger-700">
          {labels.errors[state.error]}
        </p>
      ) : null}
      <div>
        <label htmlFor="account-mobile" className="text-sm font-medium text-ink">
          {labels.mobile}
        </label>
        <input
          id="account-mobile"
          name="mobile_number"
          type="tel"
          inputMode="numeric"
          autoComplete="username"
          required
          maxLength={30}
          value={mobile}
          onChange={(event) => setMobile(event.target.value)}
          className={input}
        />
      </div>
      <div>
        <label htmlFor="account-password" className="text-sm font-medium text-ink">
          {labels.password}
        </label>
        <input id="account-password" name="password" type="password" autoComplete="current-password" required maxLength={128} className={input} />
      </div>
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending || undefined}
        className="inline-flex min-h-12 items-center justify-center rounded-control bg-brand-600 px-6 font-semibold text-white hover:bg-brand-700 disabled:opacity-70"
      >
        {pending ? labels.submitting : labels.submit}
      </button>
    </form>
  );
}
