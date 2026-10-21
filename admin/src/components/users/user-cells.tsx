"use client";

import { BadgeCheck, CircleDashed, EyeOff, ShieldCheck, UserRound } from "lucide-react";

import { useI18n } from "@/lib/i18n/provider";
import type { AdminUser } from "@/types/users";

/** Role label with an icon (never colour alone). */
export function RoleBadge({ role }: { role: AdminUser["role"] }) {
  const { t } = useI18n();
  const Icon = role === "admin" ? ShieldCheck : UserRound;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-50 px-2.5 py-0.5 text-xs font-medium text-neutral-700 ring-1 ring-neutral-700/15 ring-inset">
      <Icon className="size-3.5" aria-hidden />
      {t(role === "admin" ? "role.admin" : "role.student")}
    </span>
  );
}

export function VerifiedBadge({ verified }: { verified: boolean }) {
  const { t } = useI18n();
  const Icon = verified ? BadgeCheck : CircleDashed;
  return (
    <span className={verified ? "inline-flex items-center gap-1.5 text-success-700" : "inline-flex items-center gap-1.5 text-ink-muted"}>
      <Icon className="size-4 shrink-0" aria-hidden />
      {t(verified ? "users.verified" : "users.unverified")}
    </span>
  );
}

export function languageKey(language: string) {
  return language === "bn" ? ("language.bn" as const) : ("language.en" as const);
}

/** A masked value as the API sent it. The screen-reader text says it is partly hidden;
 * there is no reveal, copy action or tooltip, and the full value never reaches the page. */
export function MaskedValue({ value }: { value: string }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" data-masked="true">
      <EyeOff className="size-3.5 shrink-0 text-ink-subtle" aria-hidden />
      <span className="font-mono text-[13px] break-all tabular-nums">{value}</span>
      <span className="sr-only"> ({t("users.masked")})</span>
    </span>
  );
}

/** Masked mobile number and email (or "No email"). */
export function ContactCell({ user }: { user: AdminUser }) {
  const { t } = useI18n();
  return (
    <span className="block min-w-0 space-y-0.5 text-ink-muted">
      <span className="block">
        <MaskedValue value={user.mobile_display} />
      </span>
      <span className="block">
        {user.email_display ? <MaskedValue value={user.email_display} /> : <span className="text-[13px] text-ink-subtle">{t("users.noEmail")}</span>}
      </span>
    </span>
  );
}

/** A user's name (and nickname when it differs). */
export function UserName({ user, linked = false }: { user: AdminUser; linked?: boolean }) {
  return (
    <span className="block min-w-0">
      <span
        className={
          linked
            ? "block font-medium break-words text-ink group-hover:text-brand-700 group-hover:underline"
            : "block font-medium break-words text-ink"
        }
      >
        {user.full_name}
      </span>
      {user.display_name && user.display_name !== user.full_name && (
        <span className="block text-[13px] break-words text-ink-subtle">{user.display_name}</span>
      )}
    </span>
  );
}
