"use client";

import { ArrowLeft, ArrowRight, CircleSlash, Info, ShieldAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { ActiveBadge } from "@/components/content/catalog-cells";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import type { AdminUserDetail } from "@/types/users";

import { MaskedValue, RoleBadge, VerifiedBadge, languageKey } from "./user-cells";

/** One user, read-only: profile, account state and activity counts. Contact details are
 * shown exactly as the API masks them. Only the Results count links on — the attempts,
 * subscriptions and payments screens do not exist yet, and say so as plain text. */
export function UserDetail({ user }: { user: AdminUserDetail }) {
  const { locale, t } = useI18n();

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link href="/users" className="inline-flex items-center gap-1.5 rounded-control text-sm text-ink-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden />
          {t("userDetail.back")}
        </Link>
        <header className="space-y-2">
          <p className="text-sm font-medium text-ink-muted">{t("userDetail.title")}</p>
          <h1 className="text-2xl font-semibold tracking-tight break-words text-ink">{user.full_name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <RoleBadge role={user.role} />
            <ActiveBadge active={user.is_active} />
          </div>
        </header>
      </div>

      <div className="space-y-2 rounded-card border border-line bg-neutral-50/70 px-4 py-3 text-sm text-ink-muted">
        <p className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("userDetail.maskedHint")}
        </p>
        <p className="flex items-start gap-2">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("userDetail.readOnly")}
        </p>
      </div>

      <section aria-labelledby="user-activity" className="space-y-3">
        <h2 id="user-activity" className="text-[15px] font-semibold text-ink">
          {t("userDetail.sectionActivity")}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <CountCard label={t("userDetail.results")} value={user.results_count} href={`/results?user=${user.id}`} linkLabel={t("userDetail.viewResults")} />
          <CountCard label={t("userDetail.attempts")} value={user.attempts_count} />
          <CountCard label={t("userDetail.activeSubscriptions")} value={user.active_subscriptions_count} />
          <CountCard label={t("userDetail.payments")} value={user.payments_count} />
        </ul>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section id="user-profile" title={t("userDetail.sectionProfile")}>
          <Item label={t("userDetail.fullName")}>{user.full_name}</Item>
          <Item label={t("userDetail.displayName")}>
            {user.display_name || <span className="text-ink-subtle">{t("userDetail.notSet")}</span>}
          </Item>
          <Item label={t("userDetail.mobile")}>
            <MaskedValue value={user.mobile_display} />
          </Item>
          <Item label={t("userDetail.email")}>
            {user.email_display ? <MaskedValue value={user.email_display} /> : <span className="text-ink-subtle">{t("users.noEmail")}</span>}
          </Item>
          <Item label={t("userDetail.language")}>{t(languageKey(user.preferred_language))}</Item>
        </Section>

        <Section id="user-account" title={t("userDetail.sectionAccount")}>
          <Item label={t("userDetail.role")}>
            <RoleBadge role={user.role} />
          </Item>
          <Item label={t("userDetail.status")}>
            <ActiveBadge active={user.is_active} />
          </Item>
          <Item label={t("userDetail.verified")}>
            <VerifiedBadge verified={user.is_mobile_verified} />
          </Item>
          <Item label={t("userDetail.joined")}>{formatDateTime(user.date_joined, locale)}</Item>
          <Item label={t("userDetail.updated")}>{formatDateTime(user.updated_at, locale)}</Item>
        </Section>
      </div>
    </div>
  );
}

function CountCard({ label, value, href, linkLabel }: { label: string; value: number; href?: string; linkLabel?: string }) {
  const { locale, t } = useI18n();
  return (
    <li className="flex flex-col justify-between gap-3 rounded-card border border-line bg-surface p-4" data-count-card>
      <div>
        <p className="text-sm text-ink-muted">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-ink tabular-nums">{formatNumber(value, locale)}</p>
      </div>
      {href ? (
        <Link
          href={href}
          className="inline-flex items-center gap-1 rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-600"
        >
          {linkLabel}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      ) : (
        // Plain text, not a disabled link: there is nothing to focus or click.
        <p className="inline-flex items-center gap-1.5 text-xs text-ink-subtle" data-not-available>
          <CircleSlash className="size-3.5" aria-hidden />
          {t("userDetail.notAvailable")}
        </p>
      )}
    </li>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-card border border-line bg-surface">
      <h2 id={id} className="border-b border-line px-5 py-3.5 text-[15px] font-semibold text-ink">
        {title}
      </h2>
      <dl className="grid gap-x-6 gap-y-4 px-5 py-5 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-sm break-words text-ink">{children}</dd>
    </div>
  );
}
