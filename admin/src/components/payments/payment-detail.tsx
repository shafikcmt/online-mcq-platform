"use client";

import { ArrowLeft, Info } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { packageName } from "@/components/packages/package-cells";
import { MaskedValue } from "@/components/users/user-cells";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import type { AdminPaymentDetail } from "@/types/payments";

import { PaymentStatusBadge, codeLabel } from "./payment-cells";
import { PaymentTimeline } from "./payment-timeline";

/** One payment, read-only and allow-listed: the server's status and reason code, the
 * amount snapshot, the student (masked mobile), the package, the subscription it paid
 * for (when the server links one), the provider transaction ID, a four-field summary of
 * the provider's answer and the latest events as short codes. No re-verify, status,
 * retry or refund actions. */
export function PaymentDetail({ payment }: { payment: AdminPaymentDetail }) {
  const { locale, t } = useI18n();
  const pkgName = packageName(payment.package, locale);
  const when = (iso: string) => formatDateTime(iso, locale);
  const muted = (text: string) => <span className="text-ink-subtle">{text}</span>;
  const verification = payment.verification;
  const reported = (value: string | null | undefined) => value || muted(t("paymentDetail.notReported"));

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link href="/payments" className="inline-flex items-center gap-1.5 rounded-control text-sm text-ink-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden />
          {t("paymentDetail.back")}
        </Link>
        <header className="space-y-2">
          <p className="text-sm font-medium text-ink-muted">{t("paymentDetail.title")}</p>
          <h1 className="font-mono text-xl font-semibold tracking-tight break-all text-ink sm:text-2xl">{payment.merchant_reference}</h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
            <PaymentStatusBadge status={payment.status} />
            <span className="tabular-nums text-ink">{formatMoney(payment.amount, payment.currency, locale)}</span>
            <span>{codeLabel(t, "payProvider", payment.provider)}</span>
          </p>
        </header>
      </div>

      <div className="rounded-card border border-line bg-neutral-50/70 px-4 py-3 text-sm text-ink-muted">
        <p className="flex items-start gap-2">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("paymentDetail.readOnly")}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section id="payment-summary" title={t("paymentDetail.sectionPayment")}>
          <Item label={t("paymentDetail.status")}>
            <PaymentStatusBadge status={payment.status} />
          </Item>
          <Item label={t("paymentDetail.reason")}>
            {payment.failure_reason ? (
              <span data-reason={payment.failure_reason}>{codeLabel(t, "payReason", payment.failure_reason)}</span>
            ) : (
              muted(t("paymentDetail.noReason"))
            )}
          </Item>
          <Item label={t("paymentDetail.amount")}>
            <span className="tabular-nums">{formatMoney(payment.amount, payment.currency, locale)}</span>
          </Item>
          <Item label={t("paymentDetail.validity")}>{t("packages.days", { n: formatNumber(payment.validity_days, locale) })}</Item>
          <Item label={t("paymentDetail.provider")}>{codeLabel(t, "payProvider", payment.provider)}</Item>
          <Item label={t("paymentDetail.reference")}>
            <span className="font-mono text-xs break-all">{payment.merchant_reference}</span>
          </Item>
          <Item label={t("paymentDetail.created")}>{when(payment.created_at)}</Item>
          <Item label={t("paymentDetail.verified")}>{payment.verified_at ? when(payment.verified_at) : muted(t("paymentDetail.notVerified"))}</Item>
          <Item label={t("paymentDetail.updated")}>{when(payment.updated_at)}</Item>
          <Item label={t("paymentDetail.lastChecked")}>
            {payment.last_checked_at ? when(payment.last_checked_at) : muted(t("paymentDetail.neverChecked"))}
          </Item>
        </Section>

        <Section id="payment-student" title={t("paymentDetail.sectionStudent")}>
          <Item label={t("paymentDetail.student")}>
            <Link href={`/users/${payment.user.id}`} className="rounded-control text-brand-700 hover:underline">
              {payment.user.full_name}
            </Link>
          </Item>
          <Item label={t("paymentDetail.mobile")}>
            <MaskedValue value={payment.user.mobile_display} />
          </Item>
          <Item label={t("paymentDetail.package")}>
            <Link href={`/packages/${payment.package.id}`} lang={pkgName.lang} className="rounded-control text-brand-700 hover:underline">
              {pkgName.text || payment.package.slug}
            </Link>
          </Item>
          <Item label={t("paymentDetail.slug")}>
            <span className="break-all">{payment.package.slug}</span>
          </Item>
          <Item label={t("paymentDetail.subscription")}>
            {payment.subscription_id !== null ? (
              <Link href={`/subscriptions/${payment.subscription_id}`} className="rounded-control text-brand-700 hover:underline">
                {t("paymentDetail.subscriptionLink", { id: payment.subscription_id })}
              </Link>
            ) : (
              muted(t("paymentDetail.noSubscription"))
            )}
          </Item>
        </Section>
      </div>

      <section aria-labelledby="payment-provider" className="rounded-card border border-line bg-surface">
        <h2 id="payment-provider" className="border-b border-line px-5 py-3.5 text-[15px] font-semibold text-ink">
          {t("paymentDetail.sectionProvider")}
        </h2>
        <div className="space-y-4 px-5 py-5">
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Item label={t("paymentDetail.transactionId")}>
              {payment.provider_transaction_id ? (
                <span className="font-mono text-xs break-all">{payment.provider_transaction_id}</span>
              ) : (
                muted(t("paymentDetail.noTransactionId"))
              )}
            </Item>
            {verification && (
              <>
                <Item label={t("paymentDetail.providerStatus")}>{reported(verification.provider_status)}</Item>
                <Item label={t("paymentDetail.riskLevel")}>{reported(verification.risk_level)}</Item>
                <Item label={t("paymentDetail.cardBrand")}>{reported(verification.card_brand)}</Item>
                <Item label={t("paymentDetail.validatedOn")}>{reported(verification.validated_on)}</Item>
              </>
            )}
          </dl>
          <p className="flex items-start gap-2 text-[13px] text-ink-subtle">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            {verification ? t("paymentDetail.providerNote") : t("paymentDetail.noVerification")}
          </p>
        </div>
      </section>

      <section aria-labelledby="payment-timeline" className="rounded-card border border-line bg-surface">
        <div className="border-b border-line px-5 py-3.5">
          <h2 id="payment-timeline" className="text-[15px] font-semibold text-ink">
            {t("paymentDetail.sectionTimeline")}
          </h2>
          {payment.events.length > 0 && (
            <p className="mt-0.5 text-[13px] text-ink-muted" data-timeline-count>
              {payment.events_total > payment.events.length
                ? t("paymentDetail.timelineCount", {
                    shown: formatNumber(payment.events.length, locale),
                    total: formatNumber(payment.events_total, locale),
                  })
                : t("paymentDetail.timelineAll", { total: formatNumber(payment.events_total, locale) })}
            </p>
          )}
        </div>
        <div className="px-5 py-5">
          {payment.events.length ? <PaymentTimeline events={payment.events} /> : <p className="text-sm text-ink-muted">{t("paymentDetail.noEvents")}</p>}
        </div>
      </section>

      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm sm:justify-end">
        <Link href={`/payments?user=${payment.user.id}`} className="rounded-control font-medium text-brand-700 underline underline-offset-2 hover:text-brand-600">
          {t("paymentDetail.studentPayments")}
        </Link>
        <Link href={`/payments?package=${payment.package.id}`} className="rounded-control font-medium text-brand-700 underline underline-offset-2 hover:text-brand-600">
          {t("paymentDetail.packagePayments")}
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
