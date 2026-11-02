"use client";

import { ArrowLeft, Info } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { packageName } from "@/components/packages/package-cells";
import { MaskedValue } from "@/components/users/user-cells";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import type { AdminSubscription } from "@/types/subscriptions";

import { SubscriptionActions } from "./subscription-actions";
import { EffectiveStatusBadge, SubscriptionState } from "./subscription-cells";

/** One subscription: the server's effective status (and the stored one), the period,
 * what was paid, and links to the student, the package and the payments that created or
 * extended it (none for a manual grant). Actions: extend (or grant the package again once
 * it ended) and cancel — see SubscriptionActions. No payment actions. */
export function SubscriptionDetail({ subscription }: { subscription: AdminSubscription }) {
  const { locale, t } = useI18n();
  const pkgName = packageName(subscription.package, locale);
  const when = (iso: string) => formatDateTime(iso, locale);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link href="/subscriptions" className="inline-flex items-center gap-1.5 rounded-control text-sm text-ink-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden />
          {t("subscriptionDetail.back")}
        </Link>
        <header className="space-y-2">
          <p className="text-sm font-medium text-ink-muted">
            {t("subscriptionDetail.title")} <span className="tabular-nums">#{subscription.id}</span>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight break-words text-ink">
            <Link href={`/users/${subscription.user.id}`} className="rounded-control hover:text-brand-700 hover:underline">
              {subscription.user.full_name}
            </Link>
          </h1>
          <p className="text-sm break-words">
            <Link href={`/packages/${subscription.package.id}`} lang={pkgName.lang} className="rounded-control text-brand-700 hover:underline">
              {pkgName.text || subscription.package.slug}
            </Link>
          </p>
          <SubscriptionState subscription={subscription} />
        </header>
        <SubscriptionActions subscription={subscription} />
      </div>

      <div className="space-y-2 rounded-card border border-line bg-neutral-50/70 px-4 py-3 text-sm text-ink-muted">
        <p className="flex items-start gap-2">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("subscriptionDetail.actionsNote")}
        </p>
        <p className="flex items-start gap-2">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("subscriptionDetail.statusNote")}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section id="subscription-period" title={t("subscriptionDetail.sectionPeriod")}>
          <Item label={t("subscriptionDetail.effective")}>
            <EffectiveStatusBadge status={subscription.effective_status} />
          </Item>
          <Item label={t("subscriptionDetail.stored")}>{t(`stored.${subscription.status}`)}</Item>
          <Item label={t("subscriptionDetail.starts")}>{when(subscription.starts_at)}</Item>
          <Item label={t("subscriptionDetail.expires")}>{when(subscription.expires_at)}</Item>
          <Item label={t("subscriptionDetail.pricePaid")}>
            <span className="tabular-nums">{formatMoney(subscription.price_paid, subscription.currency, locale)}</span>
          </Item>
        </Section>

        <Section id="subscription-record" title={t("subscriptionDetail.sectionRecord")}>
          <Item label={t("subscriptionDetail.student")}>
            <Link href={`/users/${subscription.user.id}`} className="rounded-control text-brand-700 hover:underline">
              {subscription.user.full_name}
            </Link>
          </Item>
          <Item label={t("subscriptionDetail.mobile")}>
            <MaskedValue value={subscription.user.mobile_display} />
          </Item>
          <Item label={t("subscriptionDetail.package")}>
            <Link href={`/packages/${subscription.package.id}`} lang={pkgName.lang} className="rounded-control text-brand-700 hover:underline">
              {pkgName.text || subscription.package.slug}
            </Link>
          </Item>
          <Item label={t("subscriptionDetail.created")}>{when(subscription.created_at)}</Item>
          <Item label={t("subscriptionDetail.updated")}>{when(subscription.updated_at)}</Item>
        </Section>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm sm:justify-end">
        <Link href={`/subscriptions?user=${subscription.user.id}`} className="rounded-control font-medium text-brand-700 underline underline-offset-2 hover:text-brand-600">
          {t("subscriptionDetail.studentSubscriptions")}
        </Link>
        <Link href={`/subscriptions?package=${subscription.package.id}`} className="rounded-control font-medium text-brand-700 underline underline-offset-2 hover:text-brand-600">
          {t("subscriptionDetail.packageSubscriptions")}
        </Link>
        <Link href={`/payments?subscription=${subscription.id}`} className="rounded-control font-medium text-brand-700 underline underline-offset-2 hover:text-brand-600">
          {t("subscriptionDetail.viewPayments")}
        </Link>
      </div>
    </div>
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
